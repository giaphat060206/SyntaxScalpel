use super::super::prompts::RenderedPrompt;
use super::{Completion, ProviderSpec};

/// The OpenAI-compatible wire format, which OpenRouter, DeepSeek and Ollama all
/// speak: bearer authorization, a chat-completions path, and the same body.
pub fn request_for(
    provider: &ProviderSpec,
    model: &str,
    prompt: &RenderedPrompt,
) -> (String, String) {
    let url = format!("{}/chat/completions", provider.base_url.trim_end_matches('/'));
    let body = serde_json::json!({
        "model": model,
        "messages": [
            { "role": "system", "content": prompt.system },
            { "role": "user", "content": prompt.user },
        ],
        "stream": false,
    })
    .to_string();
    (url, body)
}

pub fn error_for_status(status: u16, body: &str) -> String {
    let head: String = body.trim().chars().take(240).collect();
    match status {
        401 | 403 => "the provider refused the key: check it, or add a new one".to_string(),
        429 => "the provider is rate limiting: try again shortly".to_string(),
        404 => "the provider has no such model or endpoint: check the model name".to_string(),
        400..=499 => format!("the provider rejected the request ({status}): {head}"),
        _ => format!("the provider failed ({status}): {head}"),
    }
}

pub fn parse_response(body: &str) -> Result<Completion, String> {
    let value: serde_json::Value = serde_json::from_str(body)
        .map_err(|error| format!("the provider answered with something unreadable: {error}"))?;
    let text = value
        .pointer("/choices/0/message/content")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "the provider answered without any message content".to_string())?;
    let count = |key: &str| {
        value
            .pointer(&format!("/usage/{key}"))
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0)
    };
    Ok(Completion {
        text: text.to_string(),
        input_tokens: count("prompt_tokens"),
        output_tokens: count("completion_tokens"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::prompts::{render, Task};

    fn provider() -> &'static ProviderSpec {
        crate::ai::providers::spec("openrouter").unwrap()
    }

    fn prompt() -> RenderedPrompt {
        render(Task::Impact, "a.py  1L").unwrap()
    }

    #[test]
    fn joins_the_chat_completions_path_without_doubling_slashes() {
        let (url, _) = request_for(provider(), "m", &prompt());

        assert_eq!(url, "https://openrouter.ai/api/v1/chat/completions");
    }

    #[test]
    fn sends_the_instruction_as_system_and_the_digest_as_user() {
        let (_, body) = request_for(provider(), "deepseek/deepseek-chat", &prompt());
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();

        assert_eq!(json["model"], "deepseek/deepseek-chat");
        assert_eq!(json["stream"], false);
        assert_eq!(json["messages"][0]["role"], "system");
        assert_eq!(json["messages"][1]["role"], "user");
        assert!(json["messages"][0]["content"]
            .as_str()
            .unwrap()
            .contains("impact of changing"));
        assert_eq!(json["messages"][1]["content"], "a.py  1L");
    }

    #[test]
    fn reads_the_message_and_the_usage() {
        let body = r#"{"choices":[{"message":{"role":"assistant","content":"It is fine."}}],
                       "usage":{"prompt_tokens":812,"completion_tokens":431}}"#;

        let completion = parse_response(body).unwrap();

        assert_eq!(completion.text, "It is fine.");
        assert_eq!(completion.input_tokens, 812);
        assert_eq!(completion.output_tokens, 431);
    }

    #[test]
    fn tolerates_a_missing_usage_block() {
        let body = r#"{"choices":[{"message":{"content":"ok"}}]}"#;

        let completion = parse_response(body).unwrap();

        assert_eq!(completion.text, "ok");
        assert_eq!(completion.input_tokens, 0);
        assert_eq!(completion.output_tokens, 0);
    }

    #[test]
    fn refuses_a_response_with_no_content() {
        assert!(parse_response(r#"{"choices":[]}"#).is_err());
        assert!(parse_response(r#"{"error":"nope"}"#).is_err());
        assert!(parse_response("not json at all").is_err());
    }

    #[test]
    fn names_the_likely_cause_of_a_failed_status() {
        assert!(error_for_status(401, "").contains("refused the key"));
        assert!(error_for_status(403, "").contains("refused the key"));
        assert!(error_for_status(429, "").contains("rate limiting"));
        assert!(error_for_status(404, "").contains("no such model"));
        assert!(error_for_status(400, "bad model").contains("bad model"));
        assert!(error_for_status(502, "upstream").contains("502"));
    }

    #[test]
    fn truncates_what_it_quotes_back() {
        let long = "x".repeat(500);

        let message = error_for_status(500, &long);

        assert!(message.len() < 300, "{}", message.len());
    }
}
