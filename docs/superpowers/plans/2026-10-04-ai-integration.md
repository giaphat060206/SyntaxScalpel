# AI Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user ask an AI Task about a Scope or a set of Definitions and get an answer grounded in a Digest the
app builds from its own parse, cached by prompt hash so unchanged code is never sent twice — with cloud providers
key-gated and local inference deferred.

**Architecture:** A new Rust `ai` module owns everything: `digest.rs` projects the existing parse into layered text,
`cache.rs` stores summaries content-addressed under `<root>/.scalpel/ai/`, `prompts.rs` owns the task templates and
`PROMPT_VERSION`, and `providers/` holds one OpenAI-compatible client with a per-provider base URL and model table.
One command, `ai_summary`, builds the Digest, derives the key, answers from cache when it can, and only otherwise
calls a provider. The frontend holds no code knowledge and no Provider Key.

**Tech Stack:** Rust (edition 2021), `tree-sitter` 0.25 (existing), `serde`/`serde_json` (existing), `sha2` (already
in `Cargo.lock` at 0.10.9 transitively — promoted to a direct dependency), `keyring` (new, Task 3), `reqwest` (new,
Task 4). Frontend: React 19 + TypeScript strict, `react-markdown` (existing).

**Specs:** `docs/superpowers/specs/2026-10-04-ai-integration-design.md`,
`docs/adr/0007-ai-summaries-and-caching.md`, `GLOSSARY.md`.

## Global Constraints

- Windows, PowerShell 5.1: never use `&&`; use `;` or `cmd1; if ($?) { cmd2 }`.
- All IPC payload structs derive `Serialize` with `#[serde(rename_all = "camelCase")]`; commands return
  `Result<T, String>` and never panic.
- File reads are root-anchored (`Path::new(root).join(path)`); paths are project-relative with `/`.
- **No AI summary is ever executed or written anywhere.** Answers are text; v1 has no write path.
- The Provider Key never crosses the IPC boundary and is never written to the Summary Cache.
- `.scalpel/metadata.json` stays neither read nor written (ADR-0002). `<root>/.scalpel/ai/` is the only new writer.
- Digest budgets are characters, not tokens; truncation is reported, never silent.
- **No test performs network I/O.**
- `cargo test --manifest-path src-tauri/Cargo.toml`, `npm test`, and `npm run build` must pass before each commit.
- Tell the user to restart `npm run tauri dev` after each Rust change.

### File Structure

```
src-tauri/src/ai/
  mod.rs          (new) module wiring; re-exports Digest, Target, Options, SummaryCache, CachedSummary
  digest.rs       (new) Digest, Target, Options, budgets, build(root, target, options)
  cache.rs        (new) SummaryCache, CachedSummary, key_for(prompt), get/put/evict
  prompts.rs      (new) PROMPT_VERSION, one template per AI Task, render(task, digest)
  settings.rs     (new) Provider/Model choice + Provider Key via keyring
  providers/mod.rs(new) Provider trait, request/response mapping, provider table
  providers/openai.rs (new) the one OpenAI-compatible client
src-tauri/src/commands/
  ai.rs           (new) ai_settings, set_ai_key, ai_summary
src-tauri/src/lib.rs        (modify) register mod ai + the three commands
src-tauri/Cargo.toml        (modify) sha2 (Task 1), keyring (Task 3), reqwest (Task 4)
src/features/ai/            (new) AiPanel.tsx, useAiSettings.ts, ScopePicker.tsx, DefinitionPicker.tsx
src/features/shell/App.tsx  (modify) AI panel wiring; result into the Docs panel
src/features/shell/TopBar.tsx (modify) AI button beside API
src/shared/ipc.ts           (modify) ai_settings / set_ai_key / ai_summary wrappers
```

---

### Task 1: Project the parse into a layered Digest

**Files:**
- Create: `src-tauri/src/ai/mod.rs`, `src-tauri/src/ai/digest.rs`
- Modify: `src-tauri/src/lib.rs` (`mod ai;`), `src-tauri/Cargo.toml` (`sha2 = "0.10"` is not needed until Task 2; this task adds no dependency)

**Interfaces:**
- Consumes: `crate::parser::project::project_graph`, `crate::parser::definitions`, `crate::models::{ProjectGraph, ProjectFile, NodeKind}`.
- Produces:

```rust
pub enum Target {
    Scope { scope: String },
    Files { scope: String, files: Vec<String> },
    Definitions { file: String, ids: Vec<String> },
}

pub struct Options {
    pub signatures: bool,
    pub bodies: bool,
    pub docs: bool,
}

pub struct Digest {
    pub text: String,
    pub truncated: bool,
    pub file_count: usize,
    pub definition_count: usize,
}

pub const MAX_STRUCTURE_BYTES: usize = 24 * 1024;
pub const MAX_SIGNATURE_BYTES: usize = 64 * 1024;
pub const MAX_BODY_BYTES: usize = 96 * 1024;
pub const MAX_DOC_BYTES: usize = 8 * 1024;

pub fn build(root: &str, target: &Target, options: &Options) -> Result<Digest, String>;
```

**Format (L0):** a header `"{scope}  {files} files  {lines} lines"`, then per Code File a line `"{path}  {lines}L"`,
an indented `"  class Name {member, member}"` / `"  fn name"` line per container and top-level Definition, and an
indented `"  -> a.py, b.py"` line of deduped sorted import targets. Doc Files are listed by path with no members.

- [ ] **Step 1: Write the failing tests**

Create `digest.rs`'s test module with a temp-dir fixture writer and:

```rust
#[test]
fn renders_structure_for_a_scope() {
    let root = fixture("digest-structure");
    write(&root, "a.py", "from b import Thing\n\nclass Thing:\n    def run(self):\n        return 1\n");
    write(&root, "b.py", "def helper():\n    return 2\n");
    let digest = build(root.to_str().unwrap(), &Target::Scope { scope: "".into() }, &Options::default()).unwrap();
    assert!(digest.text.contains("class Thing {run}"));
    assert!(digest.text.contains("fn helper"));
    assert!(digest.text.contains("-> b.py"));
    assert_eq!(digest.file_count, 2);
}

#[test]
fn is_byte_identical_across_runs() {
    let root = fixture("digest-determinism");
    write(&root, "z.py", "def z():\n    pass\n");
    write(&root, "a.py", "def a():\n    pass\n");
    let first = build(root.to_str().unwrap(), &Target::Scope { scope: "".into() }, &Options::default()).unwrap();
    let second = build(root.to_str().unwrap(), &Target::Scope { scope: "".into() }, &Options::default()).unwrap();
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
    assert!(digest.text.contains("return 2"));
    assert!(!digest.text.contains("return 1"));
}

#[test]
fn reports_truncation_instead_of_dropping_silently() {
    let root = fixture("digest-truncation");
    for index in 0..40 {
        write(&root, &format!("f{index}.py"), "def f():\n    pass\n");
    }
    let options = Options { signatures: false, bodies: false, docs: false };
    let digest = build(root.to_str().unwrap(), &Target::Scope { scope: "".into() }, &options).unwrap();
    assert!(digest.text.len() <= MAX_STRUCTURE_BYTES + 4096);
    assert!(digest.truncated);
}

#[test]
fn does_not_emit_the_ipc_payload_shape() {
    let root = fixture("digest-shape");
    write(&root, "a.py", "def one():\n    return 1\n");
    let digest = build(root.to_str().unwrap(), &Target::Scope { scope: "".into() }, &Options::default()).unwrap();
    assert!(!digest.text.contains("startLine"));
    assert!(!digest.text.contains("crossEdges"));
    assert!(!digest.text.contains('{'));
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml digest::`
Expected: FAIL — module `ai::digest` undefined.

- [ ] **Step 3: Implement the projection**

- Walk the Scope once with `project_graph(root, scope)` to get files, Doc Files, and Import Edges.
- For each Code File, call `crate::parser::definitions(&source, path)` for its Definitions; group by `parent` into
  containers and list members by name only.
- Render L0 into one `String`, appending line by line with a running byte count; stop and set `truncated` when the
  layer's budget is reached. Sort files by path and import targets deduped and sorted.
- For `Target::Definitions`, resolve the file's Definitions and emit L1 (`{kind} {name}({params}){ -> returns}` plus
  `{startLine}-{endLine}`) and, when `options.bodies`, L2 by slicing the source lines for each selected Definition.
- `Options::default()` is `signatures: true, bodies: false, docs: false`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml digest::`
Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/ai src-tauri/src/lib.rs
git commit -m "feat(ai): project the parse into a layered digest"
```

---

### Task 2: Store summaries content-addressed

**Files:**
- Create: `src-tauri/src/ai/cache.rs`
- Modify: `src-tauri/src/ai/mod.rs`, `src-tauri/Cargo.toml` (`sha2 = "0.10"`)

**Interfaces:**
- Produces:

```rust
pub struct CachedSummary {
    pub key: String,
    pub task: String,
    pub provider: String,
    pub model: String,
    pub prompt_version: u32,
    pub created_at_ms: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub text: String,
}

pub struct SummaryCache { /* dir: PathBuf */ }

impl SummaryCache {
    pub fn new(root: &str) -> SummaryCache;
    pub fn key_for(prompt: &str) -> String;
    pub fn get(&self, key: &str) -> Option<CachedSummary>;
    pub fn put(&self, entry: &CachedSummary) -> Result<(), String>;
    pub fn evict(&self, max_entries: usize, max_bytes: u64) -> Result<usize, String>;
    pub fn len(&self) -> usize;
}

pub const MAX_ENTRIES: usize = 200;
pub const MAX_BYTES: u64 = 4 * 1024 * 1024;
```

- [ ] **Step 1: Write the failing tests**

Create `cache.rs`'s test module with:

```rust
#[test]
fn round_trips_an_entry() {
    let root = fixture("cache-roundtrip");
    let cache = SummaryCache::new(root.to_str().unwrap());
    let key = SummaryCache::key_for("prompt text");
    cache.put(&entry(&key, "hello")).unwrap();
    assert_eq!(cache.get(&key).unwrap().text, "hello");
}

#[test]
fn a_changed_prompt_misses() {
    let root = fixture("cache-miss");
    let cache = SummaryCache::new(root.to_str().unwrap());
    cache.put(&entry(&SummaryCache::key_for("one"), "a")).unwrap();
    assert!(cache.get(&SummaryCache::key_for("two")).is_none());
}

#[test]
fn key_is_stable_and_content_addressed() {
    assert_eq!(SummaryCache::key_for("x"), SummaryCache::key_for("x"));
    assert_ne!(SummaryCache::key_for("x"), SummaryCache::key_for("y"));
    assert_eq!(SummaryCache::key_for("x").len(), 64);
}

#[test]
fn a_corrupt_entry_is_a_miss_not_an_error() {
    let root = fixture("cache-corrupt");
    let cache = SummaryCache::new(root.to_str().unwrap());
    let key = SummaryCache::key_for("broken");
    std::fs::write(cache.path_for(&key), "{ not json").unwrap();
    assert!(cache.get(&key).is_none());
}

#[test]
fn evicts_oldest_first_by_count() {
    let root = fixture("cache-evict");
    let cache = SummaryCache::new(root.to_str().unwrap());
    for index in 0..5u64 {
        let mut value = entry(&SummaryCache::key_for(&format!("p{index}")), "t");
        value.created_at_ms = index;
        cache.put(&value).unwrap();
    }
    assert_eq!(cache.evict(3, u64::MAX).unwrap(), 2);
    assert_eq!(cache.len(), 3);
    assert!(cache.get(&SummaryCache::key_for("p0")).is_none());
    assert!(cache.get(&SummaryCache::key_for("p4")).is_some());
}

#[test]
fn never_writes_outside_the_project() {
    let root = fixture("cache-anchored");
    let cache = SummaryCache::new(root.to_str().unwrap());
    assert!(cache.path_for("../../escape").starts_with(root.join(".scalpel").join("ai")));
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml cache::`
Expected: FAIL — module `ai::cache` undefined.

- [ ] **Step 3: Implement the store**

- `new` sets `dir = Path::new(root).join(".scalpel").join("ai")`; create it lazily on `put`, never on `get`.
- `key_for` is `sha2::Sha256` over the prompt bytes, hex-encoded lowercase — one function, no policy.
- `path_for(key)` takes only the hex characters of the key and joins it under `dir`, so a key can never escape.
- `put` writes pretty JSON; create the directory if missing; a write failure returns `Err` but never panics.
- `get` reads and parses; any I/O or parse error is `None`.
- `evict` lists entries, parses `createdAtMs` (treating an unparseable entry as oldest so it goes first), removes
  until both limits hold, returns how many were removed.
- `created_at_ms` comes from `SystemTime::now()`; no time crate is added.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml cache::`
Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/ai src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat(ai): cache summaries by prompt hash under .scalpel/ai"
```

---

### Task 3: Key-gated settings

**Files:**
- Create: `src-tauri/src/ai/settings.rs`, `src-tauri/src/commands/ai.rs`
- Modify: `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml` (`keyring`)

**Interfaces:**
- Produces:

```rust
pub struct AiSettings { pub provider: String, pub model: String, pub has_key: bool }
pub fn settings() -> AiSettings;
pub fn set_settings(provider: &str, model: &str) -> Result<AiSettings, String>;
pub fn set_key(provider: &str, key: &str) -> Result<AiSettings, String>;
pub fn clear_key(provider: &str) -> Result<AiSettings, String>;
pub fn key_for(provider: &str) -> Option<String>;
```

- [ ] **Step 1: Write the failing tests**

Assert that `settings()` reports `has_key: false` when the ring is empty, that `AiSettings` never serialises a key,
and that provider/model selection round-trips. Keyring access is behind a trait so tests use an in-memory fake and
never touch the OS credential store.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml settings`
Expected: FAIL — module undefined.

- [ ] **Step 3: Implement**

- A `SecretStore` trait (`get`/`set`/`delete`) with a `keyring` implementation and an in-memory fake for tests.
- Provider and model preference is non-secret and lives in `localStorage` on the frontend, not in Rust.
- Commands: `ai_settings`, `set_ai_key(provider, key)`, `ai_summary` lands in Task 5.
- `key_for` is crate-private; nothing serialises it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml settings`
Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/ai src-tauri/src/commands src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat(ai): store the provider key in the OS keyring"
```

---

### Task 4: One OpenAI-compatible provider client

**Files:**
- Create: `src-tauri/src/ai/providers/mod.rs`, `src-tauri/src/ai/providers/openai.rs`, `src-tauri/src/ai/prompts.rs`
- Modify: `src-tauri/Cargo.toml` (`reqwest` with `json` + `rustls-tls`)

**Interfaces:**
- Produces:

```rust
pub const PROMPT_VERSION: u32 = 1;
pub fn render(task: &str, digest: &str) -> String;

pub struct Completion { pub text: String, pub input_tokens: u64, pub output_tokens: u64 }
pub struct ProviderSpec { pub id: &'static str, pub base_url: &'static str, pub default_model: &'static str }
pub fn spec(id: &str) -> Option<ProviderSpec>;
pub async fn complete(spec: &ProviderSpec, model: &str, key: &str, prompt: &str) -> Result<Completion, String>;
```

- [ ] **Step 1: Write the failing tests**

Assert `render` output contains the digest, is stable for `PROMPT_VERSION`, and that the task instruction precedes
the digest; assert `spec("openrouter")` and `spec("deepseek")` resolve and `spec("gemini")` is `None` in v1; assert
a 401 response body maps to an invalid-key message and a malformed body to a parse message — all through a mocked
transport, with no network.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml providers`
Expected: FAIL — module undefined.

- [ ] **Step 3: Implement**

- `prompts.rs` owns `PROMPT_VERSION`, one template per AI Task, and `render`: instruction in the system role,
  Digest as user data. Bumping `PROMPT_VERSION` is what invalidates cached entries.
- `providers/mod.rs` holds the table (OpenRouter default, DeepSeek) and an error mapper (`401`/`403` → add or check
  your key, `429` → rate limited, other → status and body head).
- `providers/openai.rs` builds the bearer request and parses `choices[0].message.content` plus `usage`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml providers`
Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/ai src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat(ai): add one OpenAI-compatible provider client"
```

---

### Task 5: One command that digests, caches, and calls

**Files:**
- Modify: `src-tauri/src/commands/ai.rs`, `src-tauri/src/lib.rs`

**Interfaces:**
- Produces: `ai_summary(root, target, options, task, force) -> AiSummary`
  where `AiSummary { text, task, provider, model, cached: bool, createdAtMs, inputTokens, outputTokens }`, and
  `target`/`options` deserialize from the `Digest`/`Target`/`Options` shapes in Task 1.

- [ ] **Step 1: Write the failing tests**

With a fake provider and a temp project: a first call is a miss and stores an entry; a second identical call is
`cached: true` with the provider called once; `force: true` calls again; changing one line of the file misses;
changing only whitespace in an unselected file still hits.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml ai_summary`
Expected: FAIL — command undefined.

- [ ] **Step 3: Implement**

- `build` the Digest, `render` the prompt, `key_for` it, look up `SummaryCache`, and only on a miss call the
  provider; then `put` and `evict` (best-effort — a cache failure must not fail the command).
- No key for the chosen provider returns `Err("add an API key for {provider}")` before any request is built.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml` then `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/commands src-tauri/src/lib.rs
git commit -m "feat(ai): digest, cache, and provider behind one command"
```

---

### Task 6: The AI panel and the gating rule

**Files:**
- Create: `src/features/ai/AiPanel.tsx`, `src/features/ai/useAiSettings.ts`
- Modify: `src/features/shell/TopBar.tsx`, `src/features/shell/App.tsx`, `src/shared/ipc.ts`

**Interfaces:**
- Consumes: `aiSettings`, `setAiKey`, `aiSummary` from `src/shared/ipc.ts`.
- Produces: `useAiSettings()` → `{ settings, ready, save, saveKey, clearKey }`; `AiPanel` props
  `{ onResult: (text: string) => void }`.

- [ ] **Step 1: Write the failing tests**

With no key: every AI Task control is disabled and carries an "Add an API key" reason, while the key field is still
reachable and editable. With a key: the Tasks enable. Provider and model choice persist across a remount.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/features/ai`
Expected: FAIL — components undefined.

- [ ] **Step 3: Implement**

- `TopBar` gains an `AI` button beside `API`, present whenever a folder is open.
- `useAiSettings` reads `aiSettings` once and exposes `ready = settings.has_key`.
- Results go to `App`'s Docs panel via `MarkdownView`, with a header carrying task, model, cache age, and
  Regenerate (`force: true`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test` then `npm run build`
Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add src/features/ai src/features/shell src/shared/ipc.ts
git commit -m "feat(ai): AI panel with key-gated task list"
```

---

### Task 7: File Target and Definition Target pickers

**Files:**
- Create: `src/features/ai/ScopePicker.tsx`, `src/features/ai/DefinitionPicker.tsx`
- Modify: `src/features/ai/AiPanel.tsx`

**Interfaces:**
- Consumes: `ProjectGraph` folders/files already loaded by `ProjectGraph`, and `FunctionGraph.file.nodes`.
- Produces: `ScopePicker({ folders, files, selected, onChange })` and
  `DefinitionPicker({ nodes, selected, onChange })`.

- [ ] **Step 1: Write the failing tests**

Selecting a folder selects the files beneath it; deselecting every file disables the run button; the Definition
picker lists only top-level Definitions and their members; the chosen ids survive a re-render.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/features/ai`
Expected: FAIL — components undefined.

- [ ] **Step 3: Implement**

Both pickers read payloads the frontend already holds, so no new command is added. Selection is a `Set` of ids in
the AI panel, not in the graph, so graph Selection semantics are untouched.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test` then `npm run build`
Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add src/features/ai
git commit -m "feat(ai): folder and definition scope pickers"
```

---

### Task 8: Project overview and the egress notice

**Files:**
- Modify: `src/features/ai/AiPanel.tsx`, `src/features/shell/App.tsx`

- [ ] **Step 1: Write the failing tests**

Project Overview is offered at the root Scope with a run button rather than firing on open; the first summary for a
project shows which Provider receives the code and requires confirmation once per root; the notice does not
reappear for the same root afterwards.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/features/ai`
Expected: FAIL — overview control undefined.

- [ ] **Step 3: Implement**

Overview runs `Target::Scope { scope: "" }` with signatures and docs. The confirmation is remembered per root in
`localStorage` beside the recents list. Nothing runs automatically.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test` then `npm run build`
Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add src/features/ai src/features/shell
git commit -m "feat(ai): project overview behind an explicit egress notice"
```

---

### Task 9: Record the rules

**Files:**
- Modify: `AGENTS.md`, `docs/HANDOFF.md`, `README.md`, `GLOSSARY.md`

- [ ] **Step 1: Update AGENTS.md** with the AI rules: providers are called only from Rust; the Provider Key never
  crosses IPC and is never cached; `<root>/.scalpel/ai/` is the only writer under `.scalpel/` and ADR-0002 still
  governs layout; the Digest must never be the IPC payload; `PROMPT_VERSION` must be bumped when a template changes.
- [ ] **Step 2: Update HANDOFF.md and README.md** — the AI panel, the egress notice, and the "local-first" wording
  that now needs to be accurate rather than absolute.
- [ ] **Step 3: Commit**

```powershell
git add AGENTS.md docs/HANDOFF.md README.md GLOSSARY.md
git commit -m "docs: record the AI integration rules"
```

---

## Self-Review

**Spec coverage:**

| Spec | Task |
|---|---|
| §4 Digest layers and budgets | 1 |
| §5 Summary Cache | 2 |
| §6 Providers, key handling | 3, 4 |
| §9 UI, gating | 6, 7 |
| §3 F3 Project overview, §8 egress | 8 |
| §11 Testing, §12 success criteria | 1, 2, 5, 6, 7, 8 |
| ADR consequences → AGENTS/HANDOFF/README | 9 |

**Placeholder scan:** no TBD/TODO. F1 explain-selection is reachable at the end of Task 7 (Definition Target plus a
cached `ai_summary`); Tasks 4–5 carry the marker-based architecture a reviewer can follow without further design.

**Type consistency:** `Target`/`Options`/`Digest` are defined in Task 1 and consumed by Task 5's command, Task 6's
frontend wrapper, and Task 7's pickers. `CachedSummary`/`SummaryCache` are defined in Task 2 and used in Task 5.
`PROMPT_VERSION` and `render` are defined in Task 4 and hashed into the key in Task 5 — so Task 4 must land before
Task 5, or the key has no version in it.

## Ordering and checkpoints

- Tasks 1–2 are network-free, dependency-light (one promoted transitive crate), and are the whole token argument:
  land them first and review the Digest text by hand before anything can call a provider.
- Tasks 3–5 add the network and the key. Re-check the "no test performs network I/O" constraint here.
- Tasks 6–8 are frontend only. Task 9 last, once the rules are real.
- After each Rust task: restart `npm run tauri dev` before manual GUI checks.
- Manual check after Task 5 before any UI exists: run `ai_summary` against the fixture project with a real key and
  confirm a second identical call performs no request (temporarily log the provider call site).
