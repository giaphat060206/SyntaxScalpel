# Project Tour

**Date:** 2026-10-08
**Status:** planned — awaiting approval before code

## Goal

A **Tour** reads a project aloud, in order: a step-by-step panel beside the project graph where each
step moves the canvas to the folder or file it is talking about and highlights it. It answers the question a
graph cannot — *where do I start, and what comes next* — because a graph shows structure while onboarding needs
narrative.

## Decisions (already agreed)

1. **Scope-aware from day one, launching on the whole project.** `scope` is the grain of the whole app
   (`project_graph(root, scope)`, `useProjectGraph`, the dashboard, the breadcrumb), so a project-only tour would
   be the odd one out. The default tour covers the project; **Tour this folder** is a first-class action, because a
   deep tour of one module is the useful unit on a real codebase and the digest budget plus the step cap cannot
   make a whole-project tour deep.
2. **The skeleton is deterministic and ships without an API key.** The route comes from the parse: detected entry
   points, then outward by how many modules depend on each file. The model writes the commentary per step and
   **never** chooses the order. A tour with no key is still a real tour, just without prose — so the feature
   degrades honestly and only asks for the egress notice when prose is actually requested.
3. **A stop is not a file.** Every step has one focal node plus zero or more "also look at" ids, which is how a
   feature spanning four files is represented without inventing a dependency graph.
4. **Per-step AI calls, JSON out, ids validated.** One call per step (cheap context, visible progress,
   per-step regeneration, and the existing content-addressed cache does the work). The model returns a strict
   JSON object, parsed and validated in Rust; any id it names that is not in the payload is dropped and counted.
5. **Cap and disclose.** `MAX_TOUR_STEPS = 12`, and when the project cannot be toured in one pass the first step
   says so and points at the folder tours — the same rule the relationship list follows.
6. **The tour never locks the app.** It occupies the side slot, the canvas stays interactive, and nothing
   regenerates by itself.

## Assumptions to verify before writing code

- `ProjectGraph`'s `focus: { id, nonce }` prop **selects and centres** the node (it is what the AI panel's
  `onShow` and a search pick already drive). If it only centres, the step also needs a way to set the selection.
- `Emphasis` is `{ ids: string[] }` and `isEmphasisedNode` is a membership test, so `[folderId, fileId]`
  highlights both and dims the rest with **no change to the emphasis system** (verified: `graph/emphasis.tsx`).
- Canvas node ids are the payload's folder/file ids (`"."` for the project root folder, `"src/parser"`, …), so a
  step's ids can be validated against `folders ∪ files` the same way `activeSelectedId` already does.

## The skeleton: how the order is computed

1. **Orientation** — focal: the project folder (`graph.root`, the scope id). A step in prose: *"a suggested
   reading order, not documentation."*
2. **Entry** — focal: `graph.entry` (or the first of `entries`); also-look-at: its folder. The parser already
   detects these.
3. **The spine** — in-degree per in-scope file from `graph.edges`, then order candidates by
   **BFS distance from the entry, then by in-degree descending, then by path** so the sequence is a total order
   and cannot change between runs. The first stops are the modules the most code depends on, closest to where the
   program starts.
4. **Feature stops** — a spine stop can carry a feature label from the model. Real artefacts are the anchors:
   entry points, top-level folders, highly-imported modules, and later API Endpoints (already parsed) for web
   projects. The model names the feature; it never invents the anchor.
5. Cap at 12 steps; when files were left out, `truncated` is set and the panel says how many.

## Data and reuse

| Need | Already exists |
|---|---|
| Move the canvas to a node | `focus` + `focusRequest` (search picks, the AI panel's `onShow`) |
| Highlight a set of nodes | `Emphasis.ids` + `isEmphasisedNode` |
| A panel slot | The side slot `showDocs` already shares between the doc and an AI result |
| Grounded, cached, key-gated AI | `digest.rs` → `prompts.rs` → `cache.rs` → `providers/`, plus per-project egress notices and the derived ✓ marks |
| The step's context | The existing **File** digest layers for the focal file; which layers a task pays for stays in `prompts.rs` |
| Export | The store is Markdown with front-matter and `export_summary` already writes it |

## Commits

### 1. `feat(tour): plan a reading order from the parse`

New `src/features/tour/plan.ts`: `planTour(graph) → TourPlan { steps, dropped, truncated }` where a step is
`{ nodeId, kind: "orientation" | "entry" | "module", alsoIds, depth, dependents }`. Pure, no AI, no network.

**In TypeScript, not Rust as first drafted.** It is a projection of a payload the frontend already holds — the
same call as `summariseProject` — and doing it in Rust would mean either a second full project scan or shipping
the graph back over IPC, for a function that is pure arithmetic over data already in hand. It is still pure and
still unit-tested; the tests just live in vitest.

**Tests (vitest):** entry detection drives step 2; ordering is by distance then in-degree then path; ties cannot
reorder between runs; the cap sets `truncated` with the count left out; external files and docs are left out; a
step carries the folder its file lives in; a project with no detected entry still plans; a file nothing reaches
comes last; a subfolder scope plans only within it.

### 2. `feat(tour): walk a tour beside the graph`

`src/features/tour/useTour.ts` and `TourPanel.tsx`; a **Tour** button in the top bar that switches to the graph
and opens the panel; step navigation with ←/→ and a "3 / 8" counter; applying a step sets `focus`, `emphasis` and
the selection; **Tour this folder** from the explorer/graph. This commit is usable with **no key at all**.

**Tests:** the panel renders the skeleton's steps with their real paths; Next/Previous move through them and stop
at the ends; arrow keys do the same; the cap note appears only when truncated; applying a step calls focus and
emphasis with the step's ids (a mocked canvas records them).

### 3. `feat(tour): explain each stop with the model`

Task template asking for strict JSON `{ title, why, lookAt[] }`; a command that resolves the focal file's digest,
calls the provider, parses and **validates** the ids, caches the result under the same prompt hash as a summary,
and reports how many ids it dropped. A new task template does **not** need a `PROMPT_VERSION` bump: the hash
covers the rendered prompt, so existing cached summaries stay valid.

**Tests (fake `Transport`):** a valid response attaches title and why to the step; `lookAt` ids that are not in
the payload are dropped and counted; a malformed response surfaces as an error on that step only; a cached step
costs no request and shows the ✓ mark; the plan does not move when prose arrives.

### 4. `feat(tour): export a tour as Markdown`

Write the plan plus whatever prose exists through the existing renderer, so a team can paste it into a README.

**Tests:** headings per step, real paths, absent prose simply omitted.

### 5. `docs: record the tour and its rules`

`AGENTS.md`: the route is computed, never asked for; a tour with no key is still a tour; a step carries ids and
"also look at", not a file; ids from the model are validated and dropped when wrong; prose never moves the plan.
Plus `docs/HANDOFF.md`.

## Risks

- **A tour is an interpretation.** "This is the auth feature" can be wrong. So the step's identity is always the
  real id and path; an AI-named feature is a subtitle, never the identity.
- **Cost is one request per step**, so the panel says "8 steps · 8 requests" before anything leaves the machine.
- **Staleness**: the cache is content-addressed, so an edit that changes a step's digest takes its prose away —
  reuse the marks mechanism to say "the code moved on; regenerate" rather than showing prose for code that moved.
- **The plan interface is the expensive thing to change**, which is why commit 1 settles it against real parse
  data before any model output exists.

## Out of scope

Streaming (per-step calls already make steps arrive progressively), tours that span several scopes at once, a
graph-shaped (non-linear) tour, tours of the function graph's definitions (files and folders first), and any
local-model path.
