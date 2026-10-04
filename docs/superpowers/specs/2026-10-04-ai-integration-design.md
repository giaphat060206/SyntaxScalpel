# AI Integration Design

**Status:** proposed
**Date:** 2026-10-04
**Related:** `docs/adr/0007-ai-summaries-and-caching.md`, `docs/adr/0002-no-layout-persistence.md`,
`docs/superpowers/specs/2026-09-22-syntaxscalpel-design.md`, `GLOSSARY.md`

## 1. Goal

Let a user ask questions about a codebase SyntaxScalpel has already parsed, and get an answer grounded in that
parse rather than in a hopeful paste of source.

Every AI Summary is produced from a **Digest** — a compact, deterministic text projection of the code, built from
the same parse the graphs already use — and every AI Summary is cached against the exact input it was generated
from, so unchanged code is never sent twice.

**v1 ships:** key-gated cloud providers, five AI Tasks (§3), the Digest builder, the Summary Cache, and the scope
pickers. **v1 defers:** local inference (Ollama), streaming, chat, embeddings, and any AI write path.

## 2. Why the parse is the product

The token argument decides the whole design, so it is measured rather than asserted. On a real 33-file Python
project (6,106 lines, 231 KB):

| Payload | Size | Note |
|---|---|---|
| Whole project source | 231,374 B | ~58K tokens |
| `repomix` pack of the repo | 19,209,372 B | ~4.8M tokens, and blind to structure |
| Whole project **Digest, L0** (names only) | **9,211 B** | ~2.3K tokens, covering 33 files and 264 Definitions |
| Whole project **Digest, L0 + L1** | **14,970 B** | ~3.7K tokens |
| `FunctionGraph` for `algorithms/pathfinder.py` | 12,370 B | source is 11,038 B — payload is **1.12×** |
| `FunctionGraph` for `core/graph.py` | 12,769 B | source is 3,567 B — payload is **3.58×** |

**The existing IPC payloads must not be sent to a provider.** They carry `id`/`kind`/`params`/`returns`/`uses`/
`startLine`/`endLine`/`parent` per Node, plus the neighbourhood, plus the Import Analysis — in which the same
specifier appears both in `imports.imports` and inside `residualImports`. For a 109-line file that is 3.6× the
source, and **one single file's payload is a third larger than the Digest of the entire project**. The Digest is
therefore a purpose-built projection: 9.2 KB names-only and 15.0 KB with signatures for the whole project, roughly
25× cheaper than its source and structured rather than raw.

(The ~token figures use a bytes/4 heuristic and are indicative only; the design never keys or budgets on tokens.)

The app is unusually well placed here: `project_graph` already walks every code and doc file and resolves
file→file Import Edges, `imports::analyze` already parses every project file, and every Definition already carries
exact `startLine`/`endLine`. Building the Digest adds a projection, not a parser.

## 3. AI Tasks

A **Summary Target** says what to explain; an **AI Task** says what to ask about it.

| # | AI Task | Summary Target | Layers | User ask it answers |
|---|---|---|---|---|
| F1 | Explain selection | Definition Target or File Target | L1 + L2 | "what do these do, and how do they fit together?" |
| F2 | Explain architecture | File Target across a Scope | L0 + L1 + L3 | 5.1 — how the chosen folders and files interact |
| F3 | Project overview | the root Scope | L0 + L3 | 4 — purpose, architecture, tech stack on first open |
| F4 | Impact | Definition Target or File Target | L0 + L1 | "what depends on this, and what breaks if I change it?" |
| F5 | Doc drift | a Doc File + the code it documents | L1 + L3 | "is this README still true?" |
| F6 | Relationship | a Connection between two ends | L1 + call sites | "how do these two depend on each other?" |

F1 and F2 are the same request at two scopes, which is exactly 5.2 and 5.1. F1 ships first because it is the
smallest complete slice: pick Definitions, get an answer.

F6 is the only Task whose Target is not a set of things to read but a **pair**: a Connection, written caller first
with each end qualified by its own file (`algorithms/pathfinder.py::dijkstra` → `utils/helpers.py::push`). Both
sides of the same relationship therefore render one identical Digest and share one cache entry, which is what makes
a Relationship Summary persist across files — generate it from either end and the other end shows it. Its evidence
is both signatures plus the exact call sites, so a claim can be checked against the line that makes it true.

Deliberately **not** in v1: free chat, code generation or refactors, test generation, commit messages,
embeddings/RAG. Chat needs tool orchestration and unbounded cost; generation raises the stakes of a wrong answer in
a tool whose job is comprehension; RAG is a whole subsystem whose retrieval signal is *worse* here than the graph
the app already has.

## 4. The Digest

Four layers, cheapest first. Each layer is optional per Task, deterministic, and reports truncation.

| Layer | Content | Budget | Produced from |
|---|---|---|---|
| **L0** structure | per Code File: path, line count, container names and member names; per Scope: the file→file Import Edges; Doc Files by path | 24 KB | `project_graph` + `definitions` |
| **L1** signatures | per Definition in scope: `kind name(params) -> returns` with its line range | 64 KB | the owned `Def` |
| **L2** bodies | source sliced by `startLine..endLine`, for selected Definitions only | 96 KB | the file read |
| **L3** docs | Doc File text, head-truncated | 8 KB | the file read |

A Connection adds no layer: it renders the two ends' signatures and, for each call the caller makes to the callee,
`calls at {line}: {source line}` — the parser records a line with every call site for exactly this. When either end
is a file rather than a Definition, the evidence is the import that connects them.

Measured on the project above: L0 alone 9,211 B, L0 + L1 14,970 B, and adding L3 27,772 B — the last figure
dominated by data fixtures rather than documentation, which is why the L3 rules below exist.

L0 for the 33-file project above:

```
groupProject  33 files  5407 lines
algorithms/pathfinder.py  234L
  class PathFinder {__init__, dijkstra, find_shortest_distance_path, find_shortest_time_path, find_paths}
  -> core/path.py, utils/helpers.py
core/graph.py  109L
  class Graph {__init__, add_node, add_edge, get_neighbors}
  -> core/path.py
```

Rules:

- **Deterministic.** Files sorted by path, Definitions in source order, import targets deduped and sorted. The
  Project Graph already guarantees deterministic ordering, so an unchanged project renders byte-identical text —
  which is what makes the cache key in §5 sound.
- **Signatures over bodies.** A model explains a class far better from its methods' shapes than from a truncated
  body. Bodies are opt-in (L2) and only ever for Definitions the user selected.
- **Line ranges do the cutting.** L2 slices by `startLine..endLine`, so explaining three functions sends three
  ranges rather than three files.
- **Truncation is reported**, never silent: the Digest carries `truncated` and the UI says so. This mirrors the
  Project Graph's existing file cap (`Truncated` in `GLOSSARY.md`).
- **L3 prefers documentation over data.** A Doc File is any readable non-code file, which in practice includes
  fixtures: the project above carries `data/graphs/graph_10000.txt` and six evaluation result files. Markdown is
  inlined first, each Doc File contributes only its head (1,200 characters), and the layer budget is shared — so a
  large data file cannot crowd out the READMEs.
- **Budgets are characters, not tokens.** Characters are provider-independent and deterministic; token counts vary
  by tokeniser and would make the cache key unstable.

## 5. The Summary Cache

The cache exists so that re-opening a file you already summarised costs nothing.

**Key = `sha256(rendered prompt)`** — where the rendered prompt is the task instruction, its version, the provider,
the model, and the Digest. Hashing the *exact text sent* makes staleness structurally impossible: edit one line of
one selected function and the Digest changes, so the key changes. No mtime comparison, no separate invalidation
pass, no risk of serving a summary of code that no longer exists.

A `PROMPT_VERSION` constant sits inside the hashed text, so editing a task template invalidates every entry it
affects.

Stored one file per summary at `<root>/.scalpel/ai/<key>.md` — a Markdown document with a YAML front-matter
header, so a partial write cannot corrupt the set and the store is legible to a person:

```markdown
---
key: 9f2c…
task: explain-selection
provider: openrouter
model: deepseek/deepseek-chat
promptVersion: 1
createdAtMs: 1790000000000
inputTokens: 812
outputTokens: 431
---

## What it does

It returns a path.
```

- **Misses are free of failure.** An unreadable, corrupt, or truncated entry is a miss and is ignored; a cache
  problem never fails a command. (Same posture as the old `metadata.json` rule: corrupt, start fresh.)
- **Eviction** is by entry count (default 200) and total bytes (default 4 MB), oldest `createdAtMs` first.
- **Observability.** Token counts and `createdAtMs` are stored so the UI can say "cached, 2 days ago" instead of
  silently reusing something. A **Regenerate** action bypasses the cache but still writes it.
- **Readable and editable.** The body can be grepped, and a hand-written body is served like any other, because the
  key answers "was this generated from exactly this input", not "is this fresh". Breaking the header turns the
  entry into a miss.
- **Export** writes one stored entry to a path chosen in a save dialog, using the same renderer as the store, so an
  exported file and a stored file are the same document. Nothing is ever written into the project tree.
- **The Provider Key is never stored here.**
- Per-project is the default. A second, content-keyed global cache is a possible follow-up (summarising the same
  code in two checkouts would then cost once) and is out of scope for v1.

## 6. Providers

One client shape covers the priority list, because OpenRouter and DeepSeek are both OpenAI-compatible chat
completions: bearer token, `POST /chat/completions`, the same request and response body. Ollama speaks the same
shape on `localhost:11434`, which is why deferring it (§7) costs an adapter later rather than a rewrite.

| Provider | v1 | Note |
|---|---|---|
| **OpenRouter** | yes — default | one key reaches many models, including DeepSeek's |
| **DeepSeek** | yes | same client, different base URL |
| OpenAI | later | OpenAI-compatible; needs a second base URL and model list |
| Anthropic | later | its own Messages API — different auth header, system prompt, and streaming event shape, so a real adapter |
| Google | later | its own REST shape |
| Ollama | later | OpenAI-compatible, needs no key |
| Claude Code / Codex CLI | **never** | local agentic CLIs, not APIs; "integrating" means spawning a child process, which is a different architecture and not this program's job |

Requests are made **from Rust**, never from the WebView. The Provider Key goes in through one command and is used
only to build an authorization header; only generated text comes back out. This keeps the key out of page memory,
avoids WebView CORS entirely, and matches the existing rule that the frontend renders whatever the backend sends.

Exact model ids and base URLs are confirmed against provider documentation at implementation time and live in one
table, not scattered through the code.

## 7. Scope and phasing

**v1** — keyed cloud providers, F1–F5, Digest, Cache, pickers, the AI panel.
**Deferred** — Ollama and local inference, streaming, Anthropic/Google adapters, chat, the global cache.

Ollama is deferred because the feature cannot be *tested* without a machine that reliably runs a local model, and
an untestable provider path is worse than an absent one. Because Ollama is OpenAI-compatible it slots in behind the
same client when it lands, and it remains the only option consistent with the app's local-first framing — so the
egress notice in §8 has to be honest in the meantime.

## 8. Security, privacy, and egress

- **This feature sends your code to a third party.** The README leads with "local-first desktop app" and the
  original design spec lists "Cloud anything" as out of scope. That is a positioning change, so it is explicit: AI
  is off until a key is entered, the first summary for a project states which Provider will receive the code, and
  the result header keeps showing it.
- **Key storage is the OS keyring**, so it is not in a plain file the app's own source tree can leak. The key never
  crosses the IPC boundary.
- **Nothing the model returns is ever executed or written.** v1 has no write path at all: answers are text rendered
  as Markdown. `react-markdown` does not execute embedded HTML, and it stays that way.
- **Repository content is untrusted data.** A README or comment can contain text addressed at a model. The task
  instruction stays in the system role and the Digest is passed as data; a summary is never treated as an
  instruction, least of all by the app itself.
- **Cost is bounded** by the per-layer budgets in §4 and shown per summary as token counts.

## 9. UI

- **Top bar:** an `AI` button beside `API`, present whenever a folder is open. It opens the AI panel: provider
  select, model, key entry, then the AI Tasks.
- **Gating (ask 1):** with no Provider Key every AI Task is disabled and greyed with an "Add an API key" reason;
  the key entry itself is always reachable, otherwise the app dead-ends.
- **Pickers (ask 5):** File Target is a checkbox tree over the Scope's folders and files; Definition Target is a
  checklist of one Code File's Definitions. Both read payloads the frontend already holds — `ProjectGraph` folders
  and files, `FunctionGraph` nodes — so neither needs a new backend command.
- **Results:** rendered in the Docs panel, reusing `MarkdownView`, with a header carrying task, model, cache age,
  and Regenerate. This costs no new rendering code and inherits the resizable split.
- **A finished Task stays visible as finished.** Once a Task has an answer, its entry is marked `✓` and clicking it
  puts that answer back on screen without a request. That mark is **asked of the store, never saved**: the panel
  probes with the same key the click would use, so a restart shows the same marks with no history kept anywhere, and
  an edit that changes what the Task reads takes the mark away on its own. The store remains the authority on what
  is reused, and reading a stored answer needs no Provider Key and no egress notice, because nothing leaves the
  machine.
- **The Relationship section** sits under the target choice and lists the counterparts of what is selected, grouped
  by how they connect: `calls` and `called by` for Definitions from the Function Graph's Cross-file Call Edges,
  `imports` and `imported by` for files, and a Scope's outbound boundary imports. A row carries no summary — it
  names one counterpart and offers **Generate**, which becomes `✓ Show` once that pair has an answer — and hovering
  it emphasises the two ends and the arrow between them in the graph. The same hover works from the info cards'
  existing imports/imported-by rows. The residual **IMPORTS / IMPORTERS NOT DRAWN** blocks are excluded, and by
  construction rather than by omission: every row in them names a counterpart with no node to light up.
- **Streaming** is deferred: it is the one requirement that forces chunked events across IPC, and summaries are
  short.

## 10. Backend surface

```
src-tauri/src/ai/
  mod.rs          wiring, shared payload types
  digest.rs       Digest, Layer, build(root, target) -> Digest
  cache.rs        SummaryCache: key_for(prompt), get, put, evict
  settings.rs     provider/model choice, Provider Key via keyring
  providers/      one OpenAI-compatible client, per-provider base URL + model table
src-tauri/src/commands/ai.rs   ai_settings, set_ai_key, ai_summary
```

`ai_summary(root, target, task, force)` is the one command the frontend calls: Rust builds the Digest, derives the
key, answers from the cache when it can, and only otherwise calls a provider and stores the result. A second
import or parse scan is never added beside this.

## 11. Testing

- **Digest:** a fixture project in a temp dir asserting the exact rendered text, byte-identical output across two
  builds, `truncated` at each budget, and L2 slices matching `startLine`/`endLine` exactly.
- **Cache:** round-trip; a changed Digest misses; a corrupt entry is a miss and not an error; eviction by count and
  by bytes; key stability across runs.
- **Providers:** request construction and response parsing against recorded fixtures. **No test performs network
  I/O**, and a 401 maps to an invalid-key message rather than a panic.
- **Frontend:** every AI Task disabled without a key; selection across both pickers; cache-age and Regenerate.

## 12. Success criteria

1. Project Overview on the 33-file project sends **under 4 KB** of Digest.
2. Asking the same question twice with no code change issues **zero** provider requests.
3. Changing one function invalidates only the summaries whose Digest covered it.
4. With no key, every AI Task is disabled and the key entry is still reachable.
5. `cargo test`, `npm test`, and `npm run build` pass; no test touches the network.

## 13. Traceability

| Ask | Where |
|---|---|
| 1 — AI menu, key entry, greyed-out gating | §9 |
| 2 — provider priority, other providers | §6 |
| 3 — choosing tasks after a key | §3, §9 |
| 4 — auto project overview, efficient context | §3 (F3), §4 |
| 5.1 — folder scope, choose files, explain interaction | §3 (F2), §9 |
| 5.2 — file scope, choose Definitions, explain interaction | §3 (F1), §9 |
| Avoid re-spending tokens on already-summarised code | §5 |
