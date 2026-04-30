export { GraphFederationMcpServer } from "./server.js";
export type { GraphFederationMcpServerOptions } from "./server.js";

export {
  registerBuiltinFederationTools,
  type BuiltinFederationToolName,
  type RegisterBuiltinFederationToolsOptions,
} from "./builtin-tools.js";

export type {
  FederationToolContext,
  FederationToolDefinition,
} from "./types.js";

// Re-export common types from the main module for convenience.
export type {
  GraphToolHandlerResult,
  McpCallToolResult,
  McpTextContent,
  ShapeInput,
} from "../types.js";
export { wrapResult, wrapError } from "../result.js";
