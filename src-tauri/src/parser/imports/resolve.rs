use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::extract::{extract_imports, push_unique, ImportEntry};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImporterEntry {
    pub path: String,
    pub names: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportAnalysis {
    pub imports: Vec<ImportEntry>,
    pub imported_by: Vec<ImporterEntry>,
}

const CODE_EXTENSIONS: [&str; 5] = ["py", "ts", "tsx", "js", "jsx"];
const SKIPPED_DIRS: [&str; 8] = [
    ".git", "node_modules", "target", "dist", ".scalpel", "__pycache__", ".venv", "venv",
];

fn project_files(root: &Path, depth: usize) -> Vec<PathBuf> {
    if depth >= 12 {
        return Vec::new();
    }
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut files = Vec::new();
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_symlink() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path();
        if file_type.is_dir() {
            if SKIPPED_DIRS.contains(&name.as_str()) || name.starts_with('.') {
                continue;
            }
            files.extend(project_files(&path, depth + 1));
        } else if let Some((_, ext)) = name.rsplit_once('.') {
            if CODE_EXTENSIONS.contains(&ext.to_lowercase().as_str()) {
                files.push(path);
            }
        }
    }
    files
}

fn relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| path.to_string_lossy().replace('\\', "/"))
}

fn same_file(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}

/// Match an import specifier to a project file by path and filename stem.
pub fn resolve_specifier(
    specifier: &str,
    importer_rel: &str,
    root: &Path,
    stem_index: &HashMap<String, PathBuf>,
) -> Option<PathBuf> {
    if specifier.is_empty() {
        return None;
    }

    if specifier.starts_with('.') {
        let dots = specifier.chars().take_while(|c| *c == '.').count();
        let rest = specifier[dots..].trim_start_matches('/');
        let mut base_dir = Path::new(importer_rel)
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_default();
        for _ in 1..dots {
            base_dir = base_dir
                .parent()
                .map(|p| p.to_path_buf())
                .unwrap_or_default();
        }
        let joined = base_dir.join(rest);
        return try_candidates(root, &joined);
    }

    // Python dotted module path (e.g. `utils.helpers`).
    if !specifier.contains('/') {
        let as_path = specifier.replace('.', "/");
        if let Some(found) = try_candidates(root, Path::new(&as_path)) {
            return Some(found);
        }
    }

    // Bare specifier: fall back to matching a project file by its stem.
    let last = specifier.rsplit(['/', '.']).next().unwrap_or(specifier);
    stem_index.get(last).cloned()
}

#[derive(Debug, Default, Clone)]
pub struct AliasMap {
    base_url: String,
    paths: Vec<(String, Vec<String>)>,
}

impl AliasMap {
    pub fn from_json(json: &serde_json::Value) -> AliasMap {
        let options = json.get("compilerOptions");
        let base_url = options
            .and_then(|value| value.get("baseUrl"))
            .and_then(|value| value.as_str())
            .unwrap_or(".")
            .trim_start_matches("./")
            .to_string();
        let mut paths = Vec::new();
        if let Some(map) = options
            .and_then(|value| value.get("paths"))
            .and_then(|value| value.as_object())
        {
            for (pattern, targets) in map {
                let Some(targets) = targets.as_array() else {
                    continue;
                };
                let targets: Vec<String> = targets
                    .iter()
                    .filter_map(|value| value.as_str())
                    .map(|value| value.trim_start_matches("./").to_string())
                    .collect();
                if !targets.is_empty() {
                    paths.push((pattern.clone(), targets));
                }
            }
        }
        AliasMap { base_url, paths }
    }

    pub fn load(root: &Path) -> AliasMap {
        for name in ["tsconfig.json", "jsconfig.json"] {
            let Ok(text) = std::fs::read_to_string(root.join(name)) else {
                continue;
            };
            let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else {
                continue;
            };
            let map = AliasMap::from_json(&json);
            if !map.paths.is_empty() {
                return map;
            }
        }
        AliasMap::default()
    }

    pub fn candidates(&self, specifier: &str) -> Vec<PathBuf> {
        let mut candidates = Vec::new();
        for (pattern, targets) in &self.paths {
            let (prefix, suffix) = match pattern.split_once('*') {
                Some((prefix, suffix)) => (prefix, Some(suffix)),
                None => (pattern.as_str(), None),
            };
            let star = match suffix {
                Some(_) if !specifier.starts_with(prefix) => continue,
                Some(_) => &specifier[prefix.len()..],
                None if specifier == prefix => "",
                None => continue,
            };
            for target in targets {
                let replaced = target.replacen('*', star, 1);
                let candidate = if self.base_url.is_empty() || self.base_url == "." {
                    PathBuf::from(&replaced)
                } else {
                    Path::new(&self.base_url).join(&replaced)
                };
                candidates.push(candidate);
            }
        }
        candidates
    }

    pub fn resolve(&self, specifier: &str, root: &Path) -> Option<PathBuf> {
        for candidate in self.candidates(specifier) {
            if let Some(found) = try_candidates(root, &candidate) {
                return Some(found);
            }
        }
        None
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedImport {
    pub target: PathBuf,
    pub specifier: String,
    pub names: Vec<String>,
}

pub struct Resolver {
    root: PathBuf,
    index: HashMap<String, PathBuf>,
    aliases: AliasMap,
}

impl Resolver {
    pub fn new(root: &Path, files: &[PathBuf], aliases: AliasMap) -> Resolver {
        Resolver {
            root: root.to_path_buf(),
            index: stem_index(files),
            aliases,
        }
    }

    /// Resolve one import entry to target files, excluding the importing file.
    ///
    /// Package-relative imports like `from . import constants` carry the specifier
    /// `"."` plus imported names, so resolving the specifier alone would point at the
    /// package's own `__init__.py`. When the plain specifier resolves to the importer
    /// itself, each imported name is tried as a submodule (`".constants"`), which
    /// yields the real target files.
    pub fn resolve(&self, entry: &ImportEntry, importer_rel: &str) -> Vec<ResolvedImport> {
        let specifier = entry.specifier.as_str();
        let names = entry.names.as_slice();
        let importer = self.root.join(importer_rel);
        if let Some(primary) = resolve_specifier(specifier, importer_rel, &self.root, &self.index) {
            if primary != importer {
                return vec![ResolvedImport {
                    target: primary,
                    specifier: specifier.to_string(),
                    names: names.to_vec(),
                }];
            }
        }
        if !specifier.starts_with('.') {
            if let Some(aliased) = self.aliases.resolve(specifier, &self.root) {
                if aliased != importer {
                    return vec![ResolvedImport {
                        target: aliased,
                        specifier: specifier.to_string(),
                        names: names.to_vec(),
                    }];
                }
            }
        }
        let separator = if specifier.contains('/') {
            "/"
        } else if specifier.ends_with('.') {
            "" // `from . import x` -> ".x", not "..x"
        } else {
            "."
        };
        let mut out = Vec::new();
        for name in names {
            let candidate = format!("{specifier}{separator}{name}");
            if let Some(path) = resolve_specifier(&candidate, importer_rel, &self.root, &self.index) {
                if path != importer {
                    out.push(ResolvedImport {
                        target: path,
                        specifier: candidate,
                        names: vec![name.clone()],
                    });
                }
            }
        }
        out
    }
}

fn try_candidates(root: &Path, relative_base: &Path) -> Option<PathBuf> {
    let base = root.join(relative_base);
    const EXTS: [&str; 17] = [
        "py", "ts", "tsx", "js", "jsx", "md", "json", "css", "scss", "html", "yaml", "yml",
        "toml", "ini", "txt", "sql", "sh",
    ];
    // A base whose file name already contains a dot (`ai.easy`, `app.config`)
    // is a name, not an extension, so appending `.{ext}` must be tried first.
    let dotted = base
        .file_name()
        .map(|name| name.to_string_lossy().contains('.'))
        .unwrap_or(false);
    for ext in EXTS {
        let replaced = base.with_extension(ext);
        let appended = PathBuf::from(format!("{}.{}", base.display(), ext));
        let (first, second) = if dotted {
            (appended, replaced)
        } else {
            (replaced, appended)
        };
        if first.is_file() {
            return Some(first);
        }
        if second.is_file() {
            return Some(second);
        }
    }
    if base.is_dir() {
        for ext in EXTS {
            let index = base.join(format!("index.{ext}"));
            if index.is_file() {
                return Some(index);
            }
        }
        let init = base.join("__init__.py");
        if init.is_file() {
            return Some(init);
        }
    }
    None
}

pub fn stem_index(files: &[PathBuf]) -> HashMap<String, PathBuf> {
    let mut index = HashMap::new();
    for file in files {
        if let Some(stem) = file.file_stem().and_then(|s| s.to_str()) {
            index.entry(stem.to_string()).or_insert_with(|| file.clone());
        }
    }
    index
}

/// Imports of `path`, plus every project file whose imports resolve to `path`.
/// `path` may be absolute or project-relative; reads are anchored to `root`.
pub fn analyze(path: &str, root: &str) -> Result<ImportAnalysis, String> {
    let root_path = Path::new(root);
    let full = root_path.join(path);
    let current_rel = relative(root_path, &full);
    let source =
        std::fs::read_to_string(&full).map_err(|e| format!("{}: {e}", full.display()))?;
    let imports = extract_imports(&source, &current_rel);

    let files = project_files(root_path, 0);
    let resolver = Resolver::new(root_path, &files, AliasMap::load(root_path));

    let mut imported_by = Vec::new();
    for file in &files {
        if same_file(file, &full) {
            continue;
        }
        let Ok(other_source) = std::fs::read_to_string(file) else {
            continue;
        };
        let other_rel = relative(root_path, file);
        let mut names: Vec<String> = Vec::new();
        let mut matched = false;
        for entry in extract_imports(&other_source, &other_rel) {
            let targets = resolver.resolve(&entry, &other_rel);
            if targets.iter().any(|target| same_file(&target.target, &full)) {
                matched = true;
                for name in entry.names {
                    push_unique(&mut names, name);
                }
            }
        }
        if matched {
            imported_by.push(ImporterEntry {
                path: other_rel,
                names,
            });
        }
    }
    imported_by.sort_by(|a, b| a.path.cmp(&b.path));

    Ok(ImportAnalysis {
        imports,
        imported_by,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_project(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "scalpel-imports-{tag}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn resolves_relative_and_dotted_specifiers() {
        let root = temp_project("resolve");
        std::fs::create_dir_all(root.join("utils")).unwrap();
        std::fs::write(root.join("utils/helpers.py"), "").unwrap();
        std::fs::write(root.join("utils/index.ts"), "").unwrap();
        let files = project_files(&root, 0);
        let index = stem_index(&files);

        let dotted =
            resolve_specifier("utils.helpers", "main.py", &root, &index).expect("dotted resolves");
        assert_eq!(relative(&root, &dotted), "utils/helpers.py");

        let relative_hit =
            resolve_specifier("./helpers", "utils/caller.py", &root, &index).expect("relative");
        assert_eq!(relative(&root, &relative_hit), "utils/helpers.py");

        let bare = resolve_specifier("Button", "app.tsx", &root, &index);
        assert!(bare.is_none());
    }

    #[test]
    fn analyze_accepts_a_project_relative_path() {
        let root = temp_project("relative");
        std::fs::write(root.join("b.py"), "def thing():\n    return 1\n").unwrap();
        std::fs::write(root.join("a.py"), "from b import thing\n").unwrap();

        let analysis = analyze("b.py", &root.to_string_lossy()).unwrap();
        assert_eq!(analysis.imported_by.len(), 1);
        assert_eq!(analysis.imported_by[0].path, "a.py");
    }

    #[test]
    fn analyze_reports_importers_with_names() {
        let root = temp_project("analyze");
        std::fs::write(root.join("b.py"), "def thing():\n    return 1\n").unwrap();
        std::fs::write(
            root.join("a.py"),
            "from b import thing\n\ndef use():\n    return thing()\n",
        )
        .unwrap();

        let target = root.join("b.py");
        let analysis = analyze(&target.to_string_lossy(), &root.to_string_lossy()).unwrap();
        assert!(analysis.imports.is_empty());
        assert_eq!(analysis.imported_by.len(), 1);
        assert_eq!(analysis.imported_by[0].path, "a.py");
        assert_eq!(analysis.imported_by[0].names, vec!["thing".to_string()]);
    }

    #[test]
    fn analyze_reports_the_files_own_imports() {
        let root = temp_project("own");
        std::fs::write(root.join("c.py"), "def c():\n    return 1\n").unwrap();
        std::fs::write(root.join("d.py"), "from c import c\n").unwrap();

        let target = root.join("d.py");
        let analysis = analyze(&target.to_string_lossy(), &root.to_string_lossy()).unwrap();
        assert_eq!(analysis.imports.len(), 1);
        assert_eq!(analysis.imports[0].specifier, "c");
        assert_eq!(analysis.imports[0].names, vec!["c".to_string()]);
    }

    #[test]
    fn alias_candidates_are_pure() {
        let json: serde_json::Value =
            serde_json::from_str(r#"{"compilerOptions":{"baseUrl":".","paths":{"@/*":["src/*"]}}}"#)
                .unwrap();
        let aliases = AliasMap::from_json(&json);
        let candidates = aliases.candidates("@/util");
        assert_eq!(candidates, vec![PathBuf::from("src/util")]);
    }

    #[test]
    fn resolver_matches_an_import_to_a_target() {
        let root = temp_project("resolver");
        std::fs::write(root.join("utils.py"), "VALUE = 1\n").unwrap();
        let files = vec![root.join("utils.py")];
        let resolver = Resolver::new(&root, &files, AliasMap::default());
        let entry = ImportEntry { specifier: "utils".into(), names: vec!["VALUE".into()] };
        let resolved = resolver.resolve(&entry, "main.py");
        assert_eq!(resolved.len(), 1);
        assert_eq!(resolved[0].target, root.join("utils.py"));
    }
}
