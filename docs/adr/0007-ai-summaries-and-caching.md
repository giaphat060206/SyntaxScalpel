# AI Summaries are Digest-grounded, provider-agnostic, and cached by prompt hash

SyntaxScalpel is local-first, and its original design spec listed cloud anything as out of scope. AI Summaries
change that: a user can hand selected code to a model and get an explanation back. Four decisions make the feature
worth having without turning the program into a thin wrapper around a chat box.

**Grounding comes from the Digest, not from the repository.** A Digest is a purpose-built text projection of code
the app has already parsed — structure, then signatures, then selected bodies, then docs. Measured on a real
33-file project, a whole-project structure Digest is **9,211 bytes** (~2.3K tokens) and 14,970 bytes with
signatures, covering 33 files and 264 Definitions — about 25× cheaper than the 231 KB of source it describes. The
app's existing IPC payloads, by contrast, run **1.12× to 3.58×** the size of the source they describe, because they
carry ids, line ranges, the neighbourhood, and the Import Analysis twice over: a single 109-line file's payload is
larger than the Digest of the entire project. Sending an IPC payload to a model would cost more than pasting the
file. Considered and rejected: letting the model read the repository itself through tools (unbounded round trips
and cost, and it re-derives a graph this app already computed), packing the repo into one file (a real pack of that
project was 19.2 MB, and it is blind to structure), and embeddings/RAG (a whole new subsystem whose retrieval
signal is worse here than the graph's).

**One client, many providers.** OpenRouter and DeepSeek — the two wanted first — are both OpenAI-compatible chat
completions, and so is Ollama. One client with a per-provider base URL and model table therefore covers the
priority list and the future local option. Providers with their own wire format (Anthropic, Google) become
adapters behind the same seam. Provider CLIs such as Claude Code and Codex are not APIs and are not integrated:
that would mean spawning child processes, which is a different architecture and not this program's job. Requests
are issued from Rust, so the Provider Key is used only to build an authorization header and never enters the
WebView.

**Caching is keyed by the exact prompt.** The key is `sha256(rendered prompt)` — task instruction, prompt version,
provider, model, and Digest. Hashing the text actually sent makes a stale summary structurally impossible: change
one line of one selected function and the Digest changes, so the key changes. There is no mtime comparison and no
separate invalidation pass. Summaries live one file per key under `<root>/.scalpel/ai/`, so a partial write cannot
corrupt the set, and an unreadable entry is a miss rather than an error.

**A stored summary is a Markdown document, not a cache blob.** Each entry is Markdown with a YAML front-matter
header carrying its task, provider, model, prompt version, tokens and timestamp, and the store keeps the same shape
the answer was generated in. A cache nobody can read is a cache nobody trusts: the header makes a stored file
self-describing, the body can be grepped like any other document, and because a summary is keyed by content rather
than by freshness, a hand-edited body is served like any other. The store therefore doubles as the place a person
reads summaries, and `Export` writes one entry to a path the user picks through the *same* renderer, so a stored
file and an exported file cannot drift apart. Considered a JSON blob (unreadable without the app, and the format
would then have to be reproduced for export) and a separate export-only format (two sources of truth for one
document).

**A connection is summarised as a pair, not as a file's view of it.** The Relationship Task's Target is two ends,
written caller first and each qualified by its own file, so the same relationship renders one identical Digest
whichever file it was asked from — and therefore one cache entry. Asking from the callee's side shows the answer
already bought from the caller's side, which is the property that makes a relationship summary worth generating at
all: it belongs to the relationship, not to the screen it was requested from. Direction is part of the identity, so
mutual recursion is two summaries, each true. The evidence is both signatures plus the exact call sites, which is
why the parser now records a line with every call. Considered keying by the viewed file (two entries for one
relationship, and a duplicate bill) and deriving the pair from a single canonical sort (wrong for a directed edge,
where who calls whom is the whole point).

**The local option is deferred, deliberately.** Ollama is the only provider consistent with a local-first claim,
but it cannot be tested on the machine this feature is being built on, and an untestable provider path is worse
than an absent one. v1 ships keyed cloud providers; because they share a wire format, Ollama is later an entry in a
table rather than a rewrite.

## Consequences

- **Code leaves the machine, so the app must say so.** AI is off until a Provider Key exists, the first summary for
  a project names the Provider that will receive the code, and the result header keeps naming it. The README's
  "local-first" claim and the original spec's "Cloud anything" line both need revisiting rather than quietly
  contradicting.
- `.scalpel/` gains its first writer. ADR-0002 is untouched — `.scalpel/metadata.json` is still neither read nor
  written, and layout stays session-only — but the ban must stay scoped to layout so a future reader does not read
  it as a ban on this cache. `<root>/.scalpel/ai/` is already gitignored.
- Editing a task template requires bumping `PROMPT_VERSION`, or entries generated from the old template keep being
  served. This is the one invalidation duty the design puts on a human.
- Digest layers are budgeted in **characters**, not tokens, so the cache key cannot drift with a tokeniser change.
  Token counts are recorded per summary for display, never used for keying.
- Truncation is reported rather than silent, so a bounded Digest never looks like a complete one. The Project Graph
  already set this precedent with its file cap.
- Nothing a model returns is executed, and nothing is written into the project tree. Answers are rendered as
  Markdown, the text persists only in the app's own `<root>/.scalpel/ai/` store, and `Export` writes only where the
  user points a save dialog. Repository content is passed as data — a README addressed at a model is a
  prompt-injection attempt, not an instruction the app may follow.
- Because the store is readable and keyed by content, it is also editable: someone who rewrites a body by hand gets
  their version back, with no token spent and no invalidation. Breaking the front-matter turns the entry into a
  miss, and eviction still applies, so the store remains a cache as well as a document.
- Eviction (200 entries or 4 MiB, oldest first) can drop a summary that was expensive to generate; content
  addressing means regenerating it is possible, not free. Entries from before this format are `.json` and are
  swept by the next eviction rather than read.
- Streaming is deferred, so summaries arrive whole; that is the one requirement that would force chunked events
  across IPC.
- A per-project cache means the same code summarised in two checkouts is paid for twice. A content-keyed global
  cache is the natural follow-up and is out of scope.
- The parser carries a line with every call site, so a Relationship Summary can quote the call that makes its claim
  true. That costs three language modules a slightly richer call record, and nothing in the IPC payloads.
- The Relationship list is only as complete as the graph: namespace-qualified calls (`file2.func2()`) and
  type-annotation-only imports produce no edge, and so no row. A Scope's inbound relationships are not derivable
  either — a file outside the project root is never parsed — so a Scope lists what it imports, while a file lists
  both directions.
- Hover emphasis is visual only: it never changes Selection, never opens the code pane and never triggers a request.
  The residual Imports and Imported-By Blocks cannot respond to it, because the counterpart they name is precisely
  the one with no node.
