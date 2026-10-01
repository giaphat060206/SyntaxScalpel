# ELK owns placement and edge routing

ELK computes both node placement and orthogonal edge routing over compound, hierarchical graphs; a custom `ElkEdge` renders the routed sections. It runs in a worker with a bundled fallback and a timeout, and above the node cap or on any error the app falls back to the grid layout with `smoothstep` edges. ELK was chosen over React Flow's built-in layout or dagre because only ELK handles the compound Containers and orthogonal routing these graphs need.

## Consequences

The app carries the worker/fallback machinery and a custom edge renderer. Container padding reserves top space so Container titles are not overlapped.
