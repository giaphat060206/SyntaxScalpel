use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};

pub const MAX_ENTRIES: usize = 200;
pub const MAX_BYTES: u64 = 4 * 1024 * 1024;

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
    pub text: String,
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
        self.dir.join(format!("{safe}.json"))
    }

    pub fn get(&self, key: &str) -> Option<CachedSummary> {
        let raw = std::fs::read_to_string(self.path_for(key)).ok()?;
        let entry: CachedSummary = serde_json::from_str(&raw).ok()?;
        (entry.key == key).then_some(entry)
    }

    pub fn put(&self, entry: &CachedSummary) -> Result<(), String> {
        std::fs::create_dir_all(&self.dir)
            .map_err(|error| format!("{}: {error}", self.dir.display()))?;
        let json = serde_json::to_string_pretty(entry).map_err(|error| error.to_string())?;
        let path = self.path_for(&entry.key);
        std::fs::write(&path, json).map_err(|error| format!("{}: {error}", path.display()))
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
            .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
            .map(|path| {
                let size = std::fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
                let created_at = std::fs::read_to_string(&path)
                    .ok()
                    .and_then(|raw| serde_json::from_str::<CachedSummary>(&raw).ok())
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
