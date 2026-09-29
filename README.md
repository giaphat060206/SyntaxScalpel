# SyntaxScalpel

Local-first desktop app that dissects source files into interactive node graphs and renders Markdown documentation side by side. Built for fast onboarding onto undocumented codebases.

## Features

- Parse Python (`.py`) and JavaScript/TypeScript (`.js`, `.jsx`, `.ts`, `.tsx`) into call graphs
- Class and method nesting, plus function inputs (params) and outputs (return names)
- 1-hop call tracing: click a node to highlight its callers and callees
- Markdown rendering (GFM, syntax highlighting, checkboxes)
- Resizable split view: design spec on the left, implementation graph on the right
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

Go, C, C++, Java, C#, and Rust support are planned. HTML/CSS are out of scope for the graph model. See `docs/superpowers/specs/2026-09-22-syntaxscalpel-design.md` for the full design.
