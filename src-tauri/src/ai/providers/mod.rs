pub mod openai;

use std::future::Future;
use std::pin::Pin;

use serde::{Deserialize, Serialize};

use super::prompts::RenderedPrompt;

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

pub struct ProviderSpec {
    pub id: &'static str,
    pub label: &'static str,
    pub base_url: &'static str,
    pub default_model: &'static str,
}

/// v1 providers. Both speak the OpenAI-compatible format, so one client covers
/// them; a provider with its own wire format becomes an adapter beside `openai`.
pub static PROVIDERS: [ProviderSpec; 2] = [
    ProviderSpec {
        id: "openrouter",
        label: "OpenRouter",
        base_url: "https://openrouter.ai/api/v1",
        default_model: "deepseek/deepseek-chat",
    },
    ProviderSpec {
        id: "deepseek",
        label: "DeepSeek",
        base_url: "https://api.deepseek.com",
        default_model: "deepseek-chat",
    },
];

pub fn spec(id: &str) -> Option<&'static ProviderSpec> {
    PROVIDERS.iter().find(|provider| provider.id == id)
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponse {
    pub status: u16,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Completion {
    pub text: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
}

/// The network seam: a test answers a request without one being made.
pub trait Transport: Send + Sync {
    fn post_json<'a>(
        &'a self,
        url: &'a str,
        key: &'a str,
        body: String,
    ) -> BoxFuture<'a, Result<HttpResponse, String>>;
}

pub struct HttpTransport {
    client: reqwest::Client,
}

impl HttpTransport {
    pub fn new() -> Result<HttpTransport, String> {
        reqwest::Client::builder()
            .build()
            .map(|client| HttpTransport { client })
            .map_err(|error| format!("could not start the http client: {error}"))
    }
}

impl Transport for HttpTransport {
    fn post_json<'a>(
        &'a self,
        url: &'a str,
        key: &'a str,
        body: String,
    ) -> BoxFuture<'a, Result<HttpResponse, String>> {
        Box::pin(async move {
            let response = self
                .client
                .post(url)
                .header("authorization", format!("Bearer {key}"))
                .header("content-type", "application/json")
                .body(body)
                .send()
                .await
                .map_err(|error| format!("could not reach the provider: {error}"))?;
            let status = response.status().as_u16();
            let body = response
                .text()
                .await
                .map_err(|error| format!("the provider answer could not be read: {error}"))?;
            Ok(HttpResponse { status, body })
        })
    }
}

pub async fn complete(
    transport: &dyn Transport,
    provider: &ProviderSpec,
    model: &str,
    key: &str,
    prompt: &RenderedPrompt,
) -> Result<Completion, String> {
    if key.trim().is_empty() {
        return Err(format!("add an API key for {}", provider.label));
    }
    if model.trim().is_empty() {
        return Err(format!("choose a model for {}", provider.label));
    }
    let (url, body) = openai::request_for(provider, model.trim(), prompt);
    let response = transport.post_json(&url, key.trim(), body).await?;
    if response.status != 200 {
        return Err(openai::error_for_status(response.status, &response.body));
    }
    openai::parse_response(&response.body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::prompts::{render, Task};
    use std::sync::Mutex;

    #[derive(Default)]
    struct FakeTransport {
        status: u16,
        body: String,
        failure: Option<String>,
        seen: Mutex<Option<(String, String, String)>>,
    }

    impl FakeTransport {
        fn answering(status: u16, body: &str) -> FakeTransport {
            FakeTransport {
                status,
                body: body.to_string(),
                failure: None,
                seen: Mutex::new(None),
            }
        }

        fn unreachable(message: &str) -> FakeTransport {
            FakeTransport {
                status: 0,
                body: String::new(),
                failure: Some(message.to_string()),
                seen: Mutex::new(None),
            }
        }

        fn saw(&self) -> (String, String, String) {
            self.seen.lock().unwrap().clone().unwrap()
        }
    }

    impl Transport for FakeTransport {
        fn post_json<'a>(
            &'a self,
            url: &'a str,
            key: &'a str,
            body: String,
        ) -> BoxFuture<'a, Result<HttpResponse, String>> {
            *self.seen.lock().unwrap() = Some((url.to_string(), key.to_string(), body));
            let failure = self.failure.clone();
            let response = HttpResponse {
                status: self.status,
                body: self.body.clone(),
            };
            Box::pin(async move { failure.map_or(Ok(response), Err) })
        }
    }

    fn prompt() -> RenderedPrompt {
        render(Task::ExplainSelection, "a.py  1L").unwrap()
    }

    fn answer() -> &'static str {
        r#"{"choices":[{"message":{"content":"It walks the graph."}}],"usage":{"prompt_tokens":10,"completion_tokens":5}}"#
    }

    #[test]
    fn resolves_the_providers_wanted_first_and_defers_the_rest() {
        assert_eq!(spec("openrouter").unwrap().label, "OpenRouter");
        assert_eq!(spec("deepseek").unwrap().label, "DeepSeek");
        assert!(spec("anthropic").is_none());
        assert!(spec("ollama").is_none());
    }

    #[test]
    fn a_missing_provider_is_none_rather_than_a_default() {
        assert!(spec("").is_none());
        assert!(spec("OpenRouter").is_none());
    }

    #[test]
    fn sends_a_bearer_request_and_parses_the_answer() {
        let transport = FakeTransport::answering(200, answer());

        let completion = tauri::async_runtime::block_on(complete(
            &transport,
            spec("openrouter").unwrap(),
            "deepseek/deepseek-chat",
            "sk-secret",
            &prompt(),
        ))
        .unwrap();

        assert_eq!(completion.text, "It walks the graph.");
        assert_eq!(completion.input_tokens, 10);
        let (url, key, body) = transport.saw();
        assert_eq!(url, "https://openrouter.ai/api/v1/chat/completions");
        assert_eq!(key, "sk-secret");
        assert!(body.contains("deepseek/deepseek-chat"));
    }

    #[test]
    fn a_rejected_key_reads_as_a_key_problem() {
        let transport = FakeTransport::answering(401, r#"{"error":{"message":"no"}}"#);

        let error = tauri::async_runtime::block_on(complete(
            &transport,
            spec("deepseek").unwrap(),
            "deepseek-chat",
            "sk-wrong",
            &prompt(),
        ))
        .unwrap_err();

        assert!(error.contains("refused the key"), "{error}");
    }

    #[test]
    fn an_unreachable_provider_says_so() {
        let transport = FakeTransport::unreachable("could not reach the provider: dns");

        let error = tauri::async_runtime::block_on(complete(
            &transport,
            spec("deepseek").unwrap(),
            "deepseek-chat",
            "sk-key",
            &prompt(),
        ))
        .unwrap_err();

        assert!(error.contains("could not reach"), "{error}");
    }

    #[test]
    fn refuses_before_building_a_request_without_a_key_or_model() {
        let transport = FakeTransport::answering(200, answer());
        let provider = spec("openrouter").unwrap();

        let no_key = tauri::async_runtime::block_on(complete(
            &transport,
            provider,
            "m",
            "   ",
            &prompt(),
        ))
        .unwrap_err();
        let no_model = tauri::async_runtime::block_on(complete(
            &transport,
            provider,
            "  ",
            "sk-key",
            &prompt(),
        ))
        .unwrap_err();

        assert!(no_key.contains("add an API key for OpenRouter"), "{no_key}");
        assert!(no_model.contains("choose a model for OpenRouter"), "{no_model}");
        assert!(transport.seen.lock().unwrap().is_none());
    }
}
