# Cross-file Call Edges, one hop, drawn as dashed blocks

ADR-0001 kept a Function Graph to one file, so cross-file call flow was readable only by opening each file in
turn — the most common question a newcomer has. A Function Graph therefore also resolves the Call Edges that leave
or enter the file it shows: one hop, never transitively. The far side's Definitions are materialised in a dashed
block per file so the arrow has something to land on. Resolution reuses what the Project Graph already computes
(`extract_imports` plus the `Resolver`) together with each Definition's call names, so no language module gained
cross-file rules. Considered a project-wide call graph (unbounded, and the Project Graph already answers "what
depends on what") and a receiver-tracking resolver (needs per-language work in all three modules); both are out of
scope for now.

## Consequences

- Extraction still costs one module plus a grammar crate per language (ADR-0001), but the Function Graph now ships
  a neighbourhood, so how well a language answers cross-file questions depends on how well its specifiers and call
  names resolve.
- A Definition in another file is reached when its own name is imported and the calling Definition uses it: a
  file-level function or class directly (`from file2 import func2` then `func2()`, or `Path(...)` for a class), and
  a Method through its Container (`from file2 import Thing` then `Thing().run()`). A module-level binding is never
  a target — a matching call name is coincidence rather than a call to it. Namespace-qualified calls (`import
  file2` then `file2.func2()`, `import * as f2`) are missed until receivers are tracked.
- Cross-file is asymmetric with in-file on purpose: `Thing()` draws a Call Edge across a file boundary where an
  in-file Call Edge deliberately draws none. A cross-file construction is a real file dependency; an in-file one is
  noise. The arrow therefore means "calls, or constructs when it crosses a file", and only the target's kind label
  tells the two apart.
- An Import that resolves to a barrel which only re-exports (a Python `__init__.py`, a TS `index.ts`, a Rust
  `mod.rs`) has the name followed to the file that declares it, up to three hops with a visited set so a
  re-export cycle terminates. The dashed block is therefore labelled with the **declaring** file, which can differ
  from the specifier that was written — and from the file the Project Graph draws its Import Edge to, since that
  still resolves the specifier. Going through more hops than the cap leaves the Import as text.
- Blocks are capped by file and by Definition and the payload reports truncation: an import-heavy file can
  otherwise add hundreds of Nodes and push ELK onto its grid fallback.
- The Imports and Imported-By Blocks become residuals — they list only what no block could draw — and are omitted
  when empty.
- Calls inside a macro invocation's arguments stay invisible, which now also hides a Cross-file Call Edge.
- A block never nests deeper than one level: the file block is itself the Container for the Definitions it holds,
  so a Method's `Container.method` id keeps its context without a second Container.
