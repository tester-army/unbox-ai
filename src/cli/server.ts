import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
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
    const requested = url.pathname === "/" ? "/index.html" : url.pathname;
    const path = normalize(join(dir, requested));
    if (!path.startsWith(dir)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(path);
      res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      // SPA fallback keeps deep links working
      const index = await readFile(join(dir, "index.html")).catch(() => null);
      if (index) {
        res.writeHead(200, { "content-type": "text/html" }).end(index);
      } else {
        res.writeHead(404).end("unbox-ai: viewer assets not found - reinstall the package");
      }
    }
  });

  const port = await listen(server, preferredPort);
  return { server, port };
}

function listen(server: Server, port: number, attempts = 10): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE" && attempts > 0) {
        resolve(listen(server, port + 1, attempts - 1));
      } else {
        reject(error);
      }
    });
    server.listen(port, "127.0.0.1", () => resolve(port));
  });
}
