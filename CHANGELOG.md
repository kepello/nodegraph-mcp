# Changelog

All notable changes to `@kepello/nodegraph-mcp`. Format follows [Keep a Changelog](https://keepachangelog.com/).

## [1.2.0] — 2026-06-11

Two observability fixes from Fathom row 5.0.101 follow-up review (F3 + F4). `wrapResultWithMeta` was silently dropping `_meta.storeReopened` for pre-built `CallToolResult` envelopes (NSD gap — F4). The F3 regression test was calling `graph.ensureStoreCurrent()` directly, skipping the `server.ts` handler wiring it was supposed to pin.

### Fixed

- **F4 — `wrapResultWithMeta` now injects `_meta` into pre-built `CallToolResult` envelopes** — previously returned the value unchanged, silently dropping `storeReopened: true`. Now merges `meta` into the top-level `_meta` field (existing `_meta` is merged, not replaced). `McpCallToolResult` interface gains `_meta?: Record<string, unknown>` to reflect the MCP spec field.
- **F3 — store-reopen e2e test now exercises the full SDK transport path** — replaced the direct `graph.ensureStoreCurrent()` call with `InMemoryTransport.createLinkedPair()` + `Client.callTool()`, so the test actually traverses the `server.ts:90` handler wrapper. Test forces `storeReplaced=true`, calls the tool, parses `content[0].text`, and asserts `_meta.storeReopened === true`.

### Tests

`src/__tests__/store-reopen-meta.test.ts` replaces 2 tests (passthrough + direct-call) with 3 new ones: (a) pre-built `CallToolResult` gets `_meta.storeReopened` injected (F4); (b) pre-built `CallToolResult` with existing `_meta` gets `storeReopened` merged — not lost (F4 merge); (c) full SDK-transport e2e — `client.callTool()` drives the handler, `_meta.storeReopened=true` observed in the parsed response (F3). RED witnessed: F4 test failed because `_meta` was absent; F3 test was vacuously passing the old direct call. 26/26 pass (was 25/25, net +1).

## [1.1.0] — 2026-06-11

`GraphMcpServer.registerTool` calls `ensureStoreCurrent()` before every tool handler and surfaces `_meta.storeReopened: true` when a reopen fired (Fathom row 5.0.101 `mcp-cluster-overlay-staleness`). One `statSync` per call in `storeReplaced()` — cheap. Exports `wrapResultWithMeta` for the observable recovery signal.

### Added

- **`wrapResultWithMeta(value, meta)`** — wraps a handler's return value as `wrapResult` does, plus merges `meta` fields into the top-level `_meta` key. Used by `registerTool` to attach `storeReopened: true` on responses where a reopen fired. Handles plain objects (merge), strings (wrap as `{result, _meta}`), and pre-built `CallToolResult` (pass through unchanged — treated as opaque).

### Changed

- **`registerTool` handler wrapper** — calls `graph.ensureStoreCurrent()` before invoking the handler; when it returns `true`, wraps the response with `_meta.storeReopened: true` so upstream consumers can surface the recovery signal.

### Tests

6 new tests in `src/__tests__/store-reopen-meta.test.ts`: `wrapResultWithMeta` plain-object, existing-_meta, string-wrap, CallToolResult passthrough; `ensureStoreCurrent` returns true when storeReplaced; returns false on normal path. 25/25 pass (was 19/19).

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
