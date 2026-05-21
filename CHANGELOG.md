# Changelog

All notable changes to `@kepello/nodegraph-mcp`. Format follows [Keep a Changelog](https://keepachangelog.com/).

## [1.0.0] — 2026-05-21

**Breaking** — substrate-mutation tools removed entirely. Closes Fathom row 5.0.62.

### Removed

- `MUTATION_TOOLS` set (`insert_node`, `supersede_node`, `tombstone_node`, `insert_edge`, `tombstone_edge`) and all five tool registrations.
- `allowDangerousMutations` option from `RegisterBuiltinGraphToolsOptions`.
- Five names from the `BuiltinGraphToolName` union — now `"get_node" | "query_nodes" | "get_edge" | "query_edges"` only.

### Why

Operator-led conversation 2026-05-21 worked through the four motivating cases for cross-domain raw mutation:

1. **Audit / forensics** — served by overlay-API expansion + storage-layer-internal utilities; doesn't justify a public surface.
2. **Migration** — already covered by the per-overlay migrator design (work row 1.12.2).
3. **Power-user investigations** — empirically not in use (the 5.0.40 gate has been off-by-default with zero callers); served by in-memory test fixtures + storage-layer utilities.
4. **Agent-driven raw mutation** — the antipattern. Original root cause of the 5.0.39 production bug class. Should not exist as a public surface.

Conclusion: no case requires a public cross-domain mutation API. The 5.0.40 gate (`allowDangerousMutations: true`) was an escape hatch protecting nothing real; the API surface rot it caused (5 unfixed TS2339 errors against `GraphLayer` interface read-only contract) was the visible cost. Deletion closes the bug class architecturally.

### Migration

Pre-prod; no migration path. The Fathom workspace had zero production callers of `allowDangerousMutations: true`. Test callers updated in this ship. The `nodegraph-mcp/src/builtin-tools.ts` entry in `fathom-cli/src/substrate-discipline.test.ts`'s allowlist removed in the same change-set — escape hatch no longer needs an exemption from the workspace-level discipline scan.

## [0.3.0] — 2026-05-19

**Breaking** — `registerBuiltinGraphTools` now registers READ-ONLY tools by default. Mutation tools require explicit `allowDangerousMutations: true` opt-in. Closes Fathom row 5.0.40. TDD-driven.

### Why

Per Fathom row 5.0.40: the five raw substrate-mutation MCP tools (`insert_node`, `supersede_node`, `tombstone_node`, `insert_edge`, `tombstone_edge`) bypass overlay invariants. The round-7 audit confirmed this is the same bug class that hit production in 5.0.39 (Haiku-enrichment scripts called `graph.supersedeNode` directly and lost cluster `groups` edges). Any LLM agent holding an MCP connection to a server that registers these tools can trigger the same substrate corruption against any domain.

### Changed

- **Default behavior**: `registerBuiltinGraphTools(server)` now registers only `get_node`, `query_nodes`, `get_edge`, `query_edges` (4 tools, all read-only).
- **Opt-in mutators**: `registerBuiltinGraphTools(server, { allowDangerousMutations: true })` restores the prior 9-tool default. Use only for power-user surfaces (e.g., audit / judgment overlays) that explicitly need free-form substrate writes and accept responsibility for invariant correctness.
- **`only` option unchanged**: when caller passes an explicit `only: [...]` list, it's honored verbatim (mutators allowed if listed; `allowDangerousMutations` has no effect).

### Tests

- 1 new regression test: default registration is read-only.
- 1 updated test: explicit `allowDangerousMutations: true` registers the full 9-tool set.
- 20/20 tests pass.

### Migration

Pre-prod; no migration path. Callers depending on the prior default-mutator behavior must add `allowDangerousMutations: true` explicitly. The Fathom workspace has zero such callers (confirmed via grep — `builtin-tools.ts` itself was the only place that registered them, and no production tool surface called those registrations).
