/*
 * Built-in graph-layer tools. These operate on a GraphLayer directly
 * with no overlay vocabulary. The set is intentionally small — the
 * value of nodegraph-mcp is the registration API; consumers add their
 * own overlay-specific tools through registerTool().
 *
 * Naming: tools are exposed without a prefix by default. Pass a
 * `prefix` option to namespace them (e.g., prefix: "kg_" yields
 * "kg_insert_node", matching bds-v3's existing naming).
 */

import { z } from "zod";
import type { GraphLayer } from "@kepello/nodegraph-core";
import type { GraphMcpServer } from "./server.js";

export interface RegisterBuiltinGraphToolsOptions {
  /**
   * Prefix prepended to every built-in tool name. Empty by default.
   * Examples: "kg_" → "kg_insert_node"; "graph." → "graph.insert_node".
   */
  prefix?: string;
  /**
   * Subset of tool names to register. If omitted, all built-ins are
   * registered. Use to opt out of specific tools (e.g., skip
   * `delete_node` for read-only servers).
   */
  only?: BuiltinGraphToolName[];
}

export type BuiltinGraphToolName =
  | "insert_node"
  | "get_node"
  | "query_nodes"
  | "supersede_node"
  | "tombstone_node"
  | "insert_edge"
  | "get_edge"
  | "query_edges"
  | "tombstone_edge";

/**
 * Register the standard set of graph-layer tools on a GraphMcpServer.
 * Each tool is a thin wrapper over a GraphLayer method.
 */
export function registerBuiltinGraphTools<TGraph extends GraphLayer>(
  server: GraphMcpServer<TGraph>,
  options: RegisterBuiltinGraphToolsOptions = {},
): void {
  const prefix = options.prefix ?? "";
  const want = new Set<BuiltinGraphToolName>(
    options.only ?? [
      "insert_node",
      "get_node",
      "query_nodes",
      "supersede_node",
      "tombstone_node",
      "insert_edge",
      "get_edge",
      "query_edges",
      "tombstone_edge",
    ],
  );

  if (want.has("insert_node")) {
    server.registerTool({
      name: `${prefix}insert_node`,
      description:
        "Insert a node into the graph. Returns the created Node with its assigned id and lifecycleState=live.",
      inputSchema: {
        domain: z.string().describe("Domain tag classifying the node."),
        naturalKey: z
          .string()
          .optional()
          .describe(
            "Optional caller-stable identifier; unique per (domain, lifecycleState=live).",
          ),
        metadata: z
          .unknown()
          .optional()
          .describe("Opaque domain-typed metadata blob."),
      },
      handler: ({ input, graph }) =>
        graph.insertNode({
          domain: input.domain,
          naturalKey: input.naturalKey,
          metadata: input.metadata,
        }),
    });
  }

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

  if (want.has("supersede_node")) {
    server.registerTool({
      name: `${prefix}supersede_node`,
      description:
        "Replace an existing node with a new live version. The prior node becomes superseded; the new node carries supersedesNodeId pointing at it.",
      inputSchema: {
        priorNodeId: z.string(),
        metadata: z.unknown().optional(),
      },
      handler: ({ input, graph }) =>
        graph.supersedeNode(input.priorNodeId, {
          metadata: input.metadata,
        }),
    });
  }

  if (want.has("tombstone_node")) {
    server.registerTool({
      name: `${prefix}tombstone_node`,
      description:
        "Tombstone a node (lifecycleState → tombstoned). The row remains for audit but is excluded from default queries.",
      inputSchema: {
        id: z.string(),
      },
      handler: ({ input, graph }) => {
        graph.tombstoneNode(input.id);
        return { tombstoned: input.id };
      },
    });
  }

  if (want.has("insert_edge")) {
    server.registerTool({
      name: `${prefix}insert_edge`,
      description:
        "Insert an edge between two nodes. Target may be specified by id (targetId) or natural-key form (targetRef).",
      inputSchema: {
        type: z.string().describe("Edge type vocabulary owned by the consumer."),
        sourceId: z.string(),
        targetId: z.string().optional(),
        targetRef: z.string().optional(),
        metadata: z.unknown().optional(),
      },
      handler: ({ input, graph }) =>
        graph.insertEdge({
          type: input.type,
          sourceId: input.sourceId,
          targetId: input.targetId,
          targetRef: input.targetRef,
          metadata: input.metadata,
        }),
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

  if (want.has("tombstone_edge")) {
    server.registerTool({
      name: `${prefix}tombstone_edge`,
      description: "Tombstone an edge.",
      inputSchema: {
        id: z.string(),
      },
      handler: ({ input, graph }) => {
        graph.tombstoneEdge(input.id);
        return { tombstoned: input.id };
      },
    });
  }
}
