import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { NormalizedTrace } from "../core/types";

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".json": "application/json",
};

/** Directory of built viewer assets, shipped next to the bundled CLI. */
function viewerDir(): string {
  return fileURLToPath(new URL("../viewer", import.meta.url));
}

/**
 * Serves the built viewer plus the normalized trace at /api/trace,
 * retrying on the next port when the requested one is taken.
 */
export async function startServer(
  trace: NormalizedTrace,
  preferredPort: number,
): Promise<{ server: Server; port: number }> {
  const traceJson = JSON.stringify(trace);
  const dir = viewerDir();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/api/trace") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(traceJson);
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
        extname(path) === ""
          ? await readFile(join(dir, "index.html")).catch(() => null)
          : null;
      if (index) {
        res.writeHead(200, { "content-type": "text/html" }).end(index);
      } else {
        res.writeHead(404).end("unbox-ai: not found");
      }
    }
  });

  const port = await listen(server, preferredPort);
  return { server, port };
}

async function listen(server: Server, preferredPort: number): Promise<number> {
  const MAX_ATTEMPTS = 10;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const port = preferredPort + attempt;
    try {
      await tryListen(server, port);
      return port;
    } catch (error) {
      const busy = (error as NodeJS.ErrnoException).code === "EADDRINUSE";
      if (!busy || attempt === MAX_ATTEMPTS - 1) throw error;
    }
  }
  throw new Error("unreachable");
}

function tryListen(server: Server, port: number): Promise<void> {
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
    server.listen(port, "127.0.0.1");
  });
}
