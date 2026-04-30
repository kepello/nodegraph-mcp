/*
 * Built-in federation tools. Operate on the GraphFederation directly
 * (requiresMount: false) — mount lifecycle, listing, active-graph
 * tracking. Consumer applications add overlay-specific tools through
 * registerTool() with default requiresMount: true.
 */

import { z } from "zod";
import type { GraphFederationMcpServer } from "./server.js";

export interface RegisterBuiltinFederationToolsOptions {
  /**
   * Prefix prepended to every built-in tool name. Empty by default.
   * Examples: "kg_" → "kg_mount_graph"; "graphs." → "graphs.mount_graph".
   */
  prefix?: string;
  only?: BuiltinFederationToolName[];
}

export type BuiltinFederationToolName =
  | "mount_graph"
  | "unmount_graph"
  | "list_graphs"
  | "list_mounted"
  | "set_active_graph"
  | "get_active_graph";

export function registerBuiltinFederationTools<TOverlays, TMetadata>(
  server: GraphFederationMcpServer<TOverlays, TMetadata>,
  options: RegisterBuiltinFederationToolsOptions = {},
): void {
  const prefix = options.prefix ?? "";
  const want = new Set<BuiltinFederationToolName>(
    options.only ?? [
      "mount_graph",
      "unmount_graph",
      "list_graphs",
      "list_mounted",
      "set_active_graph",
      "get_active_graph",
    ],
  );

  if (want.has("mount_graph")) {
    server.registerTool({
      name: `${prefix}mount_graph`,
      description:
        "Mount a graph at the given location (file path or other backend-specific identifier). Lazy-backfills the catalog if metadata is supplied.",
      inputSchema: {
        location: z
          .string()
          .describe("Backend-specific location (e.g., file path)."),
        name: z.string().optional(),
      },
      requiresMount: false,
      handler: ({ input, fed }) => {
        const m = fed.mount(input.location, { name: input.name });
        return {
          mounted: true,
          graphId: m.graphId,
          name: m.name,
          location: m.location,
        };
      },
    });
  }

  if (want.has("unmount_graph")) {
    server.registerTool({
      name: `${prefix}unmount_graph`,
      description:
        "Unmount a graph by id or name. Returns whether anything was unmounted.",
      inputSchema: {
        graphIdOrName: z.string(),
      },
      requiresMount: false,
      handler: ({ input, fed }) => {
        const ok = fed.unmount(input.graphIdOrName);
        return { unmounted: ok };
      },
    });
  }

  if (want.has("list_graphs")) {
    server.registerTool({
      name: `${prefix}list_graphs`,
      description:
        "List graph records across all federation catalogs in tier order. Includes graphs that aren't currently mounted.",
      inputSchema: {},
      requiresMount: false,
      handler: ({ fed }) => fed.list(),
    });
  }

  if (want.has("list_mounted")) {
    server.registerTool({
      name: `${prefix}list_mounted`,
      description: "List currently-mounted graphs (in-process state only).",
      inputSchema: {},
      requiresMount: false,
      handler: ({ fed }) =>
        fed.mounted().map((m) => ({
          graphId: m.graphId,
          name: m.name,
          location: m.location,
        })),
    });
  }

  if (want.has("set_active_graph")) {
    server.registerTool({
      name: `${prefix}set_active_graph`,
      description:
        "Switch the federation's active graph. Tools that don't take an explicit `graphId` will dispatch to the active graph.",
      inputSchema: {
        graphIdOrName: z.string(),
      },
      requiresMount: false,
      handler: ({ input, fed }) => {
        const m = fed.setActive(input.graphIdOrName);
        return {
          active: true,
          graphId: m.graphId,
          name: m.name,
        };
      },
    });
  }

  if (want.has("get_active_graph")) {
    server.registerTool({
      name: `${prefix}get_active_graph`,
      description: "Return the currently-active graph's identity, or null.",
      inputSchema: {},
      requiresMount: false,
      handler: ({ fed }) => {
        const m = fed.getActive();
        if (!m) return null;
        return {
          graphId: m.graphId,
          name: m.name,
          location: m.location,
        };
      },
    });
  }
}
