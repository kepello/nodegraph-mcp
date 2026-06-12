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
 * Wraps a handler's return value with additional `_meta` fields injected
 * into the serialized payload. Used to surface observable recovery signals
 * (e.g. `storeReopened: true`) per the no-silent-degradation rule
 * (Fathom row 5.0.101 `mcp-cluster-overlay-staleness`).
 *
 * When the value is already a `CallToolResult` (pre-built content array),
 * the content is left unchanged — the MCP envelope is treated as opaque.
 * For plain objects, `_meta` is merged in at the top level.
 */
export function wrapResultWithMeta(
  value: GraphToolHandlerResult,
  meta: Record<string, unknown>,
): McpCallToolResult {
  if (isCallToolResult(value)) {
    // Pre-built CallToolResult — inject `_meta` at the top level of the
    // envelope (MCP spec supports a top-level `_meta` field on CallToolResult).
    // The `content` array is left untouched; the signal is surfaced via the
    // envelope `_meta` per the no-silent-degradation rule (Fathom 5.0.101 F4).
    // Previously this returned the value unchanged — that was a NSD gap.
    const existingMeta = typeof value._meta === "object" && value._meta !== null
      ? value._meta
      : {};
    return { ...value, _meta: { ...existingMeta, ...meta } };
  }
  if (typeof value === "string") {
    // Plain string — wrap as JSON object with _meta attached.
    return {
      content: [
        { type: "text", text: JSON.stringify({ result: value, _meta: meta }, null, 2) },
      ],
    };
  }
  // Plain object — merge _meta at the top level.
  let enriched: Record<string, unknown>;
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const existingMeta = typeof obj["_meta"] === "object" && obj["_meta"] !== null
      ? (obj["_meta"] as Record<string, unknown>)
      : {};
    enriched = { ...obj, _meta: { ...existingMeta, ...meta } };
  } else {
    enriched = { result: value, _meta: meta };
  }
  return {
    content: [
      { type: "text", text: JSON.stringify(enriched, null, 2) },
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
