export { GraphMcpServer } from "./server.js";
export type { GraphMcpServerOptions } from "./server.js";

export {
  registerBuiltinGraphTools,
  type BuiltinGraphToolName,
  type RegisterBuiltinGraphToolsOptions,
} from "./builtin-tools.js";

export type {
  GraphToolContext,
  GraphToolDefinition,
  GraphToolHandlerResult,
  McpCallToolResult,
  McpTextContent,
  ShapeInput,
} from "./types.js";

export { wrapResult, wrapError } from "./result.js";
