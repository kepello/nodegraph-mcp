/*
 * Built-in graph-layer tools. Read-only by design — substrate mutation
 * is the exclusive responsibility of authorized overlay writers per
 * the workspace's overlay-discipline model (Fathom row 5.0.39/40/41
 * audit; substrate-discipline.test.ts in fathom-cli enforces it).
 *
 * Pre-5.0.62: this file also exposed a `MUTATION_TOOLS` set
 * (`insert_node`, `supersede_node`, `tombstone_node`, `insert_edge`,
 * `tombstone_edge`) gated behind `allowDangerousMutations: true`.
 * Eliminated 2026-05-21 (row 5.0.62): the four cases that motivated
 * cross-domain raw mutation (audit/forensics, migration, power-user,
 * agent-driven) are either served by overlay-API expansion + storage-
 * layer internal utilities, or are the antipattern the rule exists to
 * prevent. No production caller of the gated option existed.
 *
 * Naming: tools are exposed without a prefix by default. Pass a
 * `prefix` option to namespace them (e.g., prefix: "kg_" yields
 * "kg_get_node", matching bds-v3's existing naming).
 */

import { z } from "zod";
import type { GraphLayer } from "@kepello/nodegraph-core";
import type { GraphMcpServer } from "./server.js";

export interface RegisterBuiltinGraphToolsOptions {
  /**
   * Prefix prepended to every built-in tool name. Empty by default.
   * Examples: "kg_" → "kg_get_node"; "graph." → "graph.get_node".
   */
  prefix?: string;
  /**
   * Subset of tool names to register. If omitted, all four read-only
   * tools (`get_node` / `query_nodes` / `get_edge` / `query_edges`)
   * register by default.
   */
  only?: BuiltinGraphToolName[];
}

const READ_ONLY_TOOLS: readonly BuiltinGraphToolName[] = [
  "get_node",
  "query_nodes",
  "get_edge",
  "query_edges",
];

export type BuiltinGraphToolName =
  | "get_node"
  | "query_nodes"
  | "get_edge"
  | "query_edges";

/**
 * Register the read-only graph-layer tools on a GraphMcpServer. Each
 * tool is a thin wrapper over a `GraphReader` method (`GraphLayer`
 * extends `GraphReader`). Substrate mutation is not exposed — consumers
 * needing to write substrate state register overlay-specific tools
 * through the overlay's own MCP surface.
 */
export function registerBuiltinGraphTools<TGraph extends GraphLayer>(
  server: GraphMcpServer<TGraph>,
  options: RegisterBuiltinGraphToolsOptions = {},
): void {
  const prefix = options.prefix ?? "";
  const want = new Set<BuiltinGraphToolName>(options.only ?? READ_ONLY_TOOLS);

  if (want.has("get_node")) {
    server.registerTool({
      name: `${prefix}get_node`,
      description: "Look up a node by id. Returns null if not found.",
      inputSchema: {
        id: z.string(),
      },
      handler: ({ input, graph }) => graph.getNodeById(input.id) ?? null,
    });
  }

  if (want.has("query_nodes")) {
    server.registerTool({
      name: `${prefix}query_nodes`,
      description:
        "Query nodes by domain and/or lifecycleState. Defaults to lifecycleState=live when not specified.",
      inputSchema: {
        domain: z.string().optional(),
        lifecycleState: z
          .enum(["live", "superseded", "tombstoned"])
          .optional(),
      },
      handler: ({ input, graph }) => {
        const q: Record<string, string | number | boolean | null> = {};
        if (input.domain !== undefined) q.domain = input.domain;
        q.lifecycleState = input.lifecycleState ?? "live";
        return graph.queryNodes(q);
      },
    });
  }

  if (want.has("get_edge")) {
    server.registerTool({
      name: `${prefix}get_edge`,
      description: "Look up an edge by id. Returns null if not found.",
      inputSchema: {
        id: z.string(),
      },
      handler: ({ input, graph }) => graph.getEdgeById(input.id) ?? null,
    });
  }

  if (want.has("query_edges")) {
    server.registerTool({
      name: `${prefix}query_edges`,
      description: "Query edges by source/target/type filters.",
      inputSchema: {
        type: z.string().optional(),
        sourceId: z.string().optional(),
        targetId: z.string().optional(),
        lifecycleState: z
          .enum(["live", "superseded", "tombstoned"])
          .optional(),
      },
      handler: ({ input, graph }) => {
        const q: Record<string, string | number | boolean | null> = {};
        if (input.type !== undefined) q.type = input.type;
        if (input.sourceId !== undefined) q.sourceId = input.sourceId;
        if (input.targetId !== undefined) q.targetId = input.targetId;
        q.lifecycleState = input.lifecycleState ?? "live";
        return graph.queryEdges(q);
      },
    });
  }
}
