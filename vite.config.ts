import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * Dev-only middleware that serves a normalized trace at /api/trace,
 * mirroring what the CLI server does in production.
 * Usage: UNBOX_TRACE=path/to/trace.json npm run dev
 */
function devTraceApi(): Plugin {
  return {
    name: "unbox-dev-trace-api",
    async configureServer(server) {
      const { parseCollection, runSummaries } = await import("./src/core/collection");
      const { resolvePath } = await import("./src/core/path");
      const loadItems = () => {
        const tracePath = process.env.UNBOX_TRACE;
        if (!tracePath) throw new Error("Set UNBOX_TRACE=<file> to serve a trace in dev");
        return parseCollection(JSON.parse(readFileSync(tracePath, "utf8"))).items;
      };
      const pick = (req: { url?: string }) => {
        const url = new URL(req.url ?? "", "http://localhost");
        const items = loadItems();
        const id = url.searchParams.get("id");
        const item = id === null ? items.at(-1) : items.find((it) => it.trace.traceId === id);
        return { url, item };
      };
      const send = (res: import("node:http").ServerResponse, status: number, body: unknown) => {
        res.statusCode = status;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(body));
      };
      server.middlewares.use("/api/raw", (req, res) => {
        try {
          const { url, item } = pick(req);
          const value = item && resolvePath(item.raw, url.searchParams.get("path") ?? "");
          if (value === undefined) return send(res, 404, { error: "nothing at path" });
          send(res, 200, { value });
        } catch (error) {
          send(res, 500, { error: String(error) });
        }
      });
      // static stand-in for the CLI's SSE endpoint so EventSource connects in dev
      server.middlewares.use("/api/events", (_req, res) => {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        res.write('event: hello\ndata: {"live":false}\n\n');
      });
      server.middlewares.use("/api/traces", (_req, res) => {
        try {
          send(res, 200, runSummaries(loadItems()));
        } catch (error) {
          send(res, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      });
      server.middlewares.use("/api/trace", (req, res) => {
        try {
          const { item } = pick(req);
          if (!item) return send(res, 404, { error: "no traces yet" });
          send(res, 200, item.trace);
        } catch (error) {
          send(res, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      });
    },
  };
}

export default defineConfig({
  root: "src/viewer",
  plugins: [react(), tailwindcss(), devTraceApi()],
  resolve: {
    alias: [
      { find: "@core", replacement: resolve(import.meta.dirname, "src/core") },
      { find: "@", replacement: resolve(import.meta.dirname, "src/viewer") },
      // @pierre/diffs imports the full shiki bundle (every grammar as a
      // chunk); the viewer only diffs markdown and json - see the shims
      {
        find: /^shiki$/,
        replacement: resolve(import.meta.dirname, "src/viewer/lib/shiki-slim.ts"),
      },
      {
        find: /^shiki\/wasm$/,
        replacement: resolve(import.meta.dirname, "src/viewer/lib/shiki-wasm-stub.ts"),
      },
    ],
  },
  build: {
    outDir: resolve(import.meta.dirname, "dist/viewer"),
    emptyOutDir: true,
  },
});
