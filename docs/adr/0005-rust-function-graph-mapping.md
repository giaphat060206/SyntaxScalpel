# Rust reuses the Function Graph vocabulary

Rust has no classes, so its items must be projected onto the existing `function | class | method | variable`
kinds rather than extending the payload. `struct`, `enum`, `union`, `trait`, each `impl` target, and each inline
`mod` become **Class** Containers; a `fn` inside one becomes a **Method** (`Type.fn`, or `module.Type.fn` for a
method of a type declared inside an inline module) and a `fn` at file level becomes a **Function**; `const` and
`static` become **Variables**. An `impl` block for a type the file does not declare still opens a Container, so
`impl Display for Foo` groups under `Foo` and never leaves methods parentless.

Two rules keep this model one container level deep, which is all the frontend renders: an inline `mod` is the
Container for everything inside it, and only file-level items open a Container. The cost is that a type declared
inside an inline module has no Container of its own — its methods group under the module instead.

## Consequences

- Rust needs no payload, serializer, or renderer change; only `parser/rust.rs`, the extension route, an IPC
  wrapper, and a highlight.js grammar. Adding a language stays one extraction module plus a grammar crate
  (ADR-0001), plus those four frontend touchpoints.
- `impl Trait for Type` groups under `Type`, not `Trait`, so a type's methods read as one unit; a trait's own
  declared and defaulted methods group under the trait (`function_signature_item` is a Method with no body).
- A method's Container always exists in the same payload, which the frontend requires: a Node whose `parent`
  names no top-level Container is dropped from the graph.
- Calls inside a macro invocation's arguments produce no Call Edge, because the grammar leaves macro arguments as
  unexpanded token trees. Line ranges include `#[attribute]` lines, the Rust equivalent of Python decorators.
- Rust parameters render **as written** (`&self`, `factor: i32`), matching how JS/TS renders destructured
  parameters; `returns` come from `return` expressions and fall back to the block's trailing expression, which is
  the idiomatic Rust return.
- Module paths resolve without reading `Cargo.toml`: `crate` walks up from the importing file, `self`/`super`
  follow the module-file layout (`a/b.rs` owns `a/b/`), trailing segments that name items are dropped
  progressively, and `mod.rs` is a directory index. A `mod foo;` declaration is an Import Edge on the module file.
