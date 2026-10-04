use serde::Serialize;

const SERVICE: &str = "SyntaxScalpel";

/// Where a Provider Key lives. The trait exists so tests never touch the OS
/// credential store, and so a hidden key never has to be serialised to be checked.
pub trait SecretStore: Send + Sync {
    fn get(&self, provider: &str) -> Option<String>;
    fn set(&self, provider: &str, key: &str) -> Result<(), String>;
    fn delete(&self, provider: &str) -> Result<(), String>;
}

/// What the UI is allowed to know: which Provider, and whether a key exists.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettings {
    pub provider: String,
    pub has_key: bool,
}

/// The OS keyring: Windows Credential Manager, Keychain, or Secret Service.
pub struct KeyringStore;

impl SecretStore for KeyringStore {
    fn get(&self, provider: &str) -> Option<String> {
        keyring::Entry::new(SERVICE, provider).ok()?.get_password().ok()
    }

    fn set(&self, provider: &str, key: &str) -> Result<(), String> {
        let entry = keyring::Entry::new(SERVICE, provider).map_err(|error| error.to_string())?;
        entry.set_password(key).map_err(|error| error.to_string())
    }

    fn delete(&self, provider: &str) -> Result<(), String> {
        let entry = keyring::Entry::new(SERVICE, provider).map_err(|error| error.to_string())?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }
}

fn settings_with(store: &dyn SecretStore, provider: &str) -> AiSettings {
    AiSettings {
        provider: provider.to_string(),
        has_key: store.get(provider).is_some(),
    }
}

fn set_key_with(store: &dyn SecretStore, provider: &str, key: &str) -> Result<AiSettings, String> {
    let provider = provider.trim();
    if provider.is_empty() {
        return Err("a provider is required".to_string());
    }
    let key = key.trim();
    if key.is_empty() {
        return Err(format!("an API key is required for {provider}"));
    }
    store.set(provider, key)?;
    Ok(settings_with(store, provider))
}

fn clear_key_with(store: &dyn SecretStore, provider: &str) -> Result<AiSettings, String> {
    let provider = provider.trim();
    store.delete(provider)?;
    Ok(settings_with(store, provider))
}

pub fn settings(provider: &str) -> AiSettings {
    settings_with(&KeyringStore, provider)
}

pub fn set_key(provider: &str, key: &str) -> Result<AiSettings, String> {
    set_key_with(&KeyringStore, provider, key)
}

pub fn clear_key(provider: &str) -> Result<AiSettings, String> {
    clear_key_with(&KeyringStore, provider)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::sync::Mutex;

    #[derive(Default)]
    struct FakeStore {
        values: Mutex<BTreeMap<String, String>>,
    }

    impl SecretStore for FakeStore {
        fn get(&self, provider: &str) -> Option<String> {
            self.values.lock().unwrap().get(provider).cloned()
        }

        fn set(&self, provider: &str, key: &str) -> Result<(), String> {
            self.values
                .lock()
                .unwrap()
                .insert(provider.to_string(), key.to_string());
            Ok(())
        }

        fn delete(&self, provider: &str) -> Result<(), String> {
            self.values.lock().unwrap().remove(provider);
            Ok(())
        }
    }

    #[test]
    fn reports_no_key_until_one_is_set() {
        let store = FakeStore::default();

        assert!(!settings_with(&store, "openrouter").has_key);
        set_key_with(&store, "openrouter", "sk-or-123").unwrap();
        assert!(settings_with(&store, "openrouter").has_key);
    }

    #[test]
    fn a_key_is_per_provider() {
        let store = FakeStore::default();

        set_key_with(&store, "openrouter", "one").unwrap();

        assert!(!settings_with(&store, "deepseek").has_key);
    }

    #[test]
    fn clearing_removes_the_key() {
        let store = FakeStore::default();
        set_key_with(&store, "openrouter", "one").unwrap();

        let settings = clear_key_with(&store, "openrouter").unwrap();

        assert!(!settings.has_key);
        assert!(store.get("openrouter").is_none());
    }

    #[test]
    fn clearing_a_key_that_is_not_there_is_not_an_error() {
        let store = FakeStore::default();

        assert!(!clear_key_with(&store, "deepseek").unwrap().has_key);
    }

    #[test]
    fn settings_never_carry_the_key() {
        let store = FakeStore::default();
        set_key_with(&store, "openrouter", "sk-secret-value").unwrap();

        let json = serde_json::to_string(&settings_with(&store, "openrouter")).unwrap();

        assert_eq!(json, r#"{"provider":"openrouter","hasKey":true}"#);
        assert!(!json.contains("sk-secret-value"));
    }

    #[test]
    fn rejects_an_empty_provider_or_key() {
        let store = FakeStore::default();

        assert!(set_key_with(&store, "   ", "key").is_err());
        assert!(set_key_with(&store, "openrouter", "   ").is_err());
        assert!(store.get("openrouter").is_none());
    }

    #[test]
    fn trims_what_it_stores() {
        let store = FakeStore::default();

        set_key_with(&store, " openrouter ", "  sk-padded \n").unwrap();

        assert_eq!(store.get("openrouter").unwrap(), "sk-padded");
        assert!(settings_with(&store, "openrouter").has_key);
    }
}
