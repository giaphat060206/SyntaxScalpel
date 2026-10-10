use serde::{Deserialize, Serialize};

use super::digest::Options;

/// Bumping this invalidates every cached summary whose prompt it shaped. It is
/// the only invalidation duty the design puts on a human.
pub const PROMPT_VERSION: u32 = 1;

const HOUSE_RULES: &str = "Answer in Markdown, in prose a developer can act on. Be brief: no line-by-line restatement. Never invent a file path, name, or behaviour that the input does not contain, and say plainly when the input is not enough to answer.";

/// What every prose answer must look like, whatever the task. Deliberately not in
/// HOUSE_RULES: the tour answers in JSON and has to override the format rules
/// outright, rather than argue with a second set of them.
const SHAPE: &str = "Lay the answer out like this. The first line is the answer itself, in one sentence, with no heading — a reader who stops there still knows the point. Then the sections named above, in that order, each with a `##` heading. Omit a section rather than padding it, and never add one that was not asked for. Use bullets only for genuinely parallel items, never to break a paragraph into pieces.";

const EXPLAIN_SELECTION: &str = "You explain code to a developer reading an unfamiliar codebase. Explain what the selected definitions do, how they relate to each other, and what is not obvious from their names. The call and use lines in the input are the actual relationships: use them to say how these pieces interact rather than guessing. Answer under `## What it does`, then `## How it fits` with at most three bullets, one relationship each, then `## Watch out for` — only when the input shows something surprising.";

const EXPLAIN_ARCHITECTURE: &str = "You explain the architecture of part of a codebase to a developer new to it. Describe what each part is responsible for, how the parts depend on each other, and the main flow through them. Base every claim on the given structure, imports and signatures. Point out anything that reads as a boundary, a cycle, or a responsibility in the wrong place. Answer under `## What each part is responsible for`, `## How they depend on each other`, `## The main flow`.";

const PROJECT_OVERVIEW: &str = "You summarise a codebase for a developer seeing it for the first time. State its purpose, the tech stack its imports and file types imply, how the code is organised, and where execution starts. Separate what the structure shows from what you are inferring. Answer under `## Purpose`, `## Stack`, `## How it is organised`, `## Where execution starts`.";

const IMPACT: &str = "You report the impact of changing the given code. Use the imports, calls and defined names in the input to say what depends on it and what would have to change alongside it. State what cannot be determined from structure alone. Answer under `## What depends on it`, `## What would change with it`, `## What cannot be determined from structure`.";

const DOC_DRIFT: &str = "You compare documentation against code. Using the documentation and the code structure given, report where the documentation is wrong, out of date, or silent about something that matters. Quote the specific claim that no longer holds. Answer under `## Claims that no longer hold`, quoting each claim, then `## Silent about`.";

const RELATIONSHIP: &str = "You explain how two parts of a codebase depend on each other. From the signatures, the import and the exact call sites given, say what passes between them, what each expects of the other, and what would have to change together. Quote a call site when it is the evidence for a claim. Answer under `## What passes between them`, `## What each expects of the other`, `## What would have to change together`.";

const TOUR_STOP: &str = "You explain one stop on a guided reading tour of a codebase, to someone reading it in this order for the first time. Ignore the house rule about the answer format: this task answers with a single JSON object and nothing else, shaped {\"title\": \"a few words naming this part, never empty\", \"why\": \"two or three sentences, in Markdown, on why this stop comes here: what it depends on, what the reader should have read first, and what it unlocks\", \"lookAt\": [\"project-relative file or folder ids worth opening next\"]}. Every id in lookAt must appear in the input. Never invent one: an empty list is better than a guess. Say what this stop is for in the order rather than restating what the file does, which the reader can see for themselves.";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Task {
    ExplainSelection,
    ExplainArchitecture,
    ProjectOverview,
    Impact,
    DocDrift,
    Relationship,
    TourStop,
}

impl Task {
    pub const ALL: [Task; 7] = [
        Task::ExplainSelection,
        Task::ExplainArchitecture,
        Task::ProjectOverview,
        Task::Impact,
        Task::DocDrift,
        Task::Relationship,
        Task::TourStop,
    ];

    pub fn id(self) -> &'static str {
        match self {
            Task::ExplainSelection => "explain-selection",
            Task::ExplainArchitecture => "explain-architecture",
            Task::ProjectOverview => "project-overview",
            Task::Impact => "impact",
            Task::DocDrift => "doc-drift",
            Task::Relationship => "relationship",
            Task::TourStop => "tour-stop",
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
            Task::Relationship => RELATIONSHIP,
            Task::TourStop => TOUR_STOP,
        };
        body
    }

    /// The layout this task's answer takes, or None when the answer is not prose:
    /// the tour returns JSON and says so in its own instruction, so handing it a
    /// Markdown skeleton would be a second set of rules to argue with.
    pub fn shape(self) -> Option<&'static str> {
        match self {
            Task::TourStop => None,
            _ => Some(SHAPE),
        }
    }
}

/// Which Digest layers a Task is worth paying for. It lives here rather than in
/// the frontend so the layers a Task sends cannot drift from the Task itself —
/// a drift would silently change the cache key and re-buy every answer.
pub fn default_options(task: Task) -> Options {
    match task {
        Task::ExplainSelection => Options { signatures: true, bodies: true, docs: false },
        Task::ExplainArchitecture => Options { signatures: true, bodies: false, docs: true },
        Task::ProjectOverview => Options { signatures: false, bodies: false, docs: true },
        Task::Impact => Options { signatures: true, bodies: false, docs: false },
        Task::DocDrift => Options { signatures: true, bodies: false, docs: true },
        Task::Relationship => Options { signatures: true, bodies: false, docs: false },
        // A stop explains what a piece of code does, so it needs the bodies; a
        // tour is a reading order, not a documentation review.
        Task::TourStop => Options { signatures: true, bodies: true, docs: false },
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
    let system = match task.shape() {
        Some(shape) => format!("{}\n\n{shape}\n\n{HOUSE_RULES}", task.instruction()),
        None => format!("{}\n\n{HOUSE_RULES}", task.instruction()),
    };
    Ok(RenderedPrompt { system, user: digest.to_string() })
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

        // Derived from ALL rather than a number: the property is that no two tasks
        // share an instruction, and adding a task should not mean editing a count.
        assert_eq!(unique.len(), Task::ALL.len());
    }

    #[test]
    fn the_tour_task_asks_for_json_and_knows_it_overrides_the_house_rules() {
        let instruction = Task::TourStop.instruction();

        assert!(instruction.contains("JSON"));
        // The house rules say to answer in Markdown, so the tour task has to say so.
        assert!(instruction.contains("Ignore the house rule about the answer format"));
        assert!(instruction.contains("Never invent one"));
        // A stop explains what code does, so it pays for bodies.
        let options = default_options(Task::TourStop);
        assert!(options.signatures && options.bodies && !options.docs);
    }

    #[test]
    fn task_ids_round_trip() {
        for task in Task::ALL {
            assert_eq!(Task::from_id(task.id()), Some(task));
        }
        assert_eq!(Task::from_id("explain-everything"), None);
    }

    /// The layout is only useful if the instruction it refers to names sections, and
    /// the one task that answers in JSON must not be handed a Markdown skeleton at
    /// all — it resolves that by overriding the format rules, and a second set would
    /// only muddy which wins.
    #[test]
    fn every_prose_task_carries_its_layout_and_the_json_task_carries_none() {
        for task in Task::ALL {
            let system = render(task, "a digest").unwrap().system;
            match task.shape() {
                Some(shape) => {
                    assert!(system.contains(shape), "{task:?} lost its layout rules");
                    assert!(
                        task.instruction().contains("## "),
                        "{task:?} asks for sections it never names"
                    );
                    assert!(system.contains("The first line is the answer"));
                }
                None => {
                    assert!(!system.contains("The first line is the answer"));
                    assert!(system.contains("JSON"));
                }
            }
        }
    }

    #[test]
    fn the_tour_stop_says_what_the_stop_is_for_in_the_order() {
        let instruction = Task::TourStop.instruction();

        // Positional, not descriptive: the panel's summary tasks already say what a
        // file does, so the tour has to say why it comes here.
        assert!(instruction.contains("what it depends on"));
        assert!(instruction.contains("what it unlocks"));
        assert!(instruction.contains("never empty"));
    }

    #[test]
    fn rejects_an_empty_digest() {
        assert!(render(Task::Impact, "   \n ").is_err());
    }

    #[test]
    fn the_relationship_task_asks_for_evidence_not_bodies() {
        let options = default_options(Task::Relationship);

        assert_eq!(Task::Relationship.id(), "relationship");
        assert!(Task::Relationship.instruction().contains("call sites"));
        assert!(options.signatures);
        assert!(!options.bodies);
        assert!(!options.docs);
    }

    #[test]
    fn every_task_asks_for_the_layers_it_needs() {
        let selection = default_options(Task::ExplainSelection);
        assert!(selection.bodies);
        assert!(!selection.docs);

        let overview = default_options(Task::ProjectOverview);
        assert!(!overview.signatures);
        assert!(overview.docs);
        assert!(!overview.bodies);

        let architecture = default_options(Task::ExplainArchitecture);
        assert!(architecture.signatures);
        assert!(architecture.docs);
        assert!(!architecture.bodies);

        for task in Task::ALL {
            let options = default_options(task);
            assert!(
                options.signatures || options.bodies || options.docs,
                "{} asks for nothing",
                task.id()
            );
            assert!(!options.bodies || options.signatures, "{}", task.id());
        }
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
