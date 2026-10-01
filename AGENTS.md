# AGENTS.md

Standing instructions for agents working in this repository.

## Project

**SyntaxScalpel** — a local-first Tauri v2 desktop app for codebase comprehension. It parses a local project
into (a) a **folder/project graph** of folder blocks containing file blocks joined by import edges, and (b) a
**function graph** per code file whose definitions can be clicked to read their highlighted source.

Repo folder is `SyntaxScalper` (older name); the product name is **SyntaxScalpel**.

## Environment

- Windows. Shell is **PowerShell 5.1**: never use `&&`; use `;` or `cmd1; if ($?) { cmd2 }`.
- Paths may contain spaces — quote them.
- `npm run tauri dev` must be **restarted after any Rust change** (frontend hot-reloads on its own).

## Commands

```powershell
npm run tauri dev                                  # run the app
npm test                                           # Vitest (frontend unit tests)
npm run build                                      # tsc + vite build (must pass: strict, noUnusedLocals)
cargo test --manifest-path src-tauri/Cargo.toml    # Rust tests (must pass)
```

Run `npm test`, `npm run build`, and `cargo test` before claiming work is done.

## Layout

- `src-tauri/src/parser/` — `python.rs`, `jsts.rs` (shared JS/TS), `imports.rs` (extraction, specifier
  resolution, tsconfig aliases), `project.rs` (folders/files/edges/entry points/external nodes).
- `src-tauri/src/commands/` — `parse.rs`, `fs_cmds.rs`, `layout.rs` (layout commands are currently unused by
  the UI).
- `src/features/` — `explorer/`, `graph/` (incl. `elk/`), `markdown/`, `code/`, `project/`, `shell/`.
- `src/shared/` — `types.ts`, `ipc.ts`, `extensions.ts`, `StateViews.tsx`, `ErrorBoundary.tsx`.
- Design docs: `docs/superpowers/specs/`, plans: `docs/superpowers/plans/`, session handoff: `docs/HANDOFF.md`.

## Backend rules

- All IPC payload structs derive `serde::Serialize` with `#[serde(rename_all = "camelCase")]`; commands return
  `Result<T, String>` and never panic.
- Tauri v2 commands use `#[tauri::command(rename_all = "camelCase")]`; the frontend passes `{ root, relPath, path }`.
- File reads are **root-anchored** (`Path::new(root).join(path)`); paths are project-relative with `/`.
- Node ids: `name` (function), `ClassName` (class), `ClassName.method` (method), `varName.method` (JS object method).
- Edges are **in-file only**; class ids are never edge targets; no self-edges.
- Python `decorated_definition` must be unwrapped (`@staticmethod`, `@app.route`); line ranges include decorators.
- Specifier resolution: count leading dots (`.` own dir, `..` parent, `...` grandparent); a target file name
  containing a dot prefers **appending** the extension (`ai.easy` → `ai.easy.js`) then replacing; `tsconfig.json`
  / `jsconfig.json` `baseUrl` + `paths` aliases resolve; imports resolving outside the scope become **external**
  nodes; recognized extensions are
  `py js jsx ts tsx md txt json yaml yml toml ini css scss html sql sh`.
- Entry points: folder `index.html` script → Python `__main__` guard → conventional names **per folder** →
  folder `package.json` (`main`/`module`/`scripts.start`) → graph roots.

## Frontend rules

- React 18 + TypeScript strict (`noUnusedLocals`). No comments unless asked.
- **Rules of Hooks**: every hook runs before any early return — violating this has blanked the whole app.
- React Flow v12 (`@xyflow/react`): `nodes`/`edges` are controlled, so use `useNodesState`/`useEdgesState` and
  wire `onNodesChange`/`onEdgesChange`; do **not** pass the `fitView` prop when centring programmatically
  (competing animations cause a "fling"); centre with `getInternalNode(id).internals.userNode.measured` and
  `positionAbsolute` via `setCenter`; list every value a `useMemo` reads in its deps; ignore a `selectedId` that
  is not on the canvas (otherwise the whole graph dims).
- Keep the component tree **stable** across UI toggles (the code pane is an overlay) so React Flow never remounts
  — remounting rebuilds the graph and re-runs ELK (visible stutter).
- ELK owns placement and edge routing (worker via `elkjs` `?url`, dynamic `elk.bundled` fallback, 15s timeout);
  >1500 nodes or any error falls back to `layout.ts`'s grid + smoothstep. Container padding top is 72px so block
  titles are not overlapped.
- No layout persistence: `.scalpel/metadata.json` is neither read nor written; dragging is temporary and re-runs
  ELK. Do not reintroduce autosave.
- Visual rules: containers z-index `1`, leaf blocks `4`, edges `0` (lines always under blocks); containers are
  transparent **only when they hold an edge endpoint**; palette colour per block; edges arrowed `smoothstep`,
  unrelated edges dim to 12% on selection (no bolding).

## Style and workflow

- Communication: terse, direct; no filler. Code, commits, and PR text are written normally.
- Prefer editing existing files; do not add a library without checking it is already a dependency.
- Commit only when the user explicitly asks, and only the files that belong to that change.
- When a change touches Rust, tell the user to restart `npm run tauri dev`.

## Do not

- Do not re-add the logo assets or regenerate `src-tauri/icons` (reverted by the user).
- Do not add code comments unless requested.
- Do not reintroduce layout persistence or the removed `useLayoutAutosave` hook.
- Do not change the `main` branch history; work on a feature branch.
