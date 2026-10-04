use serde::{Deserialize, Serialize};

/// Bumping this invalidates every cached summary whose prompt it shaped. It is
/// the only invalidation duty the design puts on a human.
pub const PROMPT_VERSION: u32 = 1;

const HOUSE_RULES: &str = "Answer in Markdown, in prose a developer can act on. Be brief: no line-by-line restatement. Never invent a file path, name, or behaviour that the input does not contain, and say plainly when the input is not enough to answer.";

const EXPLAIN_SELECTION: &str = "You explain code to a developer reading an unfamiliar codebase. Explain what the selected definitions do, how they relate to each other, and what is not obvious from their names. The call and use lines in the input are the actual relationships: use them to say how these pieces interact rather than guessing.";

const EXPLAIN_ARCHITECTURE: &str = "You explain the architecture of part of a codebase to a developer new to it. Describe what each part is responsible for, how the parts depend on each other, and the main flow through them. Base every claim on the given structure, imports and signatures. Point out anything that reads as a boundary, a cycle, or a responsibility in the wrong place.";

const PROJECT_OVERVIEW: &str = "You summarise a codebase for a developer seeing it for the first time. State its purpose, the tech stack its imports and file types imply, how the code is organised, and where execution starts. Separate what the structure shows from what you are inferring.";

const IMPACT: &str = "You report the impact of changing the given code. Use the imports, calls and defined names in the input to say what depends on it and what would have to change alongside it. State what cannot be determined from structure alone.";

const DOC_DRIFT: &str = "You compare documentation against code. Using the documentation and the code structure given, report where the documentation is wrong, out of date, or silent about something that matters. Quote the specific claim that no longer holds.";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Task {
    ExplainSelection,
    ExplainArchitecture,
    ProjectOverview,
    Impact,
    DocDrift,
}

impl Task {
    pub const ALL: [Task; 5] = [
        Task::ExplainSelection,
        Task::ExplainArchitecture,
        Task::ProjectOverview,
        Task::Impact,
        Task::DocDrift,
    ];

    pub fn id(self) -> &'static str {
        match self {
            Task::ExplainSelection => "explain-selection",
            Task::ExplainArchitecture => "explain-architecture",
            Task::ProjectOverview => "project-overview",
            Task::Impact => "impact",
            Task::DocDrift => "doc-drift",
        }
    }

    pub fn from_id(id: &str) -> Option<Task> {
        Task::ALL.into_iter().find(|task| task.id() == id)
    }

    pub fn instruction(self) -> &'static str {
        let body = match self {
            Task::ExplainSelection => EXPLAIN_SELECTION,
            Task::ExplainArchitecture => EXPLAIN_ARCHITECTURE,
            Task::ProjectOverview => PROJECT_OVERVIEW,
            Task::Impact => IMPACT,
            Task::DocDrift => DOC_DRIFT,
        };
        body
    }
}

/// What is actually sent: the task as the system role, the Digest as data. A
/// repository can contain text addressed at a model, so the Digest never becomes
/// an instruction.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderedPrompt {
    pub system: String,
    pub user: String,
}

pub fn render(task: Task, digest: &str) -> Result<RenderedPrompt, String> {
    if digest.trim().is_empty() {
        return Err("nothing to explain: the digest is empty".to_string());
    }
    Ok(RenderedPrompt {
        system: format!("{}\n\n{HOUSE_RULES}", task.instruction()),
        user: digest.to_string(),
    })
}

/// Everything a cached summary is keyed by: the version, the answer's audience
/// (provider and model), and the exact text sent.
pub fn cache_input(provider: &str, model: &str, prompt: &RenderedPrompt) -> String {
    format!(
        "v{PROMPT_VERSION}\nprovider={provider}\nmodel={model}\n---\n{}\n---\n{}",
        prompt.system, prompt.user
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_the_instruction_in_the_system_role() {
        let prompt = render(Task::ExplainSelection, "a.py  1L\n  fn one").unwrap();

        assert!(prompt.system.contains("explain code to a developer"));
        assert!(prompt.system.contains("Never invent a file path"));
        assert_eq!(prompt.user, "a.py  1L\n  fn one");
        assert!(!prompt.system.contains("fn one"));
    }

    #[test]
    fn every_task_reads_differently() {
        let instructions: Vec<&str> = Task::ALL
            .into_iter()
            .map(Task::instruction)
            .collect();
        let mut unique = instructions.clone();
        unique.sort_unstable();
        unique.dedup();

        assert_eq!(instructions.len(), 5);
        assert_eq!(unique.len(), 5);
    }

    #[test]
    fn task_ids_round_trip() {
        for task in Task::ALL {
            assert_eq!(Task::from_id(task.id()), Some(task));
        }
        assert_eq!(Task::from_id("explain-everything"), None);
    }

    #[test]
    fn rejects_an_empty_digest() {
        assert!(render(Task::Impact, "   \n ").is_err());
    }

    #[test]
    fn the_cache_input_is_stable_for_the_same_input() {
        let prompt = render(Task::Impact, "a.py").unwrap();

        assert_eq!(
            cache_input("openrouter", "deepseek/deepseek-chat", &prompt),
            cache_input("openrouter", "deepseek/deepseek-chat", &prompt)
        );
    }

    #[test]
    fn the_cache_input_covers_version_provider_model_and_text() {
        let prompt = render(Task::Impact, "a.py").unwrap();
        let base = cache_input("openrouter", "m", &prompt);

        assert!(base.contains("v1"));
        assert_ne!(base, cache_input("deepseek", "m", &prompt));
        assert_ne!(base, cache_input("openrouter", "other", &prompt));
        assert_ne!(
            base,
            cache_input("openrouter", "m", &render(Task::Impact, "b.py").unwrap())
        );
        assert_ne!(
            base,
            cache_input("openrouter", "m", &render(Task::DocDrift, "a.py").unwrap())
        );
    }
}
