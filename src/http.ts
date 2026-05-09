/*
 * HTTP transport helper for nodegraph-mcp servers.
 *
 * Wraps `StreamableHTTPServerTransport` (from `@modelcontextprotocol/sdk`)
 * in a Node `http.Server` bound to localhost. The MCP SDK's transport
 * is per-request; this helper owns the HTTP server and routes incoming
 * POST/GET/DELETE on `/mcp` to `transport.handleRequest`.
 *
 * Stateless mode (one transport instance, no session IDs) — matches the
 * v1 daemon UX in `plans/fathom-cli-unified.md`. Stateful sessions are
 * a future concern (multi-client coordination, resumable streams).
 *
 * Localhost-only binding for v1 — no token auth, no TLS, no remote
 * access. Multi-host / token auth lands when a real workflow needs it.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export interface StartHttpTransportOptions {
  /**
   * Port to bind. Default: 0 (ephemeral; the OS picks a free port,
   * which is then exposed via the returned `port` field).
   */
  port?: number;
  /** Host to bind. Default: 127.0.0.1 (localhost-only). */
  host?: string;
  /** Path the MCP transport listens on. Default: `/mcp`. */
  path?: string;
}

export interface HttpTransportHandle {
  /** Actual port the HTTP server bound to (resolved when ephemeral). */
  port: number;
  /** Hostname the server bound to. */
  host: string;
  /** Path the MCP transport listens on. */
  path: string;
  /** Underlying transport — caller may inspect or attach handlers. */
  transport: StreamableHTTPServerTransport;
  /**
   * Stop the HTTP server + close the transport. Returns when both
   * have shut down.
   */
  close(): Promise<void>;
}

/**
 * Start an HTTP server hosting an MCP `StreamableHTTPServerTransport`,
 * connect it to the supplied MCP server, and return a handle.
 *
 * `connect` is the `mcpServer.connect(transport)` thunk — passed as a
 * callback so this helper stays decoupled from any particular server
 * wrapper class (works with both `GraphMcpServer` and the SDK's
 * `McpServer` directly).
 *
 * Example:
 *
 * ```ts
 * const handle = await startHttpTransport(
 *   (transport) => mcpServer.connect(transport),
 *   { port: 7321 },
 * );
 * console.log(`listening on http://${handle.host}:${handle.port}${handle.path}`);
 * // ... later
 * await handle.close();
 * ```
 */
export async function startHttpTransport(
  connect: (transport: Transport) => Promise<void>,
  options: StartHttpTransportOptions = {},
): Promise<HttpTransportHandle> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const path = options.path ?? "/mcp";

  // Stateless transport — no session IDs, no per-client state.
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await connect(transport);

  const server = createServer(async (req, res) => {
    if (!req.url || !req.url.startsWith(path)) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    try {
      const body = await readJsonBody(req);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end(msg);
      } else {
        try {
          res.end();
        } catch {
          // ignore — response may already be torn down
        }
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => reject(err);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.removeListener("error", onError);
      resolve();
    });
  });

  const addr = server.address() as AddressInfo | null;
  if (!addr) {
    server.close();
    throw new Error("startHttpTransport: server failed to bind (no address)");
  }

  const handle: HttpTransportHandle = {
    port: addr.port,
    host,
    path,
    transport,
    close: () =>
      new Promise<void>((resolve) => {
        // Closing the transport first stops new SSE streams; then close
        // the HTTP server (which waits for in-flight requests to finish).
        const finish = () => server.close(() => resolve());
        transport.close().then(finish, finish);
      }),
  };
  return handle;
}

/**
 * Read the entire request body and parse it as JSON. Returns
 * `undefined` for empty bodies (some MCP requests are GET / DELETE
 * with no body). Throws on parse failure so the caller can return a
 * 400.
 */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  if (req.method === "GET" || req.method === "DELETE") return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (raw.length === 0) return undefined;
  return JSON.parse(raw);
}

/**
 * Convenience: do not write directly to ServerResponse with the body —
 * the SDK's `transport.handleRequest` owns the response stream once
 * called. Re-exported as a guard rail.
 */
export type _DoNotWriteResponseDirectly = ServerResponse;
