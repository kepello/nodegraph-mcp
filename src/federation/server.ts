/*
 * GraphFederationMcpServer — MCP server bound to a GraphFederation.
 *
 * Per-tool handler signature is `({ input, mounted, fed })`. The
 * server resolves `mounted` from `input.graphId` (if the input shape
 * has one) or the federation's active graph; tools that don't need a
 * mounted graph in scope (mount_graph, list_graphs, create_graph,
 * etc.) opt out via `requiresMount: false`.
 *
 * Composes the same registration mechanics as GraphMcpServer but with
 * federation-specific context. The two server classes are siblings,
 * not a hierarchy — their handler signatures are deliberately
 * different.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Implementation } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ZodRawShape } from "zod";
import type {
  GraphFederation,
  MountedGraph,
} from "@kepello/nodegraph-federation";

import { wrapError, wrapResult } from "../result.js";
import type { ShapeInput } from "../types.js";
import type { FederationToolDefinition } from "./types.js";

export interface GraphFederationMcpServerOptions<TOverlays, TMetadata> {
  federation: GraphFederation<TOverlays, TMetadata>;
  serverInfo?: Implementation;
}

const DEFAULT_SERVER_INFO: Implementation = {
  name: "nodegraph-mcp-federation",
  version: "0.1.0",
};

export class GraphFederationMcpServer<TOverlays, TMetadata = unknown> {
  private readonly fed: GraphFederation<TOverlays, TMetadata>;
  protected readonly mcp: McpServer;
  private readonly toolNames: Set<string> = new Set();

  constructor(options: GraphFederationMcpServerOptions<TOverlays, TMetadata>) {
    this.fed = options.federation;
    this.mcp = new McpServer(options.serverInfo ?? DEFAULT_SERVER_INFO);
  }

  /**
   * Register a federation tool. Default `requiresMount: true` resolves
   * a mounted graph from `input.graphId` (if present in the schema)
   * or the federation's active graph; the resolved graph appears as
   * `mounted` in the handler context.
   *
   * Set `requiresMount: false` for tools that operate on the
   * federation directly — mount-lifecycle, listing, etc. The handler
   * receives `mounted: null` and uses `fed` to perform federation-
   * level operations.
   */
  registerTool<
    TShape extends ZodRawShape,
    TRequiresMount extends boolean = true,
  >(def: FederationToolDefinition<TOverlays, TMetadata, TShape, TRequiresMount>): void {
    if (this.toolNames.has(def.name)) {
      throw new Error(
        `GraphFederationMcpServer.registerTool: tool already registered: ${def.name}`,
      );
    }
    this.toolNames.add(def.name);

    const requiresMount: boolean = def.requiresMount ?? true;

    const config: { description?: string; inputSchema?: TShape } = {};
    if (def.description !== undefined) config.description = def.description;
    if (def.inputSchema !== undefined) config.inputSchema = def.inputSchema;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cb: any = async (input: ShapeInput<TShape>) => {
      try {
        let mounted: MountedGraph<TOverlays> | null = null;
        if (requiresMount) {
          mounted = this.resolveMounted(input) ?? null;
          if (!mounted) {
            return wrapError(
              new Error(
                "No graph available for this tool. Provide `graphId` in input, or set an active graph (set_active / mount_graph) on the federation first.",
              ),
            );
          }
        }
        const result = await (
          def.handler as (ctx: unknown) => unknown | Promise<unknown>
        )({ input, mounted, fed: this.fed });
        return wrapResult(result);
      } catch (err) {
        return wrapError(err);
      }
    };
    this.mcp.registerTool(def.name, config, cb);
  }

  registeredToolNames(): string[] {
    return Array.from(this.toolNames);
  }

  async connect(transport: Transport): Promise<void> {
    return this.mcp.connect(transport);
  }

  get sdkServer(): McpServer {
    return this.mcp;
  }

  get federation(): GraphFederation<TOverlays, TMetadata> {
    return this.fed;
  }

  // ---------- Internals ----------

  private resolveMounted(
    input: unknown,
  ): MountedGraph<TOverlays> | undefined {
    const requested = readGraphId(input);
    if (requested) {
      return this.fed.get(requested);
    }
    return this.fed.getActive() ?? undefined;
  }
}

/**
 * Pull `graphId` (or `graph_id`) out of an input record without
 * narrowing the input's static type. Federation tools that take an
 * explicit graph reference declare `graphId: z.string().optional()`
 * in their inputSchema; the server reads the field generically.
 */
function readGraphId(input: unknown): string | undefined {
  if (input === null || typeof input !== "object") return undefined;
  const o = input as Record<string, unknown>;
  if (typeof o.graphId === "string") return o.graphId;
  if (typeof o.graph_id === "string") return o.graph_id;
  return undefined;
}
