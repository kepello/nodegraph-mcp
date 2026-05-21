import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { GraphLayerImpl } from "@kepello/nodegraph-core";
import { InMemoryBackend } from "@kepello/nodegraph-core/in-memory";

import { GraphMcpServer } from "../server.js";
import { registerBuiltinGraphTools } from "../builtin-tools.js";
import { wrapResult, wrapError } from "../result.js";

test("GraphMcpServer.registerTool tracks unique names", () => {
  const graph = new GraphLayerImpl(new InMemoryBackend());
  const server = new GraphMcpServer({ graph });
  server.registerTool({
    name: "ping",
    inputSchema: { msg: z.string() },
    handler: ({ input }) => ({ pong: input.msg }),
  });
  assert.deepEqual(server.registeredToolNames(), ["ping"]);
});

test("GraphMcpServer.registerTool rejects duplicate names", () => {
  const graph = new GraphLayerImpl(new InMemoryBackend());
  const server = new GraphMcpServer({ graph });
  server.registerTool({
    name: "ping",
    inputSchema: { msg: z.string() },
    handler: () => "ok",
  });
  assert.throws(
    () =>
      server.registerTool({
        name: "ping",
        inputSchema: { msg: z.string() },
        handler: () => "ok",
      }),
    /already registered/,
  );
});

test("registerBuiltinGraphTools registers exactly the four read-only tools (Fathom 5.0.62)", () => {
  // Per Fathom row 5.0.62: substrate mutators are NEVER exposed by
  // this package. The four cases that motivated cross-domain raw
  // mutation (audit/forensics, migration, power-user, agent-driven)
  // are either served by overlay-API expansion + storage-layer
  // internal utilities, or are the antipattern the overlay-discipline
  // rule exists to prevent. Pre-5.0.62 row 5.0.40 had gated them
  // behind `allowDangerousMutations: true`; the gate is now deletion.
  const graph = new GraphLayerImpl(new InMemoryBackend());
  const server = new GraphMcpServer({ graph });
  registerBuiltinGraphTools(server);
  const names = server.registeredToolNames().sort();
  assert.deepEqual(names, [
    "get_edge",
    "get_node",
    "query_edges",
    "query_nodes",
  ]);
});

test("registerBuiltinGraphTools honors prefix option", () => {
  const graph = new GraphLayerImpl(new InMemoryBackend());
  const server = new GraphMcpServer({ graph });
  registerBuiltinGraphTools(server, { prefix: "kg_" });
  const names = server.registeredToolNames();
  assert.ok(
    names.every((n) => n.startsWith("kg_")),
    "every name should start with kg_",
  );
});

test("registerBuiltinGraphTools honors only-list", () => {
  const graph = new GraphLayerImpl(new InMemoryBackend());
  const server = new GraphMcpServer({ graph });
  registerBuiltinGraphTools(server, {
    only: ["query_edges", "get_node"],
  });
  assert.deepEqual(
    server.registeredToolNames().sort(),
    ["get_node", "query_edges"],
  );
});

test("wrapResult passes through a CallToolResult unchanged", () => {
  const pre = { content: [{ type: "text" as const, text: "x" }] };
  assert.deepEqual(wrapResult(pre), pre);
});

test("wrapResult JSON-stringifies plain objects", () => {
  const r = wrapResult({ foo: 1 });
  assert.equal(r.content.length, 1);
  assert.equal(r.content[0].type, "text");
  assert.deepEqual(JSON.parse(r.content[0].text), { foo: 1 });
});

test("wrapResult passes strings through as text content", () => {
  const r = wrapResult("hello");
  assert.equal(r.content[0].text, "hello");
});

test("wrapError captures error message and sets isError", () => {
  const r = wrapError(new Error("boom"));
  assert.equal(r.isError, true);
  const payload = JSON.parse(r.content[0].text);
  assert.equal(payload.error, "boom");
});
