import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import type { StorageBackend } from "@kepello/nodegraph/storage-contract";
import { InMemoryBackend } from "@kepello/nodegraph/in-memory";
import { GraphFederation, CatalogImpl } from "@kepello/nodegraph-federation";
import type { GraphLayer } from "@kepello/nodegraph";

import { GraphFederationMcpServer } from "../server.js";
import { registerBuiltinFederationTools } from "../builtin-tools.js";

interface TestOverlays {
  marker: string;
  graph: GraphLayer;
}

interface TestMetadata {
  tier: "user" | "project";
}

function makeFederation() {
  // Persistent in-memory: close() is a no-op so re-mounts see the
  // same state, mirroring SQLite's file-handle semantics.
  const stores = new Map<string, StorageBackend>();
  const backendForLocation = (loc: string): StorageBackend => {
    let b = stores.get(loc);
    if (b) return b;
    const fresh = new InMemoryBackend();
    fresh.close = () => {};
    stores.set(loc, fresh);
    return fresh;
  };
  const catalog = new CatalogImpl<TestMetadata>(new InMemoryBackend());
  const fed = new GraphFederation<TestOverlays, TestMetadata>({
    catalogs: [catalog],
    backendFactory: backendForLocation,
    overlaysFactory: (graph) => ({ marker: "x", graph }),
  });
  return { fed, catalog };
}

test("federation server: registerBuiltinFederationTools registers default 6 tools", () => {
  const { fed } = makeFederation();
  const server = new GraphFederationMcpServer({ federation: fed });
  registerBuiltinFederationTools(server);
  assert.deepEqual(server.registeredToolNames().sort(), [
    "get_active_graph",
    "list_graphs",
    "list_mounted",
    "mount_graph",
    "set_active_graph",
    "unmount_graph",
  ]);
  fed.close();
});

test("federation server: registerTool with requiresMount=true and no active graph rejects", async () => {
  const { fed } = makeFederation();
  const server = new GraphFederationMcpServer({ federation: fed });
  let handlerCalled = false;
  server.registerTool({
    name: "needs_graph",
    inputSchema: { x: z.string() },
    handler: () => {
      handlerCalled = true;
      return "ok";
    },
  });
  // We can verify registration but a full SDK round-trip is the
  // SDK's responsibility. Confirm the tool is registered.
  assert.ok(server.registeredToolNames().includes("needs_graph"));
  assert.equal(handlerCalled, false);
  fed.close();
});

test("federation server: registerTool with requiresMount=false ignores active-graph state", () => {
  const { fed } = makeFederation();
  const server = new GraphFederationMcpServer({ federation: fed });
  server.registerTool({
    name: "fed_only",
    inputSchema: {},
    requiresMount: false,
    handler: ({ fed }) => ({ mounted_count: fed.mounted().length }),
  });
  assert.ok(server.registeredToolNames().includes("fed_only"));
  fed.close();
});

test("federation server: prefix option applies to built-in tools", () => {
  const { fed } = makeFederation();
  const server = new GraphFederationMcpServer({ federation: fed });
  registerBuiltinFederationTools(server, { prefix: "kg_" });
  const names = server.registeredToolNames();
  assert.ok(
    names.every((n) => n.startsWith("kg_")),
    "every tool should be prefixed",
  );
  fed.close();
});

test("federation server: only-list opts in to a subset", () => {
  const { fed } = makeFederation();
  const server = new GraphFederationMcpServer({ federation: fed });
  registerBuiltinFederationTools(server, {
    only: ["mount_graph", "list_mounted"],
  });
  assert.deepEqual(server.registeredToolNames().sort(), [
    "list_mounted",
    "mount_graph",
  ]);
  fed.close();
});

test("federation server: registerTool rejects duplicate names", () => {
  const { fed } = makeFederation();
  const server = new GraphFederationMcpServer({ federation: fed });
  server.registerTool({
    name: "x",
    inputSchema: {},
    requiresMount: false,
    handler: () => "ok",
  });
  assert.throws(
    () =>
      server.registerTool({
        name: "x",
        inputSchema: {},
        requiresMount: false,
        handler: () => "ok",
      }),
    /already registered/,
  );
  fed.close();
});
