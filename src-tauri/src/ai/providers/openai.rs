use super::super::prompts::RenderedPrompt;
use super::{Completion, ModelChoice, ProviderSpec};

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

/// Where a provider publishes the models it serves. OpenRouter's needs no key, which
/// is what lets a model be chosen before a key has been entered.
pub fn models_url(provider: &ProviderSpec) -> String {
    format!("{}/models", provider.base_url.trim_end_matches('/'))
}

/// Read a model catalogue. Only what a picker shows is kept, and a model that cannot
/// be sent a chat message is dropped: an image model is not a choice for this app.
pub fn parse_models(body: &str) -> Result<Vec<ModelChoice>, String> {
    let value: serde_json::Value = serde_json::from_str(body)
        .map_err(|error| format!("the provider's model list was unreadable: {error}"))?;
    let data = value
        .get("data")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| "the provider's model list had no models in it".to_string())?;

    let mut models: Vec<ModelChoice> = data
        .iter()
        .filter_map(|entry| {
            let id = entry.get("id").and_then(serde_json::Value::as_str)?;
            let speaks_text = entry
                .pointer("/architecture/output_modalities")
                .and_then(serde_json::Value::as_array)
                .map(|modalities| {
                    modalities
                        .iter()
                        .any(|modality| modality.as_str() == Some("text"))
                })
                .unwrap_or(true);
            if !speaks_text {
                return None;
            }
            Some(ModelChoice {
                id: id.to_string(),
                name: entry
                    .get("name")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or(id)
                    .to_string(),
                context_length: entry
                    .get("context_length")
                    .and_then(serde_json::Value::as_u64)
                    .unwrap_or(0),
            })
        })
        .collect();

    models.sort_by(|left, right| left.id.cmp(&right.id));
    models.dedup_by(|left, right| left.id == right.id);
    Ok(models)
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
mod model_tests {
    use super::*;
    use crate::ai::providers::spec;

    #[test]
    fn reads_a_catalogue_into_choices_sorted_by_id() {
        let body = r#"{"data":[
            {"id":"z/model","name":"Zed","context_length":8000},
            {"id":"a/model","name":"Aye","context_length":200000}
        ]}"#;

        let models = parse_models(body).unwrap();

        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "a/model");
        assert_eq!(models[0].name, "Aye");
        assert_eq!(models[0].context_length, 200000);
        assert_eq!(models[1].id, "z/model");
    }

    #[test]
    fn leaves_out_a_model_that_cannot_answer_with_text() {
        // An image model is in OpenRouter's catalogue and is not a choice here.
        let body = r#"{"data":[
            {"id":"img/model","name":"Images","architecture":{"output_modalities":["image"]}},
            {"id":"txt/model","name":"Text","architecture":{"output_modalities":["text"]}}
        ]}"#;

        let models = parse_models(body).unwrap();

        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "txt/model");
    }

    #[test]
    fn keeps_a_model_that_says_nothing_about_its_modalities() {
        let body = r#"{"data":[{"id":"quiet/model"}]}"#;

        let models = parse_models(body).unwrap();

        assert_eq!(models.len(), 1);
        // Its name falls back to the id rather than being empty.
        assert_eq!(models[0].name, "quiet/model");
    }

    #[test]
    fn refuses_an_answer_that_is_not_a_catalogue() {
        assert!(parse_models("not json").is_err());
        assert!(parse_models(r#"{"models":[]}"#).is_err());
    }

    #[test]
    fn asks_each_provider_where_it_publishes_its_models() {
        assert_eq!(
            models_url(spec("openrouter").unwrap()),
            "https://openrouter.ai/api/v1/models"
        );
        assert_eq!(
            models_url(spec("deepseek").unwrap()),
            "https://api.deepseek.com/models"
        );
    }
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
