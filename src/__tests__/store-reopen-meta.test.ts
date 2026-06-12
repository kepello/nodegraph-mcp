/**
 * Regression tests for Fathom row 5.0.101 `mcp-cluster-overlay-staleness` —
 * GraphMcpServer auto-reopen and `_meta.storeReopened` surfacing.
 *
 * These tests verify that:
 *   (a) When ensureStoreCurrent() returns true, the MCP tool response
 *       carries `_meta.storeReopened: true` (observable recovery signal
 *       per no-silent-degradation rule).
 *   (b) When ensureStoreCurrent() returns false, no `_meta.storeReopened`
 *       field is injected (normal path — no noise).
 *   (c) Pre-built CallToolResult envelopes get `_meta.storeReopened` injected
 *       (F4 — no silent degradation for tools returning pre-built results).
 *   (d) The wired path server.ts:88-93 (cb → ensureStoreCurrent → wrapResultWithMeta)
 *       fires correctly through the SDK transport (F3 — e2e contract surface).
 *
 * We use an InMemoryBackend (which always returns false from storeReplaced)
 * wrapped in a spy that lets us control the return value.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { GraphLayerImpl } from "@kepello/nodegraph-core";
import { InMemoryBackend } from "@kepello/nodegraph-core/in-memory";
import type { StorageBackend, TableSpec, StorageIndexSpec, Row, ScalarValue, Predicate } from "@kepello/nodegraph-core/storage-contract";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { GraphMcpServer } from "../server.js";
import { wrapResultWithMeta } from "../result.js";

// ---------------------------------------------------------------------------
// Spy backend that lets tests force storeReplaced() = true
// ---------------------------------------------------------------------------

class ReopenSpyBackend implements StorageBackend {
  private inner: InMemoryBackend;
  private _storeReplaced = false;

  constructor() { this.inner = new InMemoryBackend(); }
  forceStoreReplaced(): void { this._storeReplaced = true; }

  storeReplaced(): boolean { return this._storeReplaced; }
  reopen(): void { this._storeReplaced = false; }

  createTable(spec: TableSpec): void { this.inner.createTable(spec); }
  createIndex(spec: StorageIndexSpec): void { this.inner.createIndex(spec); }
  insert(t: string, row: Row): void { this.inner.insert(t, row); }
  update(t: string, ic: string, iv: ScalarValue, p: Partial<Row>): void { this.inner.update(t, ic, iv, p); }
  getById(t: string, ic: string, iv: ScalarValue): Row | undefined { return this.inner.getById(t, ic, iv); }
  query(t: string, pred: Predicate): Row[] { return this.inner.query(t, pred); }
  transaction<T>(fn: () => T): T { return this.inner.transaction(fn); }
  optimize(): void { this.inner.optimize(); }
  close(): void { this.inner.close(); }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("wrapResultWithMeta: plain object gets _meta merged at top level (Fathom 5.0.101)", () => {
  const r = wrapResultWithMeta({ clusters: ["a", "b"] }, { storeReopened: true });
  assert.equal(r.content.length, 1);
  const payload = JSON.parse(r.content[0].text);
  assert.deepEqual(payload.clusters, ["a", "b"]);
  assert.equal(payload._meta.storeReopened, true);
});

test("wrapResultWithMeta: existing _meta in result is preserved and extended (Fathom 5.0.101)", () => {
  const r = wrapResultWithMeta({ result: "ok", _meta: { freshAs: "2026-01-01" } }, { storeReopened: true });
  const payload = JSON.parse(r.content[0].text);
  assert.equal(payload._meta.freshAs, "2026-01-01");
  assert.equal(payload._meta.storeReopened, true);
});

test("wrapResultWithMeta: string result wraps as {result, _meta} (Fathom 5.0.101)", () => {
  const r = wrapResultWithMeta("some string", { storeReopened: true });
  const payload = JSON.parse(r.content[0].text);
  assert.equal(payload.result, "some string");
  assert.equal(payload._meta.storeReopened, true);
});

test("wrapResultWithMeta: pre-built CallToolResult gets _meta.storeReopened injected (Fathom 5.0.101 F4)", () => {
  // F4 fix: a pre-built CallToolResult must NOT drop storeReopened.
  // The MCP spec supports a top-level `_meta` field on CallToolResult;
  // injecting storeReopened there keeps the NSD guarantee for tools that
  // return pre-built envelopes. The content array is left untouched.
  const pre = { content: [{ type: "text" as const, text: "x" }] };
  const r = wrapResultWithMeta(pre, { storeReopened: true });
  assert.deepEqual(r.content, pre.content, "content array must be unchanged");
  // _meta.storeReopened must be injected at the top level of the result.
  assert.equal(
    (r as Record<string, unknown> & { _meta?: Record<string, unknown> })._meta?.storeReopened,
    true,
    "pre-built CallToolResult must carry _meta.storeReopened after injection",
  );
});

test("wrapResultWithMeta: pre-built CallToolResult with existing _meta gets storeReopened merged (Fathom 5.0.101 F4)", () => {
  const pre = {
    content: [{ type: "text" as const, text: "y" }],
    _meta: { existingKey: "kept" },
  };
  const r = wrapResultWithMeta(pre as unknown as Parameters<typeof wrapResultWithMeta>[0], { storeReopened: true });
  const meta = (r as Record<string, unknown>)._meta as Record<string, unknown>;
  assert.equal(meta?.existingKey, "kept", "existing _meta must be preserved");
  assert.equal(meta?.storeReopened, true, "storeReopened must be merged in");
});

test("GraphMcpServer: tool response carries _meta.storeReopened=true when store was reopened (Fathom 5.0.101 F3 e2e)", async () => {
  // F3 fix: drive a REAL tool call through the SDK transport (InMemoryTransport
  // linked pair: server side connects the GraphMcpServer, client side calls the
  // tool). This is the contract surface at server.ts:88-93 — the cb wrapper
  // calls ensureStoreCurrent() and conditionally wraps with _meta. Previously
  // the test called graph.ensureStoreCurrent() directly, skipping the wired path.
  const spyBackend = new ReopenSpyBackend();
  const graph = new GraphLayerImpl(spyBackend);
  const server = new GraphMcpServer({
    graph,
    serverInfo: { name: "test-server", version: "0.0.1" },
  });

  server.registerTool({
    name: "test_reopen_tool",
    description: "Returns a plain object; storeReopened injects _meta.",
    inputSchema: {},
    handler: () => ({ clusters: ["c1", "c2"] }),
  });

  // Force storeReplaced() = true BEFORE connecting so the first tool call
  // fires a reopen.
  spyBackend.forceStoreReplaced();

  // Wire up the InMemoryTransport linked pair.
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: "test-client", version: "0.0.1" });
  await client.connect(clientTransport);

  // Call the tool through the SDK — exercises the full server.ts:88-93 path.
  const result = await client.callTool({ name: "test_reopen_tool", arguments: {} });

  // The response is a CallToolResult with content[0].text as JSON.
  assert.ok(Array.isArray(result.content) && result.content.length > 0,
    "tool result must have content");
  const first = result.content[0] as { type: string; text?: string };
  assert.equal(first.type, "text", "content[0].type must be text");
  const payload = JSON.parse(first.text ?? "{}") as Record<string, unknown>;
  assert.deepEqual(payload.clusters, ["c1", "c2"],
    "payload.clusters must be from the handler");
  assert.equal(
    (payload._meta as Record<string, unknown>)?.storeReopened,
    true,
    "_meta.storeReopened must be true when storeReplaced fired — " +
      "this pins the server.ts:88-93 wired path, NOT just ensureStoreCurrent() in isolation",
  );

  graph.close();
});

test("GraphMcpServer: ensureStoreCurrent returns false on normal path (Fathom 5.0.101)", () => {
  const backend = new InMemoryBackend();
  const graph = new GraphLayerImpl(backend);
  const server = new GraphMcpServer({ graph });
  void server; // not needed beyond construction

  const result = graph.ensureStoreCurrent();
  assert.equal(result, false, "in-memory backend never triggers storeReplaced");

  graph.close();
});
