# Endpoints are extracted statically from declared contracts

The Endpoints view must list a project's HTTP endpoints and their input/output without running the backend. We
extract Endpoints statically from three declared sources behind one `analyze_api` seam — an OpenAPI/Swagger
document file, swagger-jsdoc `@openapi` comment blocks, and Next.js App Router route conventions — and never
execute or query the backend. This keeps the app local-first, offline, and deterministic, at the cost of fidelity:
published contracts (OpenAPI, `@openapi`) yield full field-level schemas, while framework conventions (Next.js)
yield reliable endpoints with heuristic I/O.

## Consequences

- Each backend paradigm needs its own source adapter; a framework without a declared contract is not covered until
  an adapter is added (a Supabase call-site adapter is a reserved slot).
- The high-fidelity path for any backend that can emit one is to drop its OpenAPI document into the project, which
  the spec-file adapter reads.
- Extraction reads only what the project declares; computed or runtime-assembled routes are missed.
