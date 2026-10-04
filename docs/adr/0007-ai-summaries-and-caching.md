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
separate invalidation pass. Summaries live one JSON file per key under `<root>/.scalpel/ai/`, so a partial write
cannot corrupt the set, and an unreadable entry is a miss rather than an error.

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
- Nothing a model returns is executed or written. v1 has no write path, answers are rendered as Markdown, and
  repository content is passed as data — a README addressed at a model is a prompt-injection attempt, not an
  instruction the app may follow.
- Streaming is deferred, so summaries arrive whole; that is the one requirement that would force chunked events
  across IPC.
- A per-project cache means the same code summarised in two checkouts is paid for twice. A content-keyed global
  cache is the natural follow-up and is out of scope.
