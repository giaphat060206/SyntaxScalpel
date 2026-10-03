# Layout is not persisted

Graph layout is computed by ELK on load and recomputed after any drag; node positions are session-only, and `.scalpel/metadata.json` is neither read nor written. Autosave was removed because competing with ELK for placement produced a visible stutter and let stale positions survive a layout change. Dragging remains a temporary exploration aid.

## Consequences

Do not reintroduce layout persistence or an autosave hook without first revisiting ELK's ownership of placement. The Rust `load_layout`/`save_layout` commands, the `Position` payload field, and the parser's layout parameter are removed, and no parse path reads `.scalpel/metadata.json`.
