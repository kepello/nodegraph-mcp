# @kepello/nodegraph-mcp

MCP exposure for [`@kepello/nodegraph`](https://github.com/kepello/nodegraph) and [`@kepello/nodegraph-federation`](https://github.com/kepello/nodegraph-federation). Two API surfaces: a graph-layer server for single-graph apps, and a federation server for multi-graph apps.

## What it is

This package wraps the [Model Context Protocol SDK](https://github.com/modelcontextprotocol/typescript-sdk) so consumers can register typed tools that close over their graph or federation context. Generic graph and federation operations ship as built-in tools; consumers add overlay-specific tools through the same `registerTool()` API.

```text
@kepello/nodegraph              ← engine + storage contract
@kepello/nodegraph-sqlite       ← SQLite backend
@kepello/nodegraph-federation   ← multi-graph composition
@kepello/nodegraph-mcp          ← this package: MCP exposure
```

## Two layers

| Layer | Operates on | Use case |
| --- | --- | --- |
| **Graph-layer MCP** (main export) | A single `GraphLayer` | Single-graph apps; tooling that admins one graph file; tests |
| **Federation MCP** (`./federation` subpath) | A `GraphFederation<TOverlays, TMetadata>` | Multi-graph apps; anything with overlays; auto-dispatch from `graphId` or active-graph |

Both layers use the same registration mechanics — a `registerTool({ name, description, inputSchema, handler })` call where `inputSchema` is a Zod raw shape and `handler` receives the parsed input plus context.

## Install

```sh
npm install \
  @kepello/nodegraph \
  @kepello/nodegraph-mcp \
  @modelcontextprotocol/sdk \
  zod
```

GitHub Packages auth required:

```ini
//npm.pkg.github.com/:_authToken=<your-github-PAT-with-read:packages>
@kepello:registry=https://npm.pkg.github.com/
```

`@kepello/nodegraph-federation` is an optional peer dep — only needed if you import from `./federation`.

## Quickstart — single graph

```ts
import { z } from "zod";
import { GraphLayerImpl } from "@kepello/nodegraph";
import { InMemoryBackend } from "@kepello/nodegraph/in-memory";
import {
  GraphMcpServer,
  registerBuiltinGraphTools,
} from "@kepello/nodegraph-mcp";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const graph = new GraphLayerImpl(new InMemoryBackend());
const server = new GraphMcpServer({ graph });

// Built-in graph-layer tools (insert/get/query/supersede/tombstone for nodes + edges).
registerBuiltinGraphTools(server);

// Add your own tool.
server.registerTool({
  name: "find_recent",
  description: "Return live nodes in a domain",
  inputSchema: { domain: z.string() },
  handler: ({ input, graph }) =>
    graph.queryNodes({ domain: input.domain, lifecycleState: "live" }),
});

await server.connect(new StdioServerTransport());
```

## Quickstart — federation (multi-graph)

```ts
import { z } from "zod";
import { GraphFederation, CatalogImpl } from "@kepello/nodegraph-federation";
import { SqliteBackend } from "@kepello/nodegraph-sqlite";
import { InMemoryBackend } from "@kepello/nodegraph/in-memory";
import {
  GraphFederationMcpServer,
  registerBuiltinFederationTools,
} from "@kepello/nodegraph-mcp/federation";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

interface MyOverlays {
  // ... your overlay types
}
interface MyMetadata {
  tier: "user" | "project";
}

const fed = new GraphFederation<MyOverlays, MyMetadata>({
  catalogs: [new CatalogImpl<MyMetadata>(new InMemoryBackend())],
  backendFactory: (loc) => new SqliteBackend({ path: loc }),
  overlaysFactory: (graph) => buildOverlays(graph),
});

const server = new GraphFederationMcpServer({ federation: fed });

// Built-in federation tools (mount/unmount/list/set-active).
registerBuiltinFederationTools(server, { prefix: "kg_" });

// Overlay-specific tools — TS infers `mounted.overlays` as MyOverlays.
server.registerTool({
  name: "session_create_node",
  description: "Create a session-domain node",
  inputSchema: {
    title: z.string(),
    body: z.string().optional(),
  },
  handler: ({ input, mounted }) => {
    return mounted.overlays.session.insertNode(input);
  },
});

// Federation-level tool that doesn't need a mounted graph.
server.registerTool({
  name: "list_my_graphs",
  description: "List graphs in the user tier",
  inputSchema: {},
  requiresMount: false,
  handler: ({ fed }) => fed.list({ metadata: { tier: "user" } }),
});

await server.connect(new StdioServerTransport());
```

## Handler context

| Server | Handler signature | Notes |
| --- | --- | --- |
| `GraphMcpServer<TGraph>` | `({ input, graph })` | `graph` is the single GraphLayer the server was constructed with. |
| `GraphFederationMcpServer<TOverlays, TMetadata>`, `requiresMount: true` (default) | `({ input, mounted, fed })` | `mounted` resolves from `input.graphId`/`input.graph_id` (if present) or `fed.getActive()`. If neither is set, the tool returns an MCP error before the handler runs. |
| `GraphFederationMcpServer<TOverlays, TMetadata>`, `requiresMount: false` | `({ input, mounted, fed })` with `mounted: null` | For mount-lifecycle and federation-listing tools. |

Handler return values are wrapped automatically: plain objects → JSON-stringified text content; strings → text content; pre-built `CallToolResult` shapes → passed through unchanged. Thrown errors are mapped to `{ isError: true, content: [{ type: "text", text: "{...}" }] }`.

## Built-in tools

### Graph-layer (`registerBuiltinGraphTools`)

`insert_node`, `get_node`, `query_nodes`, `supersede_node`, `tombstone_node`, `insert_edge`, `get_edge`, `query_edges`, `tombstone_edge`.

### Federation (`registerBuiltinFederationTools`)

`mount_graph`, `unmount_graph`, `list_graphs`, `list_mounted`, `set_active_graph`, `get_active_graph`.

Both registrars accept `{ prefix?, only? }` options:

- `prefix: "kg_"` → tools become `kg_insert_node`, `kg_mount_graph`, etc.
- `only: ["insert_node", "get_node"]` → register a subset

## Subpath exports

| Import | Purpose |
| --- | --- |
| `@kepello/nodegraph-mcp` | `GraphMcpServer`, `registerBuiltinGraphTools`, types |
| `@kepello/nodegraph-mcp/federation` | `GraphFederationMcpServer`, `registerBuiltinFederationTools`, types |

## Architecture

```text
┌────────────────────────────────────────────────────────────┐
│  Your app: overlay-specific tools registered via           │
│  server.registerTool()                                     │
├────────────────────────────────────────────────────────────┤
│  GraphMcpServer / GraphFederationMcpServer                 │ ← this package
│  (built-in tools + Zod registration + dispatch)            │
├────────────────────────────────────────────────────────────┤
│  @modelcontextprotocol/sdk McpServer                       │ (transport, protocol)
└────────────────────────────────────────────────────────────┘
```

The package is **transport-agnostic.** It exposes registered tools through the underlying `McpServer`; consumers wire it to whatever transport they want (`StdioServerTransport`, `StreamableHTTPServerTransport`, custom). Connection policy (auth, idle timer, single-flight spawn, filesystem routing) is the consumer's concern.

## License

MIT — see [LICENSE](LICENSE).
