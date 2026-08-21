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
      const { normalizeTrace } = await import("./src/core/normalize");
      server.middlewares.use("/api/trace", (_req, res) => {
        const tracePath = process.env.UNBOX_TRACE;
        if (!tracePath) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: "Set UNBOX_TRACE=<file> to serve a trace in dev" }));
          return;
        }
        const raw = JSON.parse(readFileSync(tracePath, "utf8"));
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(normalizeTrace(raw)));
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
