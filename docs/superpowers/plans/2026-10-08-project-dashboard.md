# Project Dashboard

**Date:** 2026-10-08
**Status:** planned — awaiting approval before code

## Goal

Opening a project lands on a **Dashboard** that says what the project is made of, at a glance, with charts.
A **Graph** button in the top bar goes to the project graph; **Dashboard** brings you back. Both describe the
same folder, so they can be flipped between freely.

## Decisions (approved)

- Opening a project — `File → Open Folder`, a recent folder, or the first load — lands on the **Dashboard**.
- Charts are **hand-rolled SVG**, no charting dependency: the app stays offline, the bundle (already over the
  500 kB warning) does not grow, and unlike a canvas library the output is assertable in a test.

## Assumptions (correct me and the plan changes)

- A **subfolder** picked in the explorer still opens the graph. The Dashboard button then shows *that*
  subfolder's numbers, and Graph returns to its graph — so both views remain reachable at any depth.
- The project payload is loaded **once, in `App`**, and handed to both views. The alternative — each view
  scanning the project itself — means a second full project scan on every view switch, which is the thing
  ADR-0006/AGENTS already warn about for the function graph.

## Data: what already exists, what has to be added

| Panel | Source | Work |
|---|---|---|
| File count per language, code vs docs | `ProjectGraph.files[].name` and `.kind` | none |
| Folder / file / edge counts, entry points, externals | `ProjectGraph` | none |
| Truncated notice | `ProjectGraph.truncated` (scan caps at 2000 files, depth 12) | none |
| Endpoint count | `useApiInventory` (existing hook) | none |
| "Summarise this project" | the existing AI panel and its project task | none — a button that opens the panel |
| **Bytes per language, largest files** | — | **backend: `ProjectFile.size`** |

`routeForExtension` is too coarse for a ratio (`.js/.jsx/.ts/.tsx` all collapse to `jsts`), so the dashboard gets
its own `languageForExtension` covering the extensions the parser already recognises
(`py js jsx ts tsx rs md txt json yaml yml toml ini css scss html sql sh`).

## Tasks

One commit each. Every task lands with tests that fail without it.

### 1. `feat(project): report each file's size`

`parser/project.rs`: add `pub size: u64` to `ProjectFile`, filled with `fs::metadata(path)?.len()` in the walk
that already enumerates files (one syscall per file, capped by the existing 2000-file limit; an unreadable file
reports 0 rather than failing the scan). `shared/types.ts`: `size: number` on `ProjectFile`.

**Test (Rust):** a known file in the repo reports exactly `fs::metadata`'s length.
**Negative check:** return 0 unconditionally — the test must fail.

### 2. `feat(dashboard): aggregate a project into totals and a language ratio`

New `src/features/dashboard/languages.ts` (`languageForExtension`, extension → label, unknown → `Other`) and
`src/features/dashboard/summary.ts` — a pure function `summariseProject(graph) → { totals, languages, largestFiles,
truncated }`, plus `formatBytes`. **External files are excluded** (they are other people's code), bytes and counts
are both carried per language, and shares are computed from bytes.

**Tests:** shares sum to 100; externals excluded; unknown extension → `Other`; empty project; a truncated graph
reports `truncated`; `formatBytes` boundaries (0 B, 999 B, 1.0 kB, 1.5 MB, 2.0 GB).

### 3. `feat(dashboard): show a project dashboard with SVG charts`

New `src/features/dashboard/DashboardView.tsx` + `Charts.tsx` (donut, horizontal bars, split bar — ~120 lines of
SVG, no dependency): header with the project name and counts, language donut with a legend (share, file count,
size), storage-by-language bars, largest files, entry points, code-vs-docs split, endpoint count, and a
**Summarise this project** button that opens the AI panel. Reuses `EmptyState`/`ErrorState`.

**Tests:** renders one arc per language; legend percentages match the data; the truncated notice appears only when
truncated; the empty and error states render.

### 4. `refactor(project): load the project graph once, above both views`

Extract `ProjectGraph`'s internal load into `useProjectGraph(root, scope)` (built on the existing `useAsyncLoad`)
and call it in `App`, passing the result to `ProjectGraph` (which stops loading) and to `DashboardView`.

**Tests:** the hook (key change cancels a stale load, error surfaces, idle when there is no root); in `App.test.tsx`,
`projectGraph` is called **once** and switching Dashboard ⇄ Graph does not call it again.

### 5. `feat(shell): land on the dashboard and switch views from the top bar`

One exported `Location` union in `src/features/shell/location.ts` (replacing the three inline copies), a
`{ kind: "dashboard"; path: string }` case, **Dashboard** and **Graph** buttons in `TopBar` (folder-gated, with the
active one highlighted), folder-open and recents landing on the dashboard, and the render branch in `App`.

**Tests:** new `TopBar.test.tsx` (buttons hidden without a folder, each calls its handler, the active one is
marked); in `App.test.tsx`, opening a project shows the dashboard and Graph shows the graph.

### 6. `docs: record the dashboard and the no-chart-dependency rule`

`AGENTS.md`: a project opens at the Dashboard with the graph one click away; charts are hand-rolled SVG, never a
chart library; the project payload is loaded once above both views; `Location` lives in one module. Plus
`docs/HANDOFF.md`.

## Risks

- **`ProjectGraph` has no render test** (React Flow in jsdom — a known gap). Task 4 therefore changes only where its
  data comes from, keeps the canvas untouched, and puts the verification in a hook test plus an `App` test that
  counts IPC calls.
- **Sizes need one `metadata()` per file** — capped, and only inside the scan that already visits each file.
- **A ratio over a truncated scan is misleading**, so the notice is not optional decoration.

## Out of scope

Lines of code (needs reading every file), per-language history or trends, and any dashboard-level AI task beyond
opening the existing panel.
