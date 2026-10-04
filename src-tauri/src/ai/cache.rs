use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};

pub const MAX_ENTRIES: usize = 200;
pub const MAX_BYTES: u64 = 4 * 1024 * 1024;

/// One summary of one project. The metadata above the body is what makes a
/// stored file readable on its own, so the store doubles as somewhere a person
/// can browse — and edit, since a hand-written body is served like any other.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedSummary {
    pub key: String,
    pub task: String,
    pub provider: String,
    pub model: String,
    pub prompt_version: u32,
    pub created_at_ms: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub text: String,
}

const FRONT_MATTER: &str = "---";

/// The one place an entry is turned into text, so a stored file and an exported
/// file cannot drift apart.
pub fn render(entry: &CachedSummary) -> Result<String, String> {
    let metadata = CachedSummary { text: String::new(), ..entry.clone() };
    let header = serde_norway::to_string(&metadata).map_err(|error| error.to_string())?;
    Ok(format!("{FRONT_MATTER}\n{header}{FRONT_MATTER}\n\n{}\n", entry.text.trim_end()))
}

/// Reads what `render` wrote. Anything else — a legacy JSON entry, a hand-edited
/// file whose header no longer parses — is simply not an entry.
pub fn parse(raw: &str) -> Option<CachedSummary> {
    let mut header = String::new();
    let mut offset = 0;
    let mut closed = false;
    for line in raw.split_inclusive('\n') {
        if offset == 0 {
            if line.trim_end() != FRONT_MATTER {
                return None;
            }
        } else if line.trim_end() == FRONT_MATTER {
            closed = true;
            offset += line.len();
            break;
        } else {
            header.push_str(line);
        }
        offset += line.len();
    }
    if !closed {
        return None;
    }
    let mut entry: CachedSummary = serde_norway::from_str(&header).ok()?;
    entry.text = raw[offset..].trim_matches('\n').to_string();
    Some(entry)
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

/// Summaries of one project, keyed by the prompt they were generated from, under
/// `<root>/.scalpel/ai/`.
pub struct SummaryCache {
    dir: PathBuf,
}

impl SummaryCache {
    pub fn new(root: &str) -> SummaryCache {
        SummaryCache { dir: Path::new(root).join(".scalpel").join("ai") }
    }

    /// Content-addressed, so a summary is reused only for the exact input it was
    /// generated from. Nothing about the caller's policy is hashed here.
    pub fn key_for(prompt: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(prompt.as_bytes());
        format!("{:x}", hasher.finalize())
    }

    pub fn path_for(&self, key: &str) -> PathBuf {
        let safe: String = key.chars().filter(char::is_ascii_hexdigit).collect();
        self.dir.join(format!("{safe}.md"))
    }

    pub fn get(&self, key: &str) -> Option<CachedSummary> {
        let raw = std::fs::read_to_string(self.path_for(key)).ok()?;
        let entry = parse(&raw)?;
        (entry.key == key).then_some(entry)
    }

    pub fn put(&self, entry: &CachedSummary) -> Result<(), String> {
        std::fs::create_dir_all(&self.dir)
            .map_err(|error| format!("{}: {error}", self.dir.display()))?;
        let path = self.path_for(&entry.key);
        std::fs::write(&path, render(entry)?).map_err(|error| format!("{}: {error}", path.display()))
    }

    pub fn len(&self) -> usize {
        self.entries().len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Drops entries oldest first until both limits hold, returning how many went.
    pub fn evict(&self, max_entries: usize, max_bytes: u64) -> Result<usize, String> {
        let mut entries = self.entries();
        entries.sort_by_key(|(_, created_at, _)| *created_at);
        let mut count = entries.len();
        let mut bytes: u64 = entries.iter().map(|(_, _, size)| *size).sum();
        let mut removed = 0;
        for (path, _, size) in entries {
            if count <= max_entries && bytes <= max_bytes {
                break;
            }
            std::fs::remove_file(&path).map_err(|error| format!("{}: {error}", path.display()))?;
            count -= 1;
            bytes = bytes.saturating_sub(size);
            removed += 1;
        }
        Ok(removed)
    }

    fn entries(&self) -> Vec<(PathBuf, u64, u64)> {
        let Ok(dir) = std::fs::read_dir(&self.dir) else {
            return Vec::new();
        };
        dir.filter_map(|item| item.ok())
            .map(|item| item.path())
            .filter(|path| {
                matches!(
                    path.extension().and_then(|ext| ext.to_str()),
                    Some("md") | Some("json")
                )
            })
            .map(|path| {
                let size = std::fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
                let created_at = std::fs::read_to_string(&path)
                    .ok()
                    .and_then(|raw| parse(&raw))
                    .map(|entry| entry.created_at_ms)
                    .unwrap_or(0);
                (path, created_at, size)
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("scalpel-cache-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn entry(key: &str, text: &str) -> CachedSummary {
        CachedSummary {
            key: key.to_string(),
            task: "explain-selection".into(),
            provider: "openrouter".into(),
            model: "deepseek/deepseek-chat".into(),
            prompt_version: 1,
            created_at_ms: now_ms(),
            input_tokens: 10,
            output_tokens: 20,
            text: text.to_string(),
        }
    }

    #[test]
    fn stores_markdown_a_person_can_open() {
        let root = fixture("markdown");
        let cache = SummaryCache::new(root.to_str().unwrap());
        let key = SummaryCache::key_for("prompt text");

        cache.put(&entry(&key, "## What it does\n\nIt returns a path.")).unwrap();
        let raw = std::fs::read_to_string(cache.path_for(&key)).unwrap();

        assert!(cache.path_for(&key).extension().unwrap() == "md");
        assert!(raw.starts_with("---\n"), "{raw}");
        assert!(raw.contains("task: explain-selection"), "{raw}");
        assert!(raw.contains(&format!("key: {key}")), "{raw}");
        assert!(raw.contains("promptVersion: 1"), "{raw}");
        assert!(raw.ends_with("It returns a path.\n"), "{raw}");
        assert!(!raw.contains("text:"), "the body is not repeated in the header: {raw}");
    }

    #[test]
    fn keeps_a_body_that_contains_a_delimiter() {
        let root = fixture("delimiter");
        let cache = SummaryCache::new(root.to_str().unwrap());
        let key = SummaryCache::key_for("prompt text");
        let body = "before\n\n---\n\nafter";

        cache.put(&entry(&key, body)).unwrap();

        assert_eq!(cache.get(&key).unwrap().text, body);
    }

    #[test]
    fn round_trips_every_field() {
        let root = fixture("fields");
        let cache = SummaryCache::new(root.to_str().unwrap());
        let key = SummaryCache::key_for("prompt text");
        let mut original = entry(&key, "body");
        original.created_at_ms = 1_790_000_000_000;
        original.input_tokens = 812;
        original.output_tokens = 431;

        cache.put(&original).unwrap();

        assert_eq!(cache.get(&key).unwrap(), original);
    }

    #[test]
    fn a_legacy_json_entry_is_swept_before_a_current_one() {
        let root = fixture("legacy");
        let cache = SummaryCache::new(root.to_str().unwrap());
        let key = SummaryCache::key_for("prompt text");
        let mut current = entry(&key, "body");
        current.created_at_ms = 5_000;
        cache.put(&current).unwrap();
        std::fs::write(
            cache.dir.join("deadbeef.json"),
            r#"{"key":"deadbeef","createdAtMs":1}"#,
        )
        .unwrap();

        assert_eq!(cache.len(), 2);
        assert_eq!(cache.evict(1, u64::MAX).unwrap(), 1);
        assert!(cache.get(&key).is_some());
        assert!(!cache.dir.join("deadbeef.json").exists());
    }

    #[test]
    fn round_trips_an_entry() {
        let root = fixture("roundtrip");
        let cache = SummaryCache::new(root.to_str().unwrap());
        let key = SummaryCache::key_for("prompt text");

        cache.put(&entry(&key, "hello")).unwrap();

        assert_eq!(cache.get(&key).unwrap().text, "hello");
        assert_eq!(cache.len(), 1);
    }

    #[test]
    fn a_changed_prompt_misses() {
        let root = fixture("miss");
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
        let root = fixture("corrupt");
        let cache = SummaryCache::new(root.to_str().unwrap());
        let key = SummaryCache::key_for("broken");
        cache.put(&entry(&key, "fine")).unwrap();
        std::fs::write(cache.path_for(&key), "{ not json").unwrap();

        assert!(cache.get(&key).is_none());
        assert_eq!(cache.len(), 1);
    }

    #[test]
    fn evicts_oldest_first_by_count() {
        let root = fixture("evict");
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
    fn evicts_by_total_bytes() {
        let root = fixture("evict-bytes");
        let cache = SummaryCache::new(root.to_str().unwrap());
        for index in 0..4u64 {
            let mut value = entry(&SummaryCache::key_for(&format!("b{index}")), &"x".repeat(200));
            value.created_at_ms = index;
            cache.put(&value).unwrap();
        }

        cache.evict(MAX_ENTRIES, 400).unwrap();

        assert!(cache.len() < 4);
    }

    #[test]
    fn never_writes_outside_the_project() {
        let root = fixture("anchored");
        let cache = SummaryCache::new(root.to_str().unwrap());
        let outside = cache.path_for("../../escape");

        assert!(outside.starts_with(root.join(".scalpel").join("ai")), "{}", outside.display());
    }

    #[test]
    fn a_missing_directory_reads_as_empty() {
        let root = fixture("missing");
        let cache = SummaryCache::new(root.to_str().unwrap());

        assert!(cache.get("anything").is_none());
        assert!(cache.is_empty());
        assert_eq!(cache.evict(MAX_ENTRIES, MAX_BYTES).unwrap(), 0);
    }
}
