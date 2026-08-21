import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));

export default defineConfig({
  define: { VERSION: JSON.stringify(version) },
  entry: { "cli/index": "src/cli/index.ts" },
  format: ["esm"],
  platform: "node",
  target: "node18",
  clean: false,
  minify: false,
  banner: { js: "#!/usr/bin/env node" },
});
