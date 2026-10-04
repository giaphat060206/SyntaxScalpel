export interface AiTask {
  id: string;
  label: string;
  hint: string;
}

/**
 * Labels only. Which Digest layers a task pays for, and what it asks, live in
 * the Rust prompt module, so the two cannot drift.
 */
export const AI_TASKS: AiTask[] = [
  {
    id: "explain-selection",
    label: "Explain selection",
    hint: "What the chosen code does, and how the pieces interact.",
  },
  {
    id: "explain-architecture",
    label: "Explain architecture",
    hint: "How the chosen files and folders depend on each other.",
  },
  {
    id: "project-overview",
    label: "Project overview",
    hint: "Purpose, tech stack, layout, and where it starts.",
  },
  {
    id: "impact",
    label: "Report impact",
    hint: "What depends on this, and what would change with it.",
  },
  {
    id: "doc-drift",
    label: "Check documentation",
    hint: "Where the documentation no longer matches the code.",
  },
];
