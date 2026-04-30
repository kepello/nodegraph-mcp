/*
 * Federation MCP types. Handlers receive { input, mounted, fed } where
 * `mounted` is a MountedGraph<TOverlays> resolved from the input's
 * `graphId` field (if present) or the federation's active graph (if
 * not). Tools that operate on the federation itself (mount/list/etc.)
 * use `requiresMount: false` and ignore the `mounted` slot.
 */

import type { ZodRawShape, ZodTypeAny, z } from "zod";
import type {
  GraphFederation,
  MountedGraph,
} from "@kepello/nodegraph-federation";
import type {
  GraphToolHandlerResult,
  ShapeInput,
} from "../types.js";

/**
 * Context passed to federation tool handlers. `mounted` is present
 * when the tool requires per-graph dispatch; null when the tool
 * operates on the federation directly (mount, list, create-graph, etc).
 */
export interface FederationToolContext<
  TOverlays,
  TMetadata,
  TInput,
  TRequiresMount extends boolean,
> {
  input: TInput;
  fed: GraphFederation<TOverlays, TMetadata>;
  mounted: TRequiresMount extends true
    ? MountedGraph<TOverlays>
    : MountedGraph<TOverlays> | null;
}

export interface FederationToolDefinition<
  TOverlays,
  TMetadata,
  TShape extends ZodRawShape,
  TRequiresMount extends boolean = true,
> {
  name: string;
  description?: string;
  inputSchema?: TShape;
  /**
   * Whether this tool needs a mounted graph in scope. When true (the
   * default), the server resolves `MountedGraph<TOverlays>` from
   * `input.graphId` (optional) or the federation's active graph,
   * before calling the handler. When false, `mounted` is null and the
   * handler operates on `fed` directly (for mount-lifecycle and
   * federation-listing tools).
   */
  requiresMount?: TRequiresMount;
  handler: (
    ctx: FederationToolContext<
      TOverlays,
      TMetadata,
      ShapeInput<TShape>,
      TRequiresMount
    >,
  ) => GraphToolHandlerResult | Promise<GraphToolHandlerResult>;
}
