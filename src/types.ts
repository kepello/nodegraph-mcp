/*
 * Public types for nodegraph-mcp. Two parallel shapes:
 *
 * - Graph-layer tools (this module's main export) — handlers receive
 *   `{ input, graph }`. Tools operate on a single GraphLayer.
 *
 * - Federation tools (./federation subpath) — handlers receive
 *   `{ input, mounted, fed }`. Tools dispatch to a specific mounted
 *   graph (resolved from input.graphId or the federation's active
 *   graph) before running, and may also operate on the federation
 *   directly (mount/list/create-graph/etc.).
 */

import type { ZodRawShape, ZodTypeAny, z } from "zod";
import type { GraphLayer } from "@kepello/nodegraph";

/**
 * Result a handler returns. Three shapes are accepted:
 *
 * - A plain value (object, primitive) — wrapped as an MCP text content
 *   block with JSON-stringified body.
 * - A pre-built MCP `CallToolResult` — passed through unchanged.
 * - A string — wrapped as an MCP text content block with the raw text.
 */
export type GraphToolHandlerResult =
  | unknown
  | McpCallToolResult;

export interface McpTextContent {
  type: "text";
  text: string;
}

export interface McpCallToolResult {
  content: McpTextContent[];
  isError?: boolean;
}

// ---------- Graph-layer tool shapes ----------

export interface GraphToolContext<TGraph extends GraphLayer, TInput> {
  input: TInput;
  graph: TGraph;
}

export interface GraphToolDefinition<
  TGraph extends GraphLayer,
  TShape extends ZodRawShape,
> {
  name: string;
  description?: string;
  inputSchema?: TShape;
  handler: (
    ctx: GraphToolContext<TGraph, ShapeInput<TShape>>,
  ) => GraphToolHandlerResult | Promise<GraphToolHandlerResult>;
}

/**
 * Convert a Zod raw shape (`{ key: ZodTypeAny }`) into the parsed-output
 * type (`{ key: <output> }`). Mirrors how the SDK wraps shapes in
 * z.object() internally.
 */
export type ShapeInput<TShape extends ZodRawShape> = {
  [K in keyof TShape]: TShape[K] extends ZodTypeAny
    ? z.infer<TShape[K]>
    : never;
};
