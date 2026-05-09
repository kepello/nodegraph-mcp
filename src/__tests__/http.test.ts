/*
 * HTTP transport tests — exercises `startHttpTransport` end-to-end:
 * binds an ephemeral port, connects an MCP server, sends an
 * `initialize` JSON-RPC request, validates the response.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { GraphLayerImpl } from "@kepello/nodegraph-core";
import { InMemoryBackend } from "@kepello/nodegraph-core/in-memory";

import { GraphMcpServer } from "../server.js";
import { startHttpTransport } from "../http.js";

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string };
}

async function postJson(
  url: string,
  body: object,
): Promise<{ status: number; body: JsonRpcResponse | undefined; raw: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  // Streamable transport returns either plain JSON or an SSE single-event
  // response (`event: message\ndata: {...}`) depending on stream mode.
  let parsed: JsonRpcResponse | undefined;
  try {
    parsed = JSON.parse(raw) as JsonRpcResponse;
  } catch {
    const dataLine = raw.split("\n").find((l) => l.startsWith("data:"));
    if (dataLine) {
      try {
        parsed = JSON.parse(dataLine.slice("data:".length).trim()) as JsonRpcResponse;
      } catch {
        parsed = undefined;
      }
    }
  }
  return { status: res.status, body: parsed, raw };
}

test("startHttpTransport — binds ephemeral port and serves MCP initialize", async () => {
  const graph = new GraphLayerImpl(new InMemoryBackend());
  const server = new GraphMcpServer({
    graph,
    serverInfo: { name: "test-server", version: "0.0.1" },
  });
  server.registerTool({
    name: "ping",
    inputSchema: { msg: z.string() },
    handler: ({ input }) => ({ pong: input.msg }),
  });

  const handle = await startHttpTransport((t) => server.connect(t));
  try {
    assert.ok(handle.port > 0, "ephemeral port allocated");
    assert.equal(handle.host, "127.0.0.1");
    assert.equal(handle.path, "/mcp");

    const url = `http://${handle.host}:${handle.port}${handle.path}`;
    const init = await postJson(url, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test-client", version: "0.0.1" },
      },
    });
    assert.equal(init.status, 200, `expected 200, got ${init.status} — body: ${init.raw}`);
    assert.ok(init.body, `expected JSON body — got: ${init.raw}`);
    assert.equal(init.body!.jsonrpc, "2.0");
    assert.equal(init.body!.id, 1);
    assert.ok(init.body!.result, "initialize should return a result");
  } finally {
    await handle.close();
  }
});

test("startHttpTransport — explicit port is honored", async () => {
  const graph = new GraphLayerImpl(new InMemoryBackend());
  const server = new GraphMcpServer({ graph });

  // Pick a high port unlikely to collide.
  const handle = await startHttpTransport((t) => server.connect(t), {
    port: 41234,
  });
  try {
    assert.equal(handle.port, 41234);
  } finally {
    await handle.close();
  }
});

test("startHttpTransport — close() shuts down the HTTP server", async () => {
  const graph = new GraphLayerImpl(new InMemoryBackend());
  const server = new GraphMcpServer({ graph });
  const handle = await startHttpTransport((t) => server.connect(t));
  await handle.close();
  // Re-binding the same port should now succeed (ie. the previous
  // server actually released the socket).
  const handle2 = await startHttpTransport((t) => server.connect(t), {
    port: handle.port,
  });
  try {
    assert.equal(handle2.port, handle.port);
  } finally {
    await handle2.close();
  }
});

test("startHttpTransport — non-/mcp path returns 404", async () => {
  const graph = new GraphLayerImpl(new InMemoryBackend());
  const server = new GraphMcpServer({ graph });
  const handle = await startHttpTransport((t) => server.connect(t));
  try {
    const res = await fetch(`http://${handle.host}:${handle.port}/wrong`, {
      method: "POST",
      body: "{}",
    });
    assert.equal(res.status, 404);
  } finally {
    await handle.close();
  }
});
