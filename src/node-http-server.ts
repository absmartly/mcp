// Node-native Streamable HTTP MCP transport, in two modes:
//
// - Stateless (default): each POST creates a fresh McpServer + transport,
//   matching the MCP SDK's simpleStatelessStreamableHttp example. No
//   notifications can be delivered, so subscribe/listChanged are NOT
//   advertised.
// - Stateful (opt-in via `stateful`): Mcp-Session-Id sessions, a GET SSE
//   stream for server-initiated notifications, DELETE to end a session,
//   resources/subscribe + unsubscribe, and an emitter API for the host
//   (notifyResourceUpdated / notifyListChanged). Sessions live in process
//   memory, so multi-replica deployments need sticky routing.
//
// The host (e.g. office/backend) supplies an already-authenticated APIClient
// per request via buildContext — this module does zero authentication itself,
// but in stateful mode it binds each session to the `principal` the host
// reports and rejects requests from any other principal.
import { randomUUID } from "crypto";
import type { IncomingMessage, ServerResponse } from "http";
import { fileURLToPath } from "url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest, SubscribeRequestSchema, UnsubscribeRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { APIClient } from "@absmartly/cli/api-client";
import { createServerContextLoader } from "./server-context.js";
import { registerServer } from "./register-server.js";
import { MCP_VERSION } from "./version.js";

// Bundled markdown docs (templates.md, examples.md), shipped in the package's
// "files" as public/docs/. Resolves identically from src/ (tsx) and dist/.
const DEFAULT_DOCS_DIR = fileURLToPath(new URL("../public/docs/api", import.meta.url));

export interface NodeMcpRequestContext {
  apiClient: APIClient;
  endpoint: string;
  authType: string;
  /** Override the bundled docs directory (defaults to DEFAULT_DOCS_DIR). */
  docsDir?: string;
  /**
   * Stable identifier of the authenticated caller (e.g. user id). Required in
   * stateful mode: sessions are bound to it and other principals are rejected.
   */
  principal?: string;
}

export type ListChangedKind = "tools" | "resources" | "prompts";

export interface McpSession {
  readonly id: string;
  readonly principal: string;
  readonly createdAt: number;
  lastActivityAt: number;
  /** Open GET SSE streams; sessions with one are exempt from the idle TTL. */
  activeStreams: number;
  readonly subscriptions: Set<string>;
  readonly server: McpServer;
  readonly transport: StreamableHTTPServerTransport;
  apiClient: APIClient;
}

/**
 * Session storage. Sessions hold live server/transport objects, so this is an
 * in-process seam (for metrics, custom bounds, tests), not a shared database.
 */
export interface SessionStore {
  get(id: string): McpSession | undefined;
  set(session: McpSession): void;
  delete(id: string): void;
  values(): Iterable<McpSession>;
  readonly size: number;
}

export function createInMemorySessionStore(): SessionStore {
  const map = new Map<string, McpSession>();
  return {
    get: (id) => map.get(id),
    set: (s) => { map.set(s.id, s); },
    delete: (id) => { map.delete(id); },
    values: () => map.values(),
    get size() { return map.size; },
  };
}

export interface StatefulOptions {
  sessionStore?: SessionStore;
  /** Evict sessions with no requests and no open GET stream for this long. Default 30 min. */
  idleTtlMs?: number;
  /** Evict sessions older than this regardless of activity (bounds stale credentials). Default 8 h. */
  maxSessionAgeMs?: number;
  /** Reject new sessions (503) beyond this many. Default 1000. */
  maxSessions?: number;
  /** Reject new sessions (429) beyond this many per principal. Default 20. */
  maxSessionsPerPrincipal?: number;
  /** Cap on resources/subscribe URIs per session. Default 100. */
  maxSubscriptionsPerSession?: number;
  sessionIdGenerator?: () => string;
  now?: () => number;
}

export interface NodeMcpHandlerOptions {
  /** Enable stateful sessions and advertise subscribe/listChanged. Default: stateless. */
  stateful?: boolean | StatefulOptions;
}

export interface NotifyTarget {
  /** Only notify sessions of this principal. Omit to notify every session (only safe for non-user-specific data). */
  principal?: string;
}

export interface NodeMcpHandler {
  post: (req: IncomingMessage, res: ServerResponse, body: unknown) => Promise<void>;
  /** Opens the SSE notification stream (stateful mode); 405 when stateless. */
  get: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  /** Ends a session (stateful mode); 405 when stateless. */
  delete: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  /** Sends notifications/resources/updated to sessions subscribed to `uri`. Returns the number of sessions notified. */
  notifyResourceUpdated: (uri: string, target?: NotifyTarget) => Promise<number>;
  /** Sends notifications/{tools,resources,prompts}/list_changed. Returns the number of sessions notified. */
  notifyListChanged: (kind: ListChangedKind, target?: NotifyTarget) => Promise<number>;
  /** Evicts expired sessions now (also runs on a timer and before each new session). */
  sweepExpired: () => Promise<number>;
  /** Stops the sweep timer and closes every session. */
  close: () => Promise<void>;
}

function jsonRpcError(res: ServerResponse, status: number, code: number, message: string, headers: Record<string, string> = {}) {
  if (res.headersSent) return;
  res.writeHead(status, { "Content-Type": "application/json", ...headers }).end(JSON.stringify({
    jsonrpc: "2.0",
    error: { code, message },
    id: null,
  }));
}

/**
 * McpServer's register*() calls add `listChanged: true` for tools, resources
 * and prompts. A stateless transport can never deliver those notifications, so
 * remove the flags there (the SDK has no public API to unset them).
 */
function stripListChanged(server: McpServer): void {
  const caps = (server.server as unknown as { _capabilities: Record<string, Record<string, unknown> | undefined> })._capabilities;
  for (const key of ["tools", "resources", "prompts"]) {
    if (caps[key]) delete caps[key]!.listChanged;
  }
}

async function createServerFor(
  ctx: NodeMcpRequestContext,
  apiClient: APIClient,
  stateful: boolean,
): Promise<McpServer> {
  // Lazy: entity lists are fetched only if this message's handler needs
  // them, not on every POST (initialize, tools/list, etc. skip it).
  const serverCtx = createServerContextLoader(apiClient, { endpoint: ctx.endpoint, authType: ctx.authType });
  const capabilities = stateful
    ? { tools: { listChanged: true }, resources: { subscribe: true, listChanged: true }, prompts: { listChanged: true } }
    : { tools: {}, resources: {}, prompts: {} };
  const server = new McpServer({ name: "ABsmartly MCP Server", version: MCP_VERSION }, { capabilities });
  registerServer(server, serverCtx, { docsDir: ctx.docsDir ?? DEFAULT_DOCS_DIR });
  if (!stateful) stripListChanged(server);
  return server;
}

export function createStreamableHttpHandler(
  buildContext: (req: IncomingMessage) => Promise<NodeMcpRequestContext>,
  options: NodeMcpHandlerOptions = {},
): NodeMcpHandler {
  const statefulOpts: StatefulOptions | undefined =
    options.stateful === true ? {} : options.stateful || undefined;
  if (statefulOpts) return createStatefulHandler(buildContext, statefulOpts);
  return createStatelessHandler(buildContext);
}

function methodNotAllowed(res: ServerResponse) {
  jsonRpcError(res, 405, -32000, "Method not allowed.", { Allow: "POST" });
}

async function noNotifications(): Promise<number> { return 0; }

function createStatelessHandler(
  buildContext: (req: IncomingMessage) => Promise<NodeMcpRequestContext>,
): NodeMcpHandler {
  return {
    async post(req, res, body) {
      let transport: StreamableHTTPServerTransport | undefined;
      let server: McpServer | undefined;
      let cleanedUp = false;
      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        transport?.close();
        server?.close();
      };

      try {
        const requestCtx = await buildContext(req);
        server = await createServerFor(requestCtx, requestCtx.apiClient, false);

        transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        await server.connect(transport);
        // Register the close handler before awaiting handleRequest: if the
        // client disconnects (or handleRequest throws) mid-request, this
        // listener must already be attached so the per-request McpServer/
        // transport still get cleaned up instead of leaking.
        res.on('close', cleanup);

        await transport.handleRequest(req, res, body);
      } catch (error) {
        console.error('Error handling MCP request:', error);
        // Clean up immediately on error too — don't rely solely on the
        // 'close' event, since a synchronous failure before res closes
        // would otherwise leave this request's McpServer/transport open.
        cleanup();
        jsonRpcError(res, 500, -32603, 'Internal server error');
      }
    },
    get: async (_req, res) => methodNotAllowed(res),
    delete: async (_req, res) => methodNotAllowed(res),
    notifyResourceUpdated: noNotifications,
    notifyListChanged: noNotifications,
    sweepExpired: noNotifications,
    close: async () => {},
  };
}

function createStatefulHandler(
  buildContext: (req: IncomingMessage) => Promise<NodeMcpRequestContext>,
  opts: StatefulOptions,
): NodeMcpHandler {
  const store = opts.sessionStore ?? createInMemorySessionStore();
  const idleTtlMs = opts.idleTtlMs ?? 30 * 60_000;
  const maxSessionAgeMs = opts.maxSessionAgeMs ?? 8 * 3_600_000;
  const maxSessions = opts.maxSessions ?? 1000;
  const maxPerPrincipal = opts.maxSessionsPerPrincipal ?? 20;
  const maxSubscriptions = opts.maxSubscriptionsPerSession ?? 100;
  const generateId = opts.sessionIdGenerator ?? randomUUID;
  const now = opts.now ?? Date.now;
  // Initializes in flight that will occupy a slot once the session id is issued.
  let pendingInitializes = 0;
  const pendingByPrincipal = new Map<string, number>();

  const destroy = async (session: McpSession) => {
    store.delete(session.id);
    session.subscriptions.clear();
    try { await session.transport.close(); } catch { /* already closed */ }
    try { await session.server.close(); } catch { /* already closed */ }
  };

  const sweepExpired = async () => {
    const t = now();
    const expired = [...store.values()].filter(s =>
      t - s.createdAt > maxSessionAgeMs || (s.activeStreams === 0 && t - s.lastActivityAt > idleTtlMs));
    await Promise.all(expired.map(destroy));
    return expired.length;
  };

  const timer = setInterval(() => { void sweepExpired(); }, Math.max(1000, Math.min(idleTtlMs / 2, 60_000)));
  timer.unref();

  const countFor = (principal: string) =>
    [...store.values()].filter(s => s.principal === principal).length + (pendingByPrincipal.get(principal) ?? 0);

  /** Resolves the session for a request, enforcing principal binding. Sends the error response and returns undefined on failure. */
  const authorize = async (req: IncomingMessage, res: ServerResponse, ctx: NodeMcpRequestContext): Promise<McpSession | undefined> => {
    const id = req.headers["mcp-session-id"];
    if (typeof id !== "string") {
      jsonRpcError(res, 400, -32000, "Bad Request: Mcp-Session-Id header is required");
      return undefined;
    }
    const session = store.get(id);
    // Same response for unknown and foreign sessions so ids can't be probed.
    if (!session || session.principal !== ctx.principal) {
      jsonRpcError(res, 404, -32001, "Session not found");
      return undefined;
    }
    session.lastActivityAt = now();
    // Adopt the freshest credentials the host resolved for this request.
    session.apiClient = ctx.apiClient;
    return session;
  };

  const startSession = async (ctx: NodeMcpRequestContext, principal: string, res: ServerResponse) => {
    const apiClient = new Proxy({} as APIClient, {
      get: (_t, prop) => {
        const target = holder.apiClient as unknown as Record<string | symbol, unknown>;
        const value = target[prop];
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const holder = { apiClient: ctx.apiClient };
    const server = await createServerFor(ctx, apiClient, true);
    let session: McpSession | undefined;

    server.server.setRequestHandler(SubscribeRequestSchema, async (request) => {
      if (session && !session.subscriptions.has(request.params.uri) && session.subscriptions.size >= maxSubscriptions) {
        throw new Error(`Subscription limit reached (${maxSubscriptions})`);
      }
      session?.subscriptions.add(request.params.uri);
      return {};
    });
    server.server.setRequestHandler(UnsubscribeRequestSchema, async (request) => {
      session?.subscriptions.delete(request.params.uri);
      return {};
    });

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: generateId,
      onsessioninitialized: (id) => {
        const t = now();
        session = {
          id, principal, createdAt: t, lastActivityAt: t, activeStreams: 0,
          subscriptions: new Set(), server, transport,
          get apiClient() { return holder.apiClient; },
          set apiClient(v: APIClient) { holder.apiClient = v; },
        };
        store.set(session);
      },
      onsessionclosed: async () => { if (session) await destroy(session); },
    });
    await server.connect(transport);
    // If initialize never completes (bad request, client gone), don't leak.
    res.on("close", () => { if (!session) { void transport.close(); void server.close(); } });
    return transport;
  };

  return {
    async post(req, res, body) {
      try {
        const ctx = await buildContext(req);
        if (!ctx.principal) {
          jsonRpcError(res, 401, -32001, "Stateful sessions require an authenticated principal");
          return;
        }
        if (req.headers["mcp-session-id"] !== undefined) {
          const session = await authorize(req, res, ctx);
          if (session) await session.transport.handleRequest(req, res, body);
          return;
        }
        if (!isInitializeRequest(body)) {
          jsonRpcError(res, 400, -32000, "Bad Request: no session; send initialize first");
          return;
        }
        await sweepExpired();
        if (store.size + pendingInitializes >= maxSessions) {
          jsonRpcError(res, 503, -32000, "Too many active MCP sessions", { "Retry-After": "30" });
          return;
        }
        if (countFor(ctx.principal) >= maxPerPrincipal) {
          jsonRpcError(res, 429, -32000, "Too many active MCP sessions for this user");
          return;
        }
        pendingInitializes++;
        pendingByPrincipal.set(ctx.principal, (pendingByPrincipal.get(ctx.principal) ?? 0) + 1);
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          pendingInitializes--;
          const n = (pendingByPrincipal.get(ctx.principal!) ?? 1) - 1;
          if (n <= 0) pendingByPrincipal.delete(ctx.principal!); else pendingByPrincipal.set(ctx.principal!, n);
        };
        try {
          const transport = await startSession(ctx, ctx.principal, res);
          await transport.handleRequest(req, res, body);
        } finally {
          release();
        }
      } catch (error) {
        console.error("Error handling MCP request:", error);
        jsonRpcError(res, 500, -32603, "Internal server error");
      }
    },

    async get(req, res) {
      try {
        const ctx = await buildContext(req);
        const session = await authorize(req, res, ctx);
        if (!session) return;
        session.activeStreams++;
        res.on("close", () => {
          session.activeStreams--;
          session.lastActivityAt = now();
        });
        await session.transport.handleRequest(req, res);
      } catch (error) {
        console.error("Error handling MCP request:", error);
        jsonRpcError(res, 500, -32603, "Internal server error");
      }
    },

    async delete(req, res) {
      try {
        const ctx = await buildContext(req);
        const session = await authorize(req, res, ctx);
        if (!session) return;
        await session.transport.handleRequest(req, res);
        await destroy(session);
      } catch (error) {
        console.error("Error handling MCP request:", error);
        jsonRpcError(res, 500, -32603, "Internal server error");
      }
    },

    async notifyResourceUpdated(uri, target) {
      const targets = [...store.values()].filter(s =>
        s.subscriptions.has(uri) && (!target?.principal || s.principal === target.principal));
      await Promise.all(targets.map(s => s.server.server.sendResourceUpdated({ uri })));
      return targets.length;
    },

    async notifyListChanged(kind, target) {
      const targets = [...store.values()].filter(s => !target?.principal || s.principal === target.principal);
      await Promise.all(targets.map(s => {
        if (kind === "tools") return s.server.sendToolListChanged();
        if (kind === "resources") return s.server.sendResourceListChanged();
        return s.server.sendPromptListChanged();
      }));
      return targets.length;
    },

    sweepExpired,

    async close() {
      clearInterval(timer);
      await Promise.all([...store.values()].map(destroy));
    },
  };
}
