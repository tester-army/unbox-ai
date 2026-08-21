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
      const { normalizeTrace, parseTrace } = await import("./src/core/normalize");
      const { resolvePath } = await import("./src/core/path");
      server.middlewares.use("/api/raw", (req, res) => {
        try {
          const raw = parseTrace(JSON.parse(readFileSync(process.env.UNBOX_TRACE ?? "", "utf8")));
          const path = new URL(req.url ?? "", "http://localhost").searchParams.get("path") ?? "";
          const value = resolvePath(raw, path);
          res.statusCode = value === undefined ? 404 : 200;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(value === undefined ? { error: "nothing at path" } : { value }));
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(error) }));
        }
      });
      server.middlewares.use("/api/trace", (_req, res) => {
        const sendError = (message: string) => {
          res.statusCode = 500;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: message }));
        };
        const tracePath = process.env.UNBOX_TRACE;
        if (!tracePath) {
          sendError("Set UNBOX_TRACE=<file> to serve a trace in dev");
          return;
        }
        try {
          const raw = parseTrace(JSON.parse(readFileSync(tracePath, "utf8")));
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(normalizeTrace(raw)));
        } catch (error) {
          sendError(error instanceof Error ? error.message : String(error));
        }
      });
    },
  };
}

export default defineConfig({
  root: "src/viewer",
  plugins: [react(), tailwindcss(), devTraceApi()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src/viewer"),
      "@core": resolve(import.meta.dirname, "src/core"),
    },
  },
  build: {
    outDir: resolve(import.meta.dirname, "dist/viewer"),
    emptyOutDir: true,
  },
});
