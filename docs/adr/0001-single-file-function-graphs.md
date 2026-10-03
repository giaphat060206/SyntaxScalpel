# Single-file Function Graphs with in-file Call Edges only

> **Superseded by [ADR-0006](0006-cross-file-call-edges.md)**, which draws one-hop Cross-file Call Edges and
> materialises the Definitions they reach. The reasoning below is kept for context; the Project Graph is still
> the answer for project-wide dependency questions.

A Function Graph covers exactly one file, and a Call Edge is drawn only when the callee Definition lives in that same file; cross-file and external calls produce no edge. Resolving calls across files needs import- and type-aware analysis with per-language rules, which would balloon every language module, while the Project Graph already answers cross-file dependency questions through Import Edges. Considered a project-wide call graph and cross-file edge resolution; both are out of scope.

## Consequences

Adding a language stays a single extraction module plus a grammar crate, with no frontend or payload changes. A newcomer looking for cross-file call flow must read Import Edges and open each file's Function Graph in turn.
