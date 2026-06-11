/*
 * GraphMcpServer — graph-layer MCP exposure for a single GraphLayer.
 *
 * Wraps the MCP SDK's high-level McpServer so consumers register tools
 * with `{ input, graph }` handler signatures and the server takes care
 * of context injection, result wrapping, and error mapping.
 *
 * For multi-graph applications, see the ./federation subpath
 * (GraphFederationMcpServer) which composes over a GraphFederation
 * and dispatches to the right MountedGraph per call.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Implementation } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ZodRawShape } from "zod";
import type { GraphLayer } from "@kepello/nodegraph-core";

import { wrapError, wrapResult, wrapResultWithMeta } from "./result.js";
import type {
  GraphToolDefinition,
  ShapeInput,
} from "./types.js";

export interface GraphMcpServerOptions<TGraph extends GraphLayer> {
  graph: TGraph;
  /**
   * Server identity reported in the MCP `initialize` exchange.
   * Defaults to `{ name: "nodegraph-mcp", version: "0.1.0" }`.
   */
  serverInfo?: Implementation;
}

const DEFAULT_SERVER_INFO: Implementation = {
  name: "nodegraph-mcp",
  version: "0.1.0",
};

/**
 * Graph-layer MCP server. Holds a single GraphLayer; each registered
 * tool's handler receives that graph alongside its parsed input.
 *
 * The class is generic in the graph type so consumers using a typed
 * subclass (e.g., one that exposes additional methods through the
 * `GraphLayer` interface) get those methods on `ctx.graph`.
 */
export class GraphMcpServer<TGraph extends GraphLayer = GraphLayer> {
  private readonly graph: TGraph;
  protected readonly mcp: McpServer;
  private readonly toolNames: Set<string> = new Set();

  constructor(options: GraphMcpServerOptions<TGraph>) {
    this.graph = options.graph;
    this.mcp = new McpServer(options.serverInfo ?? DEFAULT_SERVER_INFO);
  }

  /**
   * Register a tool that operates on the server's graph. The handler
   * receives `{ input, graph }` where input is parsed and validated
   * against the supplied Zod shape.
   */
  registerTool<TShape extends ZodRawShape>(
    def: GraphToolDefinition<TGraph, TShape>,
  ): void {
    if (this.toolNames.has(def.name)) {
      throw new Error(
        `GraphMcpServer.registerTool: tool already registered: ${def.name}`,
      );
    }
    this.toolNames.add(def.name);

    const config: {
      description?: string;
      inputSchema?: TShape;
    } = {};
    if (def.description !== undefined) config.description = def.description;
    if (def.inputSchema !== undefined) config.inputSchema = def.inputSchema;

    // The SDK callback receives `(args, extra)`. We ignore extra; the
    // handler API exposes only what consumers need (input + graph).
    // Before each tool handler runs, call `ensureStoreCurrent()` to
    // detect and recover from out-of-process store replacement (inode
    // swap — Fathom row 5.0.101 `mcp-cluster-overlay-staleness`). One
    // `statSync` per call — cheap. When a reopen fired, surface the
    // observable `_meta.storeReopened: true` flag on the response per
    // the no-silent-degradation rule.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cb: any = async (input: ShapeInput<TShape>) => {
      try {
        const storeReopened = this.graph.ensureStoreCurrent();
        const result = await def.handler({ input, graph: this.graph });
        if (storeReopened) {
          return wrapResultWithMeta(result, { storeReopened: true });
        }
        return wrapResult(result);
      } catch (err) {
        return wrapError(err);
      }
    };
    this.mcp.registerTool(def.name, config, cb);
  }

  /**
   * Names of currently-registered tools. Mostly useful for diagnostics
   * and tests; the MCP `tools/list` discovery is owned by the
   * underlying SDK server.
   */
  registeredToolNames(): string[] {
    return Array.from(this.toolNames);
  }

  /**
   * Connect this server to an MCP transport (stdio, HTTP, etc.). Same
   * semantics as McpServer.connect — the server takes ownership of
   * the transport.
   */
  async connect(transport: Transport): Promise<void> {
    return this.mcp.connect(transport);
  }

  /**
   * Access the underlying MCP SDK server. Use only for advanced cases
   * the registerTool API doesn't cover (custom request handlers,
   * notifications, prompts, resources). Most consumers won't need this.
   */
  get sdkServer(): McpServer {
    return this.mcp;
  }
}
