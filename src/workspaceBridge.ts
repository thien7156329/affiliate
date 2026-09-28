import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { WorkspaceFiles, WorkspaceRegistry } from "./workspaceBridgeCore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const host = process.env.WORKSPACE_BRIDGE_HOST || "127.0.0.1";
const port = Number(process.env.WORKSPACE_BRIDGE_PORT || 3410);
const registryFile = path.resolve(process.env.WORKSPACE_BRIDGE_REGISTRY || path.join(projectRoot, ".workspace-bridge/projects.json"));
const publicMode = (process.env.WORKSPACE_BRIDGE_PUBLIC || "false").toLowerCase() === "true";
const accessToken = process.env.WORKSPACE_BRIDGE_TOKEN || (publicMode ? "" : randomBytes(24).toString("hex"));
const registry = new WorkspaceRegistry(registryFile);
const workspace = new WorkspaceFiles(registry);
const app = express();

app.use(express.json({ limit: "3mb" }));

function isLoopbackRequest(req: express.Request): boolean {
  const address = req.socket.remoteAddress || "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

app.use((req, res, next) => {
  if (publicMode && req.path !== "/mcp" && req.path !== "/health") {
    return res.status(404).json({ error: "Only the MCP endpoint is available in public mode" });
  }
  if (publicMode && req.path === "/health") return next();
  if (publicMode) {
    const supplied = req.header("authorization")?.replace(/^Bearer\s+/i, "") || req.header("x-workspace-token");
    if (!accessToken || supplied !== accessToken) return res.status(401).json({ error: "Missing or invalid workspace bridge token" });
    return next();
  }
  if (isLoopbackRequest(req)) return next();
  const supplied = req.header("authorization")?.replace(/^Bearer\s+/i, "") || req.header("x-workspace-token");
  if (supplied !== accessToken) return res.status(401).json({ error: "Missing or invalid workspace bridge token" });
  next();
});

function asyncRoute(handler: (req: express.Request, res: express.Response) => Promise<unknown>) {
  return (req: express.Request, res: express.Response) => void handler(req, res).catch((error: any) => {
    const status = error?.code === "ETAG_MISMATCH" ? 409 : 400;
    res.status(status).json({ error: error?.message || "Request failed" });
  });
}

function routeParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

app.get("/health", (_req, res) => res.json({ ok: true, service: "workspace-bridge", projects: "/api/projects", mcp: "/mcp" }));
app.get("/api/projects", asyncRoute(async (_req, res) => res.json({ projects: await registry.list() })));
app.post("/api/projects", asyncRoute(async (req, res) => {
  const project = await registry.add(String(req.body?.name || ""), String(req.body?.root || ""));
  res.status(201).json({ project });
}));
app.delete("/api/projects/:id", asyncRoute(async (req, res) => res.json({ removed: await registry.remove(routeParam(req.params.id)) })));
app.get("/api/projects/:id/tree", asyncRoute(async (req, res) => res.json({ entries: await workspace.tree(routeParam(req.params.id)) })));
app.get("/api/projects/:id/file", asyncRoute(async (req, res) => res.json(await workspace.read(routeParam(req.params.id), String(req.query.path || "")))));
app.put("/api/projects/:id/file", asyncRoute(async (req, res) => {
  const result = await workspace.write(routeParam(req.params.id), String(req.body?.path || ""), String(req.body?.content ?? ""), req.body?.etag);
  res.json(result);
}));
app.get("/api/projects/:id/search", asyncRoute(async (req, res) => {
  res.json({ results: await workspace.search(routeParam(req.params.id), String(req.query.q || ""), Math.min(Number(req.query.limit || 100), 500)) });
}));

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function createMcpServer(): McpServer {
  const server = new McpServer({ name: "multi-project-workspace-bridge", version: "1.0.0" });
  server.registerTool("list_projects", { description: "List local projects explicitly registered with the workspace bridge." }, async () => textResult(await registry.list()));
  server.registerTool("list_files", {
    description: "List files for one registered project. Build artifacts, dependencies, Git data, and symlinks are excluded.",
    inputSchema: { project_id: z.string().min(1) },
  }, async ({ project_id }) => textResult(await workspace.tree(project_id)));
  server.registerTool("read_file", {
    description: "Read a UTF-8 source file within a registered project.",
    inputSchema: { project_id: z.string().min(1), path: z.string().min(1) },
  }, async ({ project_id, path: filePath }) => textResult(await workspace.read(project_id, filePath)));
  server.registerTool("write_file", {
    description: "Create or replace a UTF-8 source file. Supply expected_etag from read_file to prevent overwriting concurrent edits.",
    inputSchema: {
      project_id: z.string().min(1),
      path: z.string().min(1),
      content: z.string(),
      expected_etag: z.string().optional(),
    },
  }, async ({ project_id, path: filePath, content, expected_etag }) => textResult(await workspace.write(project_id, filePath, content, expected_etag)));
  server.registerTool("search_code", {
    description: "Search text across source files in a registered project.",
    inputSchema: { project_id: z.string().min(1), query: z.string().min(1), limit: z.number().int().min(1).max(500).default(100) },
  }, async ({ project_id, query, limit }) => textResult(await workspace.search(project_id, query, limit)));
  return server;
}

const transports = new Map<string, StreamableHTTPServerTransport>();
app.post("/mcp", asyncRoute(async (req, res) => {
  const sessionId = req.header("mcp-session-id");
  let transport = sessionId ? transports.get(sessionId) : undefined;
  if (!transport) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => { transports.set(id, transport!); },
    });
    transport.onclose = () => transport?.sessionId && transports.delete(transport.sessionId);
    await createMcpServer().connect(transport);
  }
  await transport.handleRequest(req, res, req.body);
}));
app.get("/mcp", asyncRoute(async (req, res) => {
  const transport = transports.get(req.header("mcp-session-id") || "");
  if (!transport) return res.status(400).json({ error: "Unknown MCP session" });
  await transport.handleRequest(req, res);
}));
app.delete("/mcp", asyncRoute(async (req, res) => {
  const transport = transports.get(req.header("mcp-session-id") || "");
  if (!transport) return res.status(400).json({ error: "Unknown MCP session" });
  await transport.handleRequest(req, res);
}));

app.get("/", (_req, res) => res.sendFile(path.join(projectRoot, "public/workspace-bridge.html")));

async function main(): Promise<void> {
  if (publicMode && !accessToken) throw new Error("WORKSPACE_BRIDGE_TOKEN is required when WORKSPACE_BRIDGE_PUBLIC=true");
  if ((process.env.WORKSPACE_BRIDGE_ADD_CWD || "true").toLowerCase() !== "false" && (await registry.list()).length === 0) {
    await registry.add(path.basename(projectRoot), projectRoot);
  }
  const httpServer = app.listen(port, host, () => {
    console.log(`Workspace bridge: http://${host}:${port}`);
    console.log(`MCP endpoint:    http://${host}:${port}/mcp`);
    if (publicMode) console.log("Public mode:     /mcp requires a Bearer token; REST workspace APIs are disabled");
    else if (host !== "127.0.0.1" && host !== "localhost") console.log(`Bearer token:    ${accessToken}`);
  });
  httpServer.on("error", (error) => {
    console.error(`Workspace bridge failed to listen on ${host}:${port}:`, error);
    process.exitCode = 1;
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
