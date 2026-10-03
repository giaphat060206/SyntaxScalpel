# SyntaxScalpel

Local-first desktop app that dissects source files into interactive node graphs and renders Markdown documentation side by side. Built for fast onboarding onto undocumented codebases.

## Features

- **Project graph** — folders and files as nested blocks with file→file import edges, detected entry points, and external nodes
- **Function graph** — functions, classes, methods, and variables with call edges; 1-hop call tracing; click a definition to read its highlighted source beside the graph. Python, JavaScript/TypeScript, and Rust are parsed; Rust `struct`/`enum`/`trait`/`impl` targets and inline `mod`s are containers
- **Cross-file call edges** — one hop into the files a graph's code calls into or is called from: a dashed block per reached file holds the definitions the calls land on, and picking one reads that file's source. Resolved from declared imports; never transitive
- **Endpoints view** — HTTP endpoints extracted from OpenAPI/Swagger documents, swagger-jsdoc `@openapi` comments, and Next.js App Router handlers, with request/response schemas and a jump to the handler
- **Markdown rendering** — GFM, syntax highlighting, and checkboxes, shown alongside the graph
- Search across the active graph plus recent folders and resizable panels
- Node layout is computed by Eclipse Layout Kernel (ELK), which also routes the edges orthogonally; positions are not persisted (dragging a block is temporary)

## Requirements

- Node.js 20.19+
- Rust (stable toolchain)
- Windows 10/11 with WebView2 (ships with Windows 11 and is normally present on Windows 10 via Microsoft Edge)

## Development

```powershell
npm install
npm run tauri dev
```

## Tests

```powershell
npm test
cargo test --manifest-path src-tauri/Cargo.toml
```

## Roadmap

Go, C, C++, Java, and C# support are planned. HTML/CSS are out of scope for the graph model. See `docs/superpowers/specs/2026-09-22-syntaxscalpel-design.md` for the full design.
