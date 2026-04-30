/*
 * Result + error mapping helpers. Handlers return arbitrary values;
 * the server wraps them into MCP CallToolResult shape.
 */

import type {
  GraphToolHandlerResult,
  McpCallToolResult,
  McpTextContent,
} from "./types.js";

/**
 * Wraps a handler's return value into an MCP CallToolResult. If the
 * handler already returned a CallToolResult shape (object with
 * `content` array), pass through unchanged; otherwise serialize as
 * pretty-printed JSON in a text content block.
 */
export function wrapResult(
  value: GraphToolHandlerResult,
): McpCallToolResult {
  if (isCallToolResult(value)) return value;
  if (typeof value === "string") {
    return { content: [{ type: "text", text: value }] };
  }
  return {
    content: [
      { type: "text", text: JSON.stringify(value, null, 2) },
    ],
  };
}

/**
 * Wraps a thrown error into an MCP CallToolResult with isError: true.
 * Preserves common error properties (name, message). The MCP SDK
 * surfaces these to the client.
 */
export function wrapError(err: unknown): McpCallToolResult {
  const payload =
    err instanceof Error
      ? { error: err.message, name: err.name }
      : { error: String(err) };
  return {
    content: [
      { type: "text", text: JSON.stringify(payload, null, 2) },
    ],
    isError: true,
  };
}

function isCallToolResult(v: unknown): v is McpCallToolResult {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.content)) return false;
  return o.content.every((c) => isTextContent(c));
}

function isTextContent(v: unknown): v is McpTextContent {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return o.type === "text" && typeof o.text === "string";
}
