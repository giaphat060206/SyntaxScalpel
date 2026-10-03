# SyntaxScalpel

SyntaxScalpel is a local-first desktop app for codebase comprehension. It parses a local project into interactive
graphs so a newcomer can read structure and dependencies quickly, and renders Markdown documentation alongside.
It shows two graphs: a **Project Graph** across folders and files, and a **Function Graph** within one file.

## Language

### Graphs

**Project Graph**:
The graph of one Scope — folder Containers holding file Leaves, joined by Import Edges.
_Avoid_: folder graph, project view, project mode

**Function Graph**:
The graph of one code file — its Definitions as Nodes joined by Call Edges.
_Avoid_: code graph, call graph, function/class graph

### Graph elements

**Node**:
A graph element with an id, a kind, and the Edges that touch it.
_Avoid_: vertex

**Block**:
The rectangle a Node is rendered as — either a Container or a Leaf.

**Container**:
A Block that holds other Blocks: a Class in a Function Graph, a folder in a Project Graph.
_Avoid_: group

**Leaf**:
A Block that holds no other Blocks: a Definition in a Function Graph, a file in a Project Graph.

**Edge**:
A link between two Nodes; always qualified by its graph.
See: Call Edge, Import Edge.

**Call Edge**:
An Edge in a Function Graph, from a caller Definition to a callee Definition.
See: Cross-file Call Edge.

**Import Edge**:
An Edge in a Project Graph, from an importing file to an imported file inside the Scope.

### Project Graph concepts

**Entry Point**:
A file detected as a likely program start within a Scope; a Scope can have several.
The **Start panel** lists them.
_Avoid_: entry, start (for an Entry Point)

**External Node**:
A Leaf in a Project Graph standing for an Import target outside the Scope; no file lies behind it.
_Avoid_: external target, dependency

### Cross-file concepts

**Cross-file Call Edge**:
A Call Edge whose far end is a Definition in another file. A Function Graph resolves these one hop out, never
transitively.
_Avoid_: cross-file reference, external call

**Cross-file Block**:
The dashed Container in a Function Graph standing for another file, holding the Definitions its Cross-file Call
Edges reach. One level deep: the block is itself the Container, so a Method appears as `file::Container.method`
without a second Container.
_Avoid_: external node (that is a Project Graph Leaf outside the Scope), external block

### API

**Endpoint**:
An HTTP operation an API Source documents — a method and a path, with its parameters, request body, and
responses.
_Avoid_: route, API call

**API Source**:
A place SyntaxScalpel reads API definitions from: an OpenAPI/Swagger spec file, an `@openapi` comment block, or a
framework route convention. An API Source yields Endpoints.
_Avoid_: API doc, spec (unqualified)

**Fidelity**:
How far an Endpoint's input/output detail can be trusted: `full` when a published contract supplies field-level
schemas, `heuristic` when it is inferred from framework conventions.

### Dependencies

**Import**:
A dependency a file names.

**Specifier**:
The raw import string as written in source.

**Resolve**:
Turning a Specifier into a target file inside the Scope; a target outside the Scope becomes an External Node.
_Avoid_: resolve path

**Importer**:
A file that imports another.
**Imported By**:
The reverse relation — the files that import a given file.

**Uses**:
The imported names a Definition actually references.
_Avoid_: require, dependency (unqualified)

### Code units

**Definition**:
A clickable code unit in a Function Graph — a Function, Class, Method, or Variable.

**Function**:
A Definition for a named callable that is not a Method.

**Class**:
A Definition that is a Container in a Function Graph and holds Method Definitions.
In Rust the Container is a `struct`, `enum`, `union`, `trait`, an `impl` target, or an inline `mod`.

**Method**:
A Definition for a callable belonging to a Class or object.

**Variable**:
A Definition for a top-level binding; the Constants Container groups these.
_Avoid_: constant (for the kind — see Constants Container)

**Symbol**:
A single entry in the search box's result list.
_Avoid_: symbol (for a Definition)

**Special Block**:
A synthetic Block in a Function Graph with no backing Definition.
_Avoid_: special node, pseudo-node

**Imports Block**:
A Special Block listing the Imports no Cross-file Block could draw: specifiers that resolved to no file, and
resolved ones whose Definitions nothing calls. Omitted when there is nothing left over.

**Imported-By Block**:
A Special Block listing the files that Import this file and drew no Cross-file Block. Omitted when there is
nothing left over.

**Constants Container**:
A Special Block grouping the file's Variable Definitions.
_Avoid_: constants (as a kind)

### Navigation

**Location**:
What the content pane currently shows.
See: Folder Location, Code Location, Endpoints Location.
_Avoid_: code (unqualified, for a file kind)

**Folder Location**:
A Location showing a Scope's Project Graph.

**Code Location**:
A Location showing a Code File's Function Graph.

**Endpoints Location**:
A Location showing the Endpoints found across a Scope's API Sources.

**API Base**:
The path prefix an API Source declares (an OpenAPI `servers` URL path or Swagger `basePath`); Endpoint paths are
shown relative to it. Absent when the source declares none.

**Code File**:
A file parsed by a language module.
_Avoid_: file (unqualified)

**Doc File**:
A Markdown file rendered as documentation.

### Interaction

**Graph Canvas**:
The interactive surface that renders one Graph's Nodes and Edges; where pan, zoom, Selection, and Re-align happen.

**Selection**:
The Node the user last clicked; every unrelated Node and Edge dims.

**Trace**:
The 1-hop Call Edge neighbourhood of a Selection in a Function Graph.

**Focus**:
The files whose direct Import Edges stay bright under a Selection in a Project Graph.

**Hidden**:
A Block removed from view by collapsing its Container.

**Truncated**:
A Project Graph that stopped at the file cap before covering the whole Scope.

**Re-align**:
Recomputing a graph's layout on demand.
