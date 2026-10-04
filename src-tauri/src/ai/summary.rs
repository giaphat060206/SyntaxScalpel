use serde::{Deserialize, Serialize};

use super::cache::{self, CachedSummary, SummaryCache};
use super::digest::{self, Digest, Options, Target};
use super::prompts::{self, Task};
use super::providers::{self, Completion, Transport};
use super::settings::SecretStore;

/// What the frontend gets back: the answer, and enough to be honest about where
/// it came from and what it cost.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSummary {
    /// The content-addressed key, so the answer can be exported from the store
    /// rather than from a copy the frontend happens to hold.
    pub key: String,
    pub text: String,
    pub task: String,
    pub provider: String,
    pub model: String,
    pub cached: bool,
    pub truncated: bool,
    pub created_at_ms: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
}

fn resolved_model<'a>(provider: &providers::ProviderSpec, model: &'a str) -> &'a str {
    if model.trim().is_empty() {
        provider.default_model
    } else {
        model.trim()
    }
}

/// What a request settles to before any provider is involved: the Digest it would
/// send, the prompt rendered from it, and the store key the answer lives under.
struct Resolved {
    task: Task,
    provider: &'static providers::ProviderSpec,
    model: String,
    digest: Digest,
    prompt: prompts::RenderedPrompt,
    key: String,
}

/// One place that decides what a request means. `summarize` and `is_cached` both
/// go through it, which is what makes a mark in the panel agree with the click it
/// invites: same Target, same layers, same key.
fn resolve(
    root: &str,
    target: &Target,
    options: Option<&Options>,
    task_id: &str,
    provider_id: &str,
    model: &str,
) -> Result<Resolved, String> {
    let task = Task::from_id(task_id).ok_or_else(|| format!("unknown AI task: {task_id}"))?;
    let provider =
        providers::spec(provider_id).ok_or_else(|| format!("unknown provider: {provider_id}"))?;
    let model = resolved_model(provider, model).to_string();
    let options = options.cloned().unwrap_or_else(|| prompts::default_options(task));
    let digest = digest::build(root, target, &options)?;
    let prompt = prompts::render(task, &digest.text)?;
    let key = SummaryCache::key_for(&prompts::cache_input(provider.id, &model, &prompt));
    Ok(Resolved { task, provider, model, digest, prompt, key })
}

/// Whether the store already holds the answer this request would be served.
///
/// The mark a panel shows has to be the same question as the click it invites, so
/// this recomputes the key rather than remembering that something was generated:
/// after an edit the code no longer hashes the same, and the mark goes away by
/// itself. It reads the store and nothing else — no key, no provider, no network.
pub fn is_cached(
    root: &str,
    target: &Target,
    options: Option<&Options>,
    task_id: &str,
    provider_id: &str,
    model: &str,
) -> Result<bool, String> {
    let resolved = resolve(root, target, options, task_id, provider_id, model)?;
    Ok(SummaryCache::new(root).get(&resolved.key).is_some())
}

/// Digest, then cache, then provider — in that order, so a cached answer costs
/// nothing and needs no key.
#[allow(clippy::too_many_arguments)]
pub async fn summarize(
    root: &str,
    target: &Target,
    options: Option<&Options>,
    task_id: &str,
    provider_id: &str,
    model: &str,
    force: bool,
    secrets: &dyn SecretStore,
    transport: &dyn Transport,
) -> Result<AiSummary, String> {
    let resolved = resolve(root, target, options, task_id, provider_id, model)?;
    let store = SummaryCache::new(root);

    if !force {
        if let Some(entry) = store.get(&resolved.key) {
            return Ok(answer(&entry, &resolved.digest, true));
        }
    }

    let api_key = secrets
        .get(resolved.provider.id)
        .ok_or_else(|| format!("add an API key for {}", resolved.provider.label))?;
    let completion: Completion = providers::complete(
        transport,
        resolved.provider,
        &resolved.model,
        &api_key,
        &resolved.prompt,
    )
    .await?;
    let entry = CachedSummary {
        key: resolved.key,
        task: resolved.task.id().to_string(),
        provider: resolved.provider.id.to_string(),
        model: resolved.model,
        prompt_version: prompts::PROMPT_VERSION,
        created_at_ms: cache::now_ms(),
        input_tokens: completion.input_tokens,
        output_tokens: completion.output_tokens,
        text: completion.text,
    };

    // Best effort: a project that cannot be written to must still get an answer.
    if store.put(&entry).is_ok() {
        let _ = store.evict(cache::MAX_ENTRIES, cache::MAX_BYTES);
    }
    Ok(answer(&entry, &resolved.digest, false))
}

fn answer(entry: &CachedSummary, digest: &Digest, cached: bool) -> AiSummary {
    AiSummary {
        key: entry.key.clone(),
        text: entry.text.clone(),
        task: entry.task.clone(),
        provider: entry.provider.clone(),
        model: entry.model.clone(),
        cached,
        truncated: digest.truncated,
        created_at_ms: entry.created_at_ms,
        input_tokens: entry.input_tokens,
        output_tokens: entry.output_tokens,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::settings::SecretStore;
    use std::collections::BTreeMap;
    use std::path::{Path, PathBuf};
    use std::sync::Mutex;

    const ANSWER: &str = r#"{"choices":[{"message":{"content":"It returns a path."}}],"usage":{"prompt_tokens":100,"completion_tokens":20}}"#;

    fn fixture(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("scalpel-summary-{name}-{}", std::process::id()));
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

    #[derive(Default)]
    struct FakeStore {
        values: BTreeMap<String, String>,
    }

    impl SecretStore for FakeStore {
        fn get(&self, provider: &str) -> Option<String> {
            self.values.get(provider).cloned()
        }

        fn set(&self, provider: &str, key: &str) -> Result<(), String> {
            let _ = (provider, key);
            Ok(())
        }

        fn delete(&self, _provider: &str) -> Result<(), String> {
            Ok(())
        }
    }

    fn with_key(provider: &str) -> FakeStore {
        let mut store = FakeStore::default();
        store.values.insert(provider.to_string(), "sk-test".to_string());
        store
    }

    #[derive(Default)]
    struct FakeTransport {
        status: u16,
        body: String,
        calls: Mutex<Vec<String>>,
    }

    /// Asks exactly the way the panel does: default layers, no forcing, and any
    /// Target rather than the module's fixture one.
    fn ask(
        root: &Path,
        target: &Target,
        args: (&str, &str, &str),
        force: bool,
        store: &FakeStore,
        transport: &FakeTransport,
    ) -> AiSummary {
        let (task, provider, model) = args;
        tauri::async_runtime::block_on(summarize(
            root.to_str().unwrap(),
            target,
            None,
            task,
            provider,
            model,
            force,
            store,
            transport,
        ))
        .unwrap()
    }

    /// The mark the panel would show, derived from the store alone.
    fn cached(root: &Path, target: &Target, args: (&str, &str, &str)) -> Result<bool, String> {
        let (task, provider, model) = args;
        is_cached(root.to_str().unwrap(), target, None, task, provider, model)
    }

    impl FakeTransport {
        fn answering(status: u16, body: &str) -> FakeTransport {
            FakeTransport {
                status,
                body: body.to_string(),
                calls: Mutex::new(Vec::new()),
            }
        }

        fn call_count(&self) -> usize {
            self.calls.lock().unwrap().len()
        }
    }

    impl Transport for FakeTransport {
        fn post_json<'a>(
            &'a self,
            _url: &'a str,
            _key: &'a str,
            body: String,
        ) -> providers::BoxFuture<'a, Result<providers::HttpResponse, String>> {
            self.calls.lock().unwrap().push(body);
            let response = providers::HttpResponse {
                status: self.status,
                body: self.body.clone(),
            };
            Box::pin(async move { Ok(response) })
        }
    }

    fn target() -> Target {
        Target::Definitions { file: "a.py".into(), ids: vec!["one".into()] }
    }

    fn options() -> Options {
        Options { signatures: true, bodies: true, docs: false }
    }

    fn run(
        root: &Path,
        transport: &FakeTransport,
        store: &FakeStore,
        force: bool,
    ) -> Result<AiSummary, String> {
        tauri::async_runtime::block_on(summarize(
            root.to_str().unwrap(),
            &target(),
            Some(&options()),
            "explain-selection",
            "openrouter",
            "",
            force,
            store,
            transport,
        ))
    }

    #[test]
    fn a_first_call_reaches_the_provider_and_the_second_does_not() {
        let root = fixture("cached");
        write(&root, "a.py", "def one():\n    return 1\n");
        let transport = FakeTransport::answering(200, ANSWER);
        let store = with_key("openrouter");

        let first = run(&root, &transport, &store, false).unwrap();
        let second = run(&root, &transport, &store, false).unwrap();

        assert!(!first.cached);
        assert_eq!(first.text, "It returns a path.");
        assert_eq!(first.input_tokens, 100);
        assert_eq!(first.model, "deepseek/deepseek-chat");
        assert!(second.cached);
        assert_eq!(second.text, first.text);
        assert_eq!(second.created_at_ms, first.created_at_ms);
        assert_eq!(transport.call_count(), 1);
    }

    #[test]
    fn force_asks_again_and_refreshes() {
        let root = fixture("force");
        write(&root, "a.py", "def one():\n    return 1\n");
        let transport = FakeTransport::answering(200, ANSWER);
        let store = with_key("openrouter");

        run(&root, &transport, &store, false).unwrap();
        let forced = run(&root, &transport, &store, true).unwrap();

        assert!(!forced.cached);
        assert_eq!(transport.call_count(), 2);
    }

    #[test]
    fn changing_the_selected_definition_misses() {
        let root = fixture("changed");
        write(&root, "a.py", "def one():\n    return 1\n");
        let transport = FakeTransport::answering(200, ANSWER);
        let store = with_key("openrouter");

        run(&root, &transport, &store, false).unwrap();
        write(&root, "a.py", "def one():\n    return 2\n");
        let after = run(&root, &transport, &store, false).unwrap();

        assert!(!after.cached);
        assert_eq!(transport.call_count(), 2);
    }

    #[test]
    fn a_change_outside_the_selection_still_hits() {
        let root = fixture("unrelated");
        write(&root, "a.py", "def one():\n    return 1\n\n\ndef other():\n    return 9\n");
        let transport = FakeTransport::answering(200, ANSWER);
        let store = with_key("openrouter");

        run(&root, &transport, &store, false).unwrap();
        write(&root, "a.py", "def one():\n    return 1\n\n\ndef other():\n    return 99\n");
        write(&root, "b.py", "def elsewhere():\n    return 3\n");
        let after = run(&root, &transport, &store, false).unwrap();

        assert!(after.cached);
        assert_eq!(transport.call_count(), 1);
    }

    #[test]
    fn a_different_provider_or_model_is_a_different_answer() {
        let root = fixture("provider");
        write(&root, "a.py", "def one():\n    return 1\n");
        let transport = FakeTransport::answering(200, ANSWER);
        let store = with_key("openrouter");

        run(&root, &transport, &store, false).unwrap();
        let other = tauri::async_runtime::block_on(summarize(
            root.to_str().unwrap(),
            &target(),
            Some(&options()),
            "explain-selection",
            "openrouter",
            "some/other-model",
            false,
            &store,
            &transport,
        ))
        .unwrap();

        assert!(!other.cached);
        assert_eq!(transport.call_count(), 2);
    }

    #[test]
    fn a_different_task_is_a_different_answer() {
        let root = fixture("task");
        write(&root, "a.py", "def one():\n    return 1\n");
        let transport = FakeTransport::answering(200, ANSWER);
        let store = with_key("openrouter");

        run(&root, &transport, &store, false).unwrap();
        let impact = tauri::async_runtime::block_on(summarize(
            root.to_str().unwrap(),
            &target(),
            Some(&options()),
            "impact",
            "openrouter",
            "",
            false,
            &store,
            &transport,
        ))
        .unwrap();

        assert!(!impact.cached);
        assert_eq!(impact.task, "impact");
    }

    #[test]
    fn refuses_without_a_key_before_asking_anyone() {
        let root = fixture("no-key");
        write(&root, "a.py", "def one():\n    return 1\n");
        let transport = FakeTransport::answering(200, ANSWER);
        let store = FakeStore::default();

        let error = run(&root, &transport, &store, false).unwrap_err();

        assert!(error.contains("add an API key for OpenRouter"), "{error}");
        assert_eq!(transport.call_count(), 0);
    }

    #[test]
    fn a_cached_answer_needs_no_key() {
        let root = fixture("cached-no-key");
        write(&root, "a.py", "def one():\n    return 1\n");
        let transport = FakeTransport::answering(200, ANSWER);

        run(&root, &transport, &with_key("openrouter"), false).unwrap();
        let without = run(&root, &transport, &FakeStore::default(), false).unwrap();

        assert!(without.cached);
    }

    #[test]
    fn refuses_an_unknown_task_or_provider() {
        let root = fixture("unknown");
        write(&root, "a.py", "def one():\n    return 1\n");
        let transport = FakeTransport::answering(200, ANSWER);
        let store = with_key("openrouter");

        let task = tauri::async_runtime::block_on(summarize(
            root.to_str().unwrap(),
            &target(),
            Some(&options()),
            "explain-everything",
            "openrouter",
            "",
            false,
            &store,
            &transport,
        ))
        .unwrap_err();
        let provider = tauri::async_runtime::block_on(summarize(
            root.to_str().unwrap(),
            &target(),
            Some(&options()),
            "impact",
            "anthropic",
            "",
            false,
            &store,
            &transport,
        ))
        .unwrap_err();

        assert!(task.contains("unknown AI task"), "{task}");
        assert!(provider.contains("unknown provider"), "{provider}");
        assert_eq!(transport.call_count(), 0);
    }

    #[test]
    fn a_project_that_cannot_be_written_to_still_gets_an_answer() {
        let root = fixture("read-only");
        write(&root, "a.py", "def one():\n    return 1\n");
        std::fs::create_dir_all(root.join(".scalpel")).unwrap();
        std::fs::write(root.join(".scalpel").join("ai"), "not a directory").unwrap();
        let transport = FakeTransport::answering(200, ANSWER);
        let store = with_key("openrouter");

        let first = run(&root, &transport, &store, false).unwrap();
        let second = run(&root, &transport, &store, false).unwrap();

        assert_eq!(first.text, "It returns a path.");
        assert!(!second.cached);
        assert_eq!(transport.call_count(), 2);
    }

    #[test]
    fn a_missing_options_uses_what_the_task_needs() {
        let root = fixture("default-options");
        write(&root, "a.py", "def one(x):\n    return x\n");
        let transport = FakeTransport::answering(200, ANSWER);
        let store = with_key("openrouter");

        let overview = tauri::async_runtime::block_on(summarize(
            root.to_str().unwrap(),
            &Target::Scope { scope: String::new() },
            None,
            "project-overview",
            "openrouter",
            "",
            false,
            &store,
            &transport,
        ))
        .unwrap();
        let sent = transport.calls.lock().unwrap().last().unwrap().clone();
        assert!(overview.task == "project-overview");
        assert!(!sent.contains("one(x)"), "signatures should be off: {sent}");

        let selection = tauri::async_runtime::block_on(summarize(
            root.to_str().unwrap(),
            &Target::Definitions { file: "a.py".into(), ids: vec!["one".into()] },
            None,
            "explain-selection",
            "openrouter",
            "",
            false,
            &store,
            &transport,
        ))
        .unwrap();
        let sent = transport.calls.lock().unwrap().last().unwrap().clone();
        assert!(selection.task == "explain-selection");
        assert!(sent.contains("return x"), "bodies should be on: {sent}");
    }

    #[test]
    fn picking_a_definition_from_the_caller_reuses_the_answer_from_its_own_file() {
        let root = fixture("reuse");
        write(&root, "a.py", "def one():\n    two()\n");
        write(&root, "b.py", "def two():\n    return 2\n");
        let transport = FakeTransport::answering(200, ANSWER);
        let store = with_key("openrouter");

        let in_its_own_file = tauri::async_runtime::block_on(summarize(
            root.to_str().unwrap(),
            &Target::Definitions { file: "b.py".into(), ids: vec!["two".into()] },
            Some(&options()),
            "explain-selection",
            "openrouter",
            "",
            false,
            &store,
            &transport,
        ))
        .unwrap();
        // The id a Cross-file Block carries in a.py, reaching the same Definition.
        let from_the_caller = tauri::async_runtime::block_on(summarize(
            root.to_str().unwrap(),
            &Target::Definitions { file: "a.py".into(), ids: vec!["b.py::two".into()] },
            Some(&options()),
            "explain-selection",
            "openrouter",
            "",
            false,
            &store,
            &transport,
        ))
        .unwrap();

        assert!(!in_its_own_file.cached);
        assert!(from_the_caller.cached, "should have reused the answer");
        assert_eq!(from_the_caller.text, in_its_own_file.text);
        assert_eq!(transport.call_count(), 1);
    }

    #[test]
    fn a_connection_summary_is_answered_once_and_then_reused() {
        let root = fixture("connection-reuse");
        write(&root, "a.py", "from b import two\n\n\ndef one():\n    two()\n");
        write(&root, "b.py", "def two():\n    return 2\n");
        let transport = FakeTransport::answering(200, ANSWER);
        let store = with_key("openrouter");
        let target = Target::Connection {
            source: "a.py::one".into(),
            target: "b.py::two".into(),
        };

        let run = |force: bool| {
            tauri::async_runtime::block_on(summarize(
                root.to_str().unwrap(),
                &target,
                None,
                "relationship",
                "openrouter",
                "",
                force,
                &store,
                &transport,
            ))
            .unwrap()
        };

        let first = run(false);
        let second = run(false);

        assert_eq!(first.task, "relationship");
        assert!(!first.cached);
        assert!(second.cached);
        assert_eq!(second.text, first.text);
        assert_eq!(transport.call_count(), 1);
        let sent = transport.calls.lock().unwrap().last().unwrap().clone();
        assert!(sent.contains("calls at 5: two()"), "{sent}");
    }

    #[test]
    fn the_mark_agrees_with_the_click_it_invites() {
        let root = fixture("marks-match");
        write(&root, "a.py", "def one():\n    return 1\n");
        write(&root, "b.py", "def two():\n    return 2\n");
        let transport = FakeTransport::answering(200, ANSWER);
        let store = with_key("openrouter");
        let target = Target::Files { scope: "".into(), files: vec!["a.py".into()] };
        let args = ("explain-selection", "openrouter", "deepseek/deepseek-chat");

        // Nothing generated yet: no mark, and a click would have to pay.
        assert!(!cached(&root, &target, args).unwrap());

        let first = ask(&root, &target, args, false, &store, &transport);
        assert!(!first.cached);

        // Now the mark holds, and a click is served from the store instead.
        assert!(cached(&root, &target, args).unwrap());
        let second = ask(&root, &target, args, false, &store, &transport);
        assert!(second.cached);
        assert_eq!(second.text, first.text);
        assert_eq!(transport.call_count(), 1);
    }

    #[test]
    fn changing_what_the_digest_covers_takes_the_mark_away() {
        let root = fixture("marks-stale");
        write(&root, "a.py", "def one():\n    return 1\n");
        let transport = FakeTransport::answering(200, ANSWER);
        let store = with_key("openrouter");
        let target = Target::Files { scope: "".into(), files: vec!["a.py".into()] };
        let args = ("explain-selection", "openrouter", "deepseek/deepseek-chat");

        ask(&root, &target, args, false, &store, &transport);
        assert!(cached(&root, &target, args).unwrap());

        write(&root, "a.py", "def one():\n    return 1\n\n\ndef two():\n    return 2\n");

        assert!(!cached(&root, &target, args).unwrap());
    }

    #[test]
    fn an_edit_the_digest_ignores_keeps_the_mark() {
        // A File Target is answered from structure and signatures, so a body-only
        // edit leaves the question — and so the answer — exactly as it was. Only
        // what the Task pays for can invalidate it.
        let root = fixture("marks-body");
        write(&root, "a.py", "def one():\n    return 1\n");
        let transport = FakeTransport::answering(200, ANSWER);
        let store = with_key("openrouter");
        let target = Target::Files { scope: "".into(), files: vec!["a.py".into()] };
        let args = ("explain-selection", "openrouter", "deepseek/deepseek-chat");

        ask(&root, &target, args, false, &store, &transport);
        write(&root, "a.py", "def one():\n    return 99\n");

        assert!(cached(&root, &target, args).unwrap());
    }

    #[test]
    fn the_mark_needs_no_key() {
        let root = fixture("marks-keyless");
        write(&root, "a.py", "def one():\n    return 1\n");
        let transport = FakeTransport::answering(200, ANSWER);
        let target = Target::Files { scope: "".into(), files: vec!["a.py".into()] };
        let args = ("explain-selection", "openrouter", "deepseek/deepseek-chat");
        ask(&root, &target, args, false, &with_key("openrouter"), &transport);

        // A stored answer is readable with no key held at all: reading it is local.
        assert!(cached(&root, &target, args).unwrap());
        assert!(cached(&root, &target, args).is_ok());
    }

    #[test]
    fn a_mark_needs_a_task_and_a_provider_that_exist() {
        let root = fixture("marks-unknown");
        write(&root, "a.py", "def one():\n    return 1\n");
        let target = Target::Files { scope: "".into(), files: vec!["a.py".into()] };

        let error = cached(&root, &target, ("not-a-task", "openrouter", "")).unwrap_err();
        assert!(error.contains("unknown AI task"), "{error}");

        let error = cached(&root, &target, ("impact", "not-a-provider", "")).unwrap_err();
        assert!(error.contains("unknown provider"), "{error}");
    }

    #[test]
    fn reports_that_the_digest_was_truncated() {
        let root = fixture("truncated");
        let mut source = String::new();
        for index in 0..4_000 {
            source.push_str(&format!("def f{index}():\n    pass\n\n\n"));
        }
        write(&root, "big.py", &source);
        let transport = FakeTransport::answering(200, ANSWER);
        let store = with_key("openrouter");

        let summary = tauri::async_runtime::block_on(summarize(
            root.to_str().unwrap(),
            &Target::Scope { scope: String::new() },
            None,
            "project-overview",
            "openrouter",
            "",
            false,
            &store,
            &transport,
        ))
        .unwrap();

        assert!(summary.truncated);
    }
}
