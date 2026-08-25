import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { runSummaries, type TraceCollectionItem } from "../core/collection";
import { resolvePath } from "../core/path";

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".json": "application/json",
};

/** One servable trace with its response body pre-stringified. */
export interface ServedTrace extends TraceCollectionItem {
  traceJson: string;
}

export interface Collection {
  items: ServedTrace[];
  /** /api/traces body: one RunSummary per item. */
  listJson: string;
}

/** What the server serves: a static snapshot or a live, mutable collection. */
export interface TraceSource {
  /** True when traces can change while the server runs (devtools mode). */
  live: boolean;
  current(): Collection;
  /** Live sources push one event per collection change. Returns an unsubscribe. */
  subscribe?(listener: () => void): () => void;
  /** Live sources ingest a notify ping; false rejects the payload. */
  notify?(dbPath: unknown): boolean;
  /** Live sources empty the backing database. */
  clear?(): void;
}

export function buildCollection(items: TraceCollectionItem[]): Collection {
  return {
    items: items.map((item) => ({ ...item, traceJson: JSON.stringify(item.trace) })),
    listJson: JSON.stringify(runSummaries(items)),
  };
}

/** Wraps immutable loaded traces in the TraceSource shape. */
export function staticSource(items: TraceCollectionItem[]): TraceSource {
  const snapshot = buildCollection(items);
  return { live: false, current: () => snapshot };
}

/** The trace an api request addresses: ?id=<traceId>, defaulting to the newest. */
function pickTrace(collection: Collection, url: URL): ServedTrace | undefined {
  const id = url.searchParams.get("id");
  if (id !== null) return collection.items.find((item) => item.trace.traceId === id);
  return collection.items.at(-1);
}

/** Directory of built viewer assets, shipped next to the bundled CLI. */
function viewerDir(): string {
  return fileURLToPath(new URL("../viewer", import.meta.url));
}

/**
 * Serves the built viewer plus the normalized trace at /api/trace,
 * retrying on the next port when the requested one is taken. Live sources
 * additionally get /api/notify (ingest) and update pushes on /api/events,
 * and bind both loopback stacks - the instrumented app notifies
 * "localhost", which resolves to ::1 on some machines.
 */
export async function startServer(
  source: TraceSource,
  preferredPort: number,
  options: { exactPort?: boolean } = {},
): Promise<{ servers: Server[]; port: number }> {
  const dir = viewerDir();

  // set once listen() resolves; requests only arrive after that
  let boundPort = preferredPort;
  const allowedHosts = () =>
    new Set([`localhost:${boundPort}`, `127.0.0.1:${boundPort}`, `[::1]:${boundPort}`]);

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    // DNS-rebinding and cross-site protection for everything under /api:
    // the Host must be this server's own, and browser requests (Origin set)
    // must come from a page this server itself served
    if (url.pathname.startsWith("/api/")) {
      const { host, origin } = req.headers;
      const originHost =
        typeof origin === "string" ? origin.replace(/^https?:\/\//, "") : undefined;
      if (
        host === undefined ||
        !allowedHosts().has(host) ||
        (originHost !== undefined && !allowedHosts().has(originHost))
      ) {
        res.writeHead(403, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "forbidden" }));
        return;
      }
    }
    if (url.pathname === "/api/traces") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(source.current().listJson);
      return;
    }
    if (url.pathname === "/api/trace") {
      const item = pickTrace(source.current(), url);
      res.writeHead(item ? 200 : 404, { "content-type": "application/json" });
      res.end(item?.traceJson ?? JSON.stringify({ error: "no traces yet" }));
      return;
    }
    if (url.pathname === "/api/raw") {
      const item = pickTrace(source.current(), url);
      const value = item && resolvePath(item.raw, url.searchParams.get("path") ?? "");
      res.writeHead(value === undefined ? 404 : 200, { "content-type": "application/json" });
      res.end(JSON.stringify(value === undefined ? { error: "nothing at path" } : { value }));
      return;
    }
    if (url.pathname === "/api/events") {
      serveEvents(req, res, source);
      return;
    }
    if (url.pathname === "/api/notify" && req.method === "POST" && source.notify) {
      await serveNotify(req, res, source);
      return;
    }
    if (url.pathname === "/api/clear" && req.method === "POST" && source.clear) {
      source.clear();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ success: true }));
      return;
    }
    // unknown api routes must never fall through to the SPA's html
    if (url.pathname.startsWith("/api/")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: `unknown api route: ${url.pathname}` }));
      return;
    }
    let requested: string;
    try {
      requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    const path = normalize(join(dir, requested));
    if (path !== dir && !path.startsWith(dir + sep)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(path);
      res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      // SPA fallback for extension-less deep links only; missing assets stay a hard 404
      const index =
        extname(path) === "" ? await readFile(join(dir, "index.html")).catch(() => null) : null;
      if (index) {
        res.writeHead(200, { "content-type": "text/html" }).end(index);
      } else {
        res.writeHead(404).end("unbox-ai: not found");
      }
    }
  };

  const hosts = source.live ? ["127.0.0.1", "::1"] : ["127.0.0.1"];
  const bound = await listen(handler, hosts, preferredPort, options.exactPort ? 1 : 10);
  boundPort = bound.port;
  return bound;
}

/**
 * Server-sent events: a hello frame announcing the mode, then one update
 * frame per trace change. The viewer refetches /api/trace on each update.
 */
function serveEvents(req: IncomingMessage, res: ServerResponse, source: TraceSource): void {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
  });
  // a push can race the disconnect; writing to a destroyed socket must not throw
  res.on("error", () => {});
  const send = (frame: string) => {
    if (!res.destroyed) res.write(frame);
  };
  send(`event: hello\ndata: ${JSON.stringify({ live: source.live })}\n\n`);
  const unsubscribe = source.subscribe?.(() => send("event: update\ndata: {}\n\n"));
  const heartbeat = setInterval(() => send(": ping\n\n"), 30_000);
  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe?.();
  });
}

/** Ingests @ai-sdk/devtools pings: {event, timestamp, dbPath}. */
async function serveNotify(
  req: IncomingMessage,
  res: ServerResponse,
  source: TraceSource,
): Promise<void> {
  let dbPath: unknown;
  try {
    dbPath = (JSON.parse(await readBody(req)) as { dbPath?: unknown }).dbPath;
  } catch {
    // an oversized body drops the connection; nothing left to respond to
    if (req.destroyed) return;
    // a malformed body still triggers a reload of the current db path
  }
  const accepted = source.notify!(dbPath);
  res.writeHead(accepted ? 200 : 400, { "content-type": "application/json" });
  res.end(JSON.stringify(accepted ? { success: true } : { error: "invalid dbPath" }));
}

function readBody(req: IncomingMessage, limit = 64 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
      if (body.length > limit) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

/**
 * Binds one server per host on the same port, retrying the whole set on the
 * next port when any host is taken - a partially bound port would let
 * another process shadow the other stack. Hosts a machine does not have
 * (no IPv6 loopback) are skipped.
 */
async function listen(
  handler: Handler,
  hosts: string[],
  preferredPort: number,
  maxAttempts: number,
): Promise<{ servers: Server[]; port: number }> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const port = preferredPort + attempt;
    const servers: Server[] = [];
    try {
      for (const host of hosts) {
        const server = createServer(handler);
        try {
          await tryListen(server, port, host);
          servers.push(server);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "EADDRNOTAVAIL" || code === "EAFNOSUPPORT") continue;
          throw error;
        }
      }
      if (servers.length === 0) throw new Error(`no loopback host available for port ${port}`);
      return { servers, port };
    } catch (error) {
      for (const server of servers) server.close();
      const busy = (error as NodeJS.ErrnoException).code === "EADDRINUSE";
      if (!busy || attempt === maxAttempts - 1) throw error;
    }
  }
  throw new Error("unreachable");
}

function tryListen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}
