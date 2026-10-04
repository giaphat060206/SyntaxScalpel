use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::models::NodeKind;
use crate::parser::function_graph::Def;
use crate::parser::neighborhood::EXTERNAL_SEPARATOR;
use crate::parser::project::{project_graph, ProjectFile};

pub const MAX_STRUCTURE_BYTES: usize = 24 * 1024;
pub const MAX_SIGNATURE_BYTES: usize = 64 * 1024;
pub const MAX_BODY_BYTES: usize = 96 * 1024;
pub const MAX_DOC_BYTES: usize = 8 * 1024;
pub const MAX_DOC_FILE_CHARS: usize = 1_200;

/// What a Digest explains: a whole Scope, chosen files in it, or chosen
/// Definitions in one Code File.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Target {
    Scope { scope: String },
    Files { scope: String, files: Vec<String> },
    Definitions { file: String, ids: Vec<String> },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Options {
    pub signatures: bool,
    pub bodies: bool,
    pub docs: bool,
}

impl Default for Options {
    fn default() -> Self {
        Options { signatures: true, bodies: false, docs: false }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Digest {
    pub text: String,
    pub truncated: bool,
    pub file_count: usize,
    pub definition_count: usize,
}

impl Digest {
    pub fn is_empty(&self) -> bool {
        self.text.trim().is_empty()
    }
}

struct Writer {
    text: String,
    limit: usize,
    truncated: bool,
}

impl Writer {
    fn new(limit: usize) -> Writer {
        Writer { text: String::new(), limit, truncated: false }
    }

    /// Appends a line, or refuses once the layer budget is spent so a Digest is
    /// never larger than the budget it was given.
    fn line(&mut self, line: &str) -> bool {
        if !self.text.is_empty() && self.text.len() + line.len() + 1 > self.limit {
            self.truncated = true;
            return false;
        }
        self.text.push_str(line);
        self.text.push('\n');
        true
    }

    fn finish(self, file_count: usize, definition_count: usize) -> Digest {
        Digest {
            text: self.text.trim_end().to_string(),
            truncated: self.truncated,
            file_count,
            definition_count,
        }
    }
}

pub fn build(root: &str, target: &Target, options: &Options) -> Result<Digest, String> {
    match target {
        Target::Scope { scope } => build_scope(root, scope, &[], options),
        Target::Files { scope, files } => build_scope(root, scope, files, options),
        Target::Definitions { file, ids } => build_definitions(root, file, ids, options),
    }
}

fn budget(options: &Options, bodies: bool) -> usize {
    MAX_STRUCTURE_BYTES
        + if options.signatures { MAX_SIGNATURE_BYTES } else { 0 }
        + if options.docs { MAX_DOC_BYTES } else { 0 }
        + if bodies && options.bodies { MAX_BODY_BYTES } else { 0 }
}

fn label(root: &str, scope: &str) -> String {
    if !scope.is_empty() {
        return scope.to_string();
    }
    Path::new(root)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| root.to_string())
}

fn read(root: &str, rel: &str) -> Result<String, String> {
    let full = Path::new(root).join(rel);
    std::fs::read_to_string(&full).map_err(|e| format!("{}: {e}", full.display()))
}

fn kind_word(kind: &NodeKind) -> &'static str {
    match kind {
        NodeKind::Class => "class",
        NodeKind::Method => "method",
        NodeKind::Function => "fn",
        NodeKind::Variable => "var",
    }
}

fn params(def: &Def) -> String {
    if def.params.is_empty() {
        String::new()
    } else {
        format!("({})", def.params.join(", "))
    }
}

fn returns(def: &Def) -> String {
    if def.returns.is_empty() {
        String::new()
    } else {
        format!(" -> {}", def.returns.join(", "))
    }
}

fn in_source_order(defs: &[Def]) -> Vec<&Def> {
    let mut ordered: Vec<&Def> = defs.iter().collect();
    ordered.sort_by_key(|def| (def.start_line, def.end_line));
    ordered
}

fn containers(defs: &[Def]) -> Vec<&Def> {
    in_source_order(defs)
        .into_iter()
        .filter(|def| def.kind == NodeKind::Class && def.parent.is_none())
        .collect()
}

fn members<'a>(defs: &'a [Def], container: &str) -> Vec<&'a Def> {
    in_source_order(defs)
        .into_iter()
        .filter(|def| def.parent.as_deref() == Some(container))
        .collect()
}

fn loose(defs: &[Def]) -> Vec<&Def> {
    in_source_order(defs)
        .into_iter()
        .filter(|def| def.parent.is_none() && def.kind != NodeKind::Class)
        .collect()
}

fn import_labels(file: &ProjectFile) -> Vec<String> {
    let mut set = BTreeSet::new();
    for import in &file.imports {
        let label = if import.target_id.is_empty() {
            import.specifier.clone()
        } else {
            import.target_id.clone()
        };
        if !label.is_empty() {
            set.insert(label);
        }
    }
    set.into_iter().collect()
}

fn build_scope(
    root: &str,
    scope: &str,
    only: &[String],
    options: &Options,
) -> Result<Digest, String> {
    let graph = project_graph(root, scope)?;
    let mut selected: Vec<&ProjectFile> = graph
        .files
        .iter()
        .filter(|file| !file.external && (only.is_empty() || only.contains(&file.id)))
        .collect();
    selected.sort_by(|left, right| left.id.cmp(&right.id));

    let mut writer = Writer::new(budget(options, false));
    let mut definition_count = 0;
    let mut body: Vec<String> = Vec::new();
    let mut docs: Vec<(String, String)> = Vec::new();
    let mut total_lines = 0;

    for file in &selected {
        match file.kind.as_str() {
            "code" => {
                let source = read(root, &file.id)?;
                let lines = source.lines().count();
                let defs = crate::parser::definitions(&source, &file.id)?;
                total_lines += lines;
                definition_count += defs.len();
                body.push(format!("{}  {}L", file.id, lines));
                if options.signatures {
                    for container in containers(&defs) {
                        body.push(format!("  class {}", container.name));
                        for member in members(&defs, &container.id) {
                            body.push(format!(
                                "    {}{}{}",
                                member.name,
                                params(member),
                                returns(member)
                            ));
                        }
                    }
                    for def in loose(&defs) {
                        body.push(format!(
                            "  {} {}{}{}",
                            kind_word(&def.kind),
                            def.name,
                            params(def),
                            returns(def)
                        ));
                    }
                } else {
                    for container in containers(&defs) {
                        let names: Vec<&str> = members(&defs, &container.id)
                            .iter()
                            .map(|member| member.name.as_str())
                            .collect();
                        body.push(format!("  class {} {{{}}}", container.name, names.join(", ")));
                    }
                    for def in loose(&defs) {
                        body.push(format!("  {} {}", kind_word(&def.kind), def.name));
                    }
                }
                let imports = import_labels(file);
                if !imports.is_empty() {
                    body.push(format!("  -> {}", imports.join(", ")));
                }
            }
            "doc" => {
                if options.docs {
                    let text = read(root, &file.id)?;
                    docs.push((file.id.clone(), text.chars().take(MAX_DOC_FILE_CHARS).collect()));
                } else {
                    body.push(file.id.clone());
                }
            }
            _ => {}
        }
    }

    writer.line(&format!(
        "{}  {} files  {} lines",
        label(root, scope),
        selected.iter().filter(|file| file.kind == "code").count(),
        total_lines
    ));
    for line in body {
        if !writer.line(&line) {
            break;
        }
    }
    // Markdown is documentation; the rest of the Doc File inventory is data that
    // happens to be readable, so it must not spend the documentation budget.
    docs.sort_by(|left, right| {
        let rank = |path: &String| usize::from(!path.ends_with(".md"));
        rank(&left.0).cmp(&rank(&right.0)).then_with(|| left.0.cmp(&right.0))
    });
    for (path, head) in docs {
        if !writer.line(&path) {
            break;
        }
        for line in head.lines() {
            if !writer.line(line) {
                break;
            }
        }
    }
    Ok(writer.finish(
        selected.iter().filter(|file| file.kind == "code").count(),
        definition_count,
    ))
}

/// A selected Definition, resolved to the file that declares it. A Cross-file
/// Block id is `path::local` (the separator the parser already uses), so a
/// Definition reached from another file resolves to that file and renders
/// exactly as if it had been picked there — which is what lets the Summary Cache
/// serve the same answer on both routes instead of buying it twice.
fn declaring_file(default_file: &str, id: &str) -> (String, String) {
    match id.split_once(EXTERNAL_SEPARATOR) {
        Some((file, local)) if !file.is_empty() && !local.is_empty() => {
            (file.to_string(), local.to_string())
        }
        _ => (default_file.to_string(), id.to_string()),
    }
}

fn build_definitions(
    root: &str,
    file: &str,
    ids: &[String],
    options: &Options,
) -> Result<Digest, String> {
    let mut wanted: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    if ids.is_empty() {
        wanted.insert(file.to_string(), BTreeSet::new());
    }
    for id in ids {
        let (owner, local) = declaring_file(file, id);
        wanted.entry(owner).or_default().insert(local);
    }

    // Selected ids are resolved per file first, because `calls` is filtered
    // against every selected name whichever file it came from — that filter is
    // what shows how pieces interact across a boundary.
    let mut groups: Vec<(String, Vec<String>)> = Vec::new();
    let mut peers: BTreeSet<String> = BTreeSet::new();
    for (owner, locals) in &wanted {
        let source = read(root, owner)?;
        let defs = crate::parser::definitions(&source, owner)?;
        let selected: Vec<String> = in_source_order(&defs)
            .into_iter()
            .filter(|def| locals.is_empty() || locals.contains(&def.id))
            .map(|def| {
                peers.insert(def.name.clone());
                def.id.clone()
            })
            .collect();
        if !selected.is_empty() {
            groups.push((owner.clone(), selected));
        }
    }

    let definition_count: usize = groups.iter().map(|(_, ids)| ids.len()).sum();
    if definition_count == 0 {
        return Err(if ids.is_empty() {
            format!("{file} declares no definitions")
        } else {
            "none of the selected definitions were found".to_string()
        });
    }

    let mut writer = Writer::new(budget(options, true));
    let mut full = false;
    for (owner, selected) in &groups {
        if full {
            break;
        }
        // Re-parsed rather than carried: `Def` is not `Clone`, and a Target
        // names only the Definitions a person picked, so this is a handful.
        let source = read(root, owner)?;
        let defs = crate::parser::definitions(&source, owner)?;
        let picked: Vec<&Def> = in_source_order(&defs)
            .into_iter()
            .filter(|def| selected.contains(&def.id))
            .collect();
        let language = fence_language(owner);
        if !writer.line(&format!("{}  {} definitions", owner, picked.len())) {
            break;
        }
        for def in picked {
            if !writer.line(&format!(
                "{} {}{}{}  lines {}-{}",
                kind_word(&def.kind),
                def.name,
                params(def),
                returns(def),
                def.start_line,
                def.end_line
            )) {
                full = true;
                break;
            }
            if !def.uses.is_empty() {
                let mut uses: Vec<&str> = def.uses.iter().map(String::as_str).collect();
                uses.sort_unstable();
                uses.dedup();
                if !writer.line(&format!("  uses {}", uses.join(", "))) {
                    full = true;
                    break;
                }
            }
            let mut calls: Vec<&str> = def
                .calls
                .iter()
                .map(String::as_str)
                .filter(|name| peers.contains(*name))
                .collect();
            calls.sort_unstable();
            calls.dedup();
            if !calls.is_empty() && !writer.line(&format!("  calls {}", calls.join(", "))) {
                full = true;
                break;
            }
            if options.bodies {
                if !writer.line(&format!("```{language}")) {
                    full = true;
                    break;
                }
                let lines: Vec<&str> = source.lines().collect();
                let start = def.start_line.saturating_sub(1);
                let end = def.end_line.min(lines.len());
                for line in lines.iter().take(end).skip(start) {
                    if !writer.line(line) {
                        full = true;
                        break;
                    }
                }
                if full || !writer.line("```") {
                    full = true;
                    break;
                }
            }
        }
    }
    Ok(writer.finish(groups.len(), definition_count))
}

fn fence_language(rel: &str) -> &'static str {
    match rel.rsplit_once('.').map(|(_, ext)| ext.to_lowercase()).as_deref() {
        Some("py") => "python",
        Some("js") | Some("jsx") => "javascript",
        Some("ts") | Some("tsx") => "typescript",
        Some("rs") => "rust",
        _ => "",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("scalpel-ai-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(root: &Path, rel: &str, body: &str) {
        let full = root.join(rel);
        if let Some(parent) = full.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(full, body).unwrap();
    }

    fn scope() -> Target {
        Target::Scope { scope: String::new() }
    }

    fn names_only() -> Options {
        Options { signatures: false, bodies: false, docs: false }
    }

    #[test]
    fn renders_structure_for_a_scope() {
        let root = fixture("digest-structure");
        write(
            &root,
            "a.py",
            "from b import helper\n\n\nclass Alpha:\n    def run(self):\n        helper()\n",
        );
        write(&root, "b.py", "def helper():\n    return 2\n");

        let digest = build(root.to_str().unwrap(), &scope(), &names_only()).unwrap();

        assert!(digest.text.starts_with("scalpel-ai-digest-structure"), "{}", digest.text);
        assert!(digest.text.contains("class Alpha {run}"), "{}", digest.text);
        assert!(digest.text.contains("fn helper"), "{}", digest.text);
        assert!(digest.text.contains("-> b.py"), "{}", digest.text);
        assert_eq!(digest.file_count, 2);
        assert_eq!(digest.definition_count, 3);
        assert!(!digest.truncated);
    }

    #[test]
    fn renders_signatures_when_asked() {
        let root = fixture("digest-signatures");
        write(&root, "a.py", "class Alpha:\n    def run(self):\n        return 1\n");

        let digest = build(root.to_str().unwrap(), &scope(), &Options::default()).unwrap();

        assert!(digest.text.contains("class Alpha"), "{}", digest.text);
        assert!(digest.text.contains("run(self)"), "{}", digest.text);
    }

    #[test]
    fn is_byte_identical_across_runs_and_orders_files() {
        let root = fixture("digest-determinism");
        write(&root, "z.py", "def z():\n    pass\n");
        write(&root, "a.py", "def a():\n    pass\n");

        let first = build(root.to_str().unwrap(), &scope(), &names_only()).unwrap();
        let second = build(root.to_str().unwrap(), &scope(), &names_only()).unwrap();

        assert_eq!(first.text, second.text);
        assert!(first.text.find("a.py").unwrap() < first.text.find("z.py").unwrap());
    }

    #[test]
    fn slices_bodies_by_line_range() {
        let root = fixture("digest-bodies");
        write(&root, "a.py", "def one():\n    return 1\n\n\ndef two():\n    return 2\n");
        let target = Target::Definitions { file: "a.py".into(), ids: vec!["two".into()] };
        let options = Options { signatures: true, bodies: true, docs: false };

        let digest = build(root.to_str().unwrap(), &target, &options).unwrap();

        assert!(digest.text.contains("lines 5-6"), "{}", digest.text);
        assert!(digest.text.contains("return 2"), "{}", digest.text);
        assert!(!digest.text.contains("return 1"), "{}", digest.text);
        assert!(digest.text.contains("```python"), "{}", digest.text);
        assert_eq!(digest.definition_count, 1);
    }

    #[test]
    fn lists_only_the_selected_definitions_that_call_each_other() {
        let root = fixture("digest-interaction");
        write(
            &root,
            "a.py",
            "def first():\n    second()\n\n\ndef second():\n    return 1\n\n\ndef third():\n    return 2\n",
        );
        let target = Target::Definitions {
            file: "a.py".into(),
            ids: vec!["first".into(), "second".into()],
        };

        let digest = build(root.to_str().unwrap(), &target, &Options::default()).unwrap();

        assert!(digest.text.contains("calls second"), "{}", digest.text);
        assert!(!digest.text.contains("third"), "{}", digest.text);
        assert_eq!(digest.definition_count, 2);
    }

    #[test]
    fn includes_documentation_only_when_asked() {
        let root = fixture("digest-docs");
        write(&root, "a.py", "def one():\n    return 1\n");
        write(&root, "README.md", "# Purpose\n\nThis does a thing.\n");

        let with_docs = Options { signatures: false, bodies: false, docs: true };
        let digest = build(root.to_str().unwrap(), &scope(), &with_docs).unwrap();
        assert!(digest.text.contains("This does a thing."), "{}", digest.text);

        let digest = build(root.to_str().unwrap(), &scope(), &names_only()).unwrap();
        assert!(digest.text.contains("README.md"), "{}", digest.text);
        assert!(!digest.text.contains("This does a thing."), "{}", digest.text);
    }

    #[test]
    fn reports_truncation_instead_of_dropping_silently() {
        let root = fixture("digest-truncation");
        let mut source = String::new();
        for index in 0..4_000 {
            source.push_str(&format!("def f{index}():\n    pass\n\n\n"));
        }
        write(&root, "big.py", &source);

        let digest = build(root.to_str().unwrap(), &scope(), &names_only()).unwrap();

        assert!(digest.truncated, "not truncated at {} bytes", digest.text.len());
        assert!(digest.text.len() <= MAX_STRUCTURE_BYTES + 4096);
    }

    #[test]
    fn selects_only_the_requested_files() {
        let root = fixture("digest-file-target");
        write(&root, "a.py", "def a():\n    pass\n");
        write(&root, "b.py", "def b():\n    pass\n");
        let target = Target::Files { scope: String::new(), files: vec!["a.py".into()] };

        let digest = build(root.to_str().unwrap(), &target, &names_only()).unwrap();

        assert!(digest.text.contains("fn a"), "{}", digest.text);
        assert!(!digest.text.contains("b.py"), "{}", digest.text);
        assert_eq!(digest.file_count, 1);
    }

    #[test]
    fn does_not_emit_the_ipc_payload_shape() {
        let root = fixture("digest-shape");
        write(&root, "a.py", "def one():\n    return 1\n");

        let digest = build(root.to_str().unwrap(), &scope(), &Options::default()).unwrap();

        for forbidden in ["startLine", "endLine", "crossEdges", "parentId", "residualImports"] {
            assert!(!digest.text.contains(forbidden), "{forbidden} leaked into {}", digest.text);
        }
    }

    #[test]
    fn refuses_a_selection_that_matches_nothing() {
        let root = fixture("digest-no-match");
        write(&root, "a.py", "def one():\n    return 1\n");

        let partial = Target::Definitions {
            file: "a.py".into(),
            ids: vec!["one".into(), "missing".into()],
        };
        assert!(build(root.to_str().unwrap(), &partial, &Options::default())
            .unwrap()
            .text
            .contains("fn one"));

        let none = Target::Definitions { file: "a.py".into(), ids: vec!["nope".into()] };
        let error = build(root.to_str().unwrap(), &none, &Options::default()).unwrap_err();
        assert!(error.contains("none of the selected definitions"), "{error}");

        write(&root, "empty.py", "");
        let empty = Target::Definitions { file: "empty.py".into(), ids: vec![] };
        let error = build(root.to_str().unwrap(), &empty, &Options::default()).unwrap_err();
        assert!(error.contains("declares no definitions"), "{error}");
    }

    #[test]
    fn resolves_a_definition_reached_from_another_file() {
        let root = fixture("digest-cross-file-id");
        write(&root, "a.py", "def one():\n    two()\n");
        write(&root, "b.py", "def two():\n    return 2\n\n\ndef three():\n    return 3\n");

        // The id a Cross-file Block carries is `declaring file::local id`.
        let target = Target::Definitions {
            file: "a.py".into(),
            ids: vec!["b.py::two".into()],
        };
        let digest = build(root.to_str().unwrap(), &target, &Options::default()).unwrap();

        assert!(digest.text.contains("b.py  1 definitions"), "{}", digest.text);
        assert!(digest.text.contains("fn two"), "{}", digest.text);
        assert!(!digest.text.contains("three"), "{}", digest.text);
        assert!(!digest.text.contains("a.py"), "{}", digest.text);
    }

    #[test]
    fn a_mixed_selection_renders_in_file_order_and_shows_the_call_across_it() {
        let root = fixture("digest-mixed");
        write(&root, "a.py", "def one():\n    two()\n");
        write(&root, "b.py", "def two():\n    return 2\n");

        let target = Target::Definitions {
            file: "a.py".into(),
            ids: vec!["b.py::two".into(), "one".into()],
        };
        let digest = build(root.to_str().unwrap(), &target, &Options::default()).unwrap();

        assert!(digest.text.find("a.py").unwrap() < digest.text.find("b.py").unwrap());
        assert_eq!(digest.file_count, 2);
        assert_eq!(digest.definition_count, 2);
        assert!(digest.text.contains("calls two"), "{}", digest.text);
    }

    #[test]
    fn picking_the_same_definition_either_way_is_the_same_digest() {
        let root = fixture("digest-same-answer");
        write(&root, "a.py", "def one():\n    two()\n");
        write(&root, "b.py", "def two():\n    return 2\n");

        let from_its_file = Target::Definitions { file: "b.py".into(), ids: vec!["two".into()] };
        let from_the_caller = Target::Definitions {
            file: "a.py".into(),
            ids: vec!["b.py::two".into()],
        };

        assert_eq!(
            build(root.to_str().unwrap(), &from_its_file, &Options::default())
                .unwrap()
                .text,
            build(root.to_str().unwrap(), &from_the_caller, &Options::default())
                .unwrap()
                .text
        );
    }

    #[test]
    fn fence_language_follows_the_extension() {
        assert_eq!(fence_language("a.py"), "python");
        assert_eq!(fence_language("a.jsx"), "javascript");
        assert_eq!(fence_language("a.tsx"), "typescript");
        assert_eq!(fence_language("a.rs"), "rust");
        assert_eq!(fence_language("Makefile"), "");
    }
}

