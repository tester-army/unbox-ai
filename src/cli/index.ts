import { parseArgs } from "node:util";
import { resolve } from "node:path";
import type { MessageRole } from "../core/types";
import { event } from "./commands/event";
import { events } from "./commands/events";
import { get } from "./commands/get";
import { messages } from "./commands/messages";
import { summary } from "./commands/summary";
import { tools } from "./commands/tools";
import { runs } from "./commands/runs";
import { createLiveSource } from "./live";
import { fail, loadCollectionFiles, loadRun, loadTrace } from "./load";
import { openBrowser } from "./open-browser";
import { setTraceRef } from "./output";
import { startServer, staticSource } from "./server";

const HELP = `unbox-ai - visualize and explore AI traces

Usage:
  unbox-ai <trace.json>                  open the visualization (summary when piped)
  unbox-ai view <trace.json> [more...]   open the visualization (several files = one run list)
  unbox-ai devtools                      live viewer for AI SDK apps (@ai-sdk/devtools drop-in)
  unbox-ai runs <trace.json>             one line per independent run (devtools databases)
  unbox-ai summary <trace.json>          totals + one line per generation
  unbox-ai events <trace.json>           generation table (tokens, latency, cost, tool calls)
  unbox-ai event <trace.json> <idx>      one generation: metrics, token split, new messages
  unbox-ai tools <trace.json>            tool usage summary (--all for every call)
  unbox-ai messages <trace.json>         search messages (--role, --event, --grep, --limit)
  unbox-ai get <trace.json> <path>       raw value at a path, e.g. events[3].messages[2].content

Options:
  --json          machine-readable output, unbounded (summary, events, event, messages)
  --run <n|id>    scope a text command to one run of a multi-run source (see: runs)
  --port <n>      server port (view default 4177; devtools default 4983)
  --no-open       start the server without opening a browser
  --role <r>      filter: system | user | assistant | tool-result | unknown
  --event <n>     filter: only messages of generation n
  --grep <q>      filter: case-insensitive regex (literal fallback) over content and tool calls
  --limit <n>     max messages printed (default 30)

Plain output is bounded; truncations include the exact "get" invocation
that returns the rest. --json is complete and therefore unbounded.
All commands are read-only - safe for agents to run freely.`;

const COMMANDS = new Set(["view", "runs", "summary", "events", "event", "tools", "messages", "get"]);

const ROLES: MessageRole[] = ["system", "user", "assistant", "tool-result", "unknown"];

function main(): void {
  const { values, positionals } = parseArgs({
    options: {
      json: { type: "boolean", default: false },
      run: { type: "string" },
      port: { type: "string" },
      "no-open": { type: "boolean", default: false },
      all: { type: "boolean", default: false },
      role: { type: "string" },
      event: { type: "string" },
      grep: { type: "string" },
      limit: { type: "string", default: "30" },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
    allowPositionals: true,
  });

  if (values.version) {
    console.log(VERSION);
    return;
  }
  if (values.help || positionals.length === 0) {
    console.log(HELP);
    return;
  }

  const [first, ...rest] = positionals;
  if (first === "devtools") {
    devtools(values).catch((error) =>
      fail(error instanceof Error ? error.message : String(error)),
    );
    return;
  }
  const command = COMMANDS.has(first!) ? first! : defaultCommand();
  const paths = COMMANDS.has(first!) ? rest : [first!, ...rest];
  const [tracePath, arg] = paths;
  if (!tracePath) fail("Missing trace file. See: unbox-ai --help");

  if (command === "view") {
    view(paths, values).catch((error) =>
      fail(error instanceof Error ? error.message : String(error)),
    );
    return;
  }
  if (command === "runs") {
    runs(loadCollectionFiles(paths), values.json);
    return;
  }

  if (values.run !== undefined) setTraceRef(`<trace> --run ${values.run}`);
  const loaded = values.run !== undefined ? loadRun(tracePath, values.run) : loadTrace(tracePath);

  switch (command) {
    case "summary":
      summary(loaded, values.json);
      return;
    case "events":
      events(loaded, values.json);
      return;
    case "event":
      event(loaded, parseIndex(arg), values.json);
      return;
    case "tools":
      tools(loaded, values.json, values.all);
      return;
    case "messages":
      messages(
        loaded,
        {
          role: values.role !== undefined ? parseRole(values.role) : undefined,
          event: values.event !== undefined ? parseIndex(values.event) : undefined,
          grep: values.grep,
          limit: parseIndex(values.limit),
        },
        values.json,
      );
      return;
    case "get":
      if (!arg) fail("Missing path. Example: unbox-ai get trace.json 'events[0].model'");
      get(loaded, arg);
      return;
  }
}

/** Bare `unbox-ai trace.json` opens the browser for humans, prints summary for pipes. */
function defaultCommand(): string {
  return process.stdout.isTTY ? "view" : "summary";
}

async function view(
  paths: string[],
  values: { port?: string; "no-open": boolean },
): Promise<void> {
  const items = loadCollectionFiles(paths);
  if (items.length === 0) fail("No runs found in the given files.");
  const { port } = await startServer(staticSource(items), parsePort(values.port ?? "4177"));
  const url = `http://localhost:${port}`;
  const label = paths.length === 1 ? paths[0] : `${paths.length} files`;
  const runs = items.length > 1 ? ` (${items.length} runs)` : "";
  console.log(`unbox-ai: serving ${label}${runs} at ${url} (ctrl-c to stop)`);
  if (!values["no-open"]) openBrowser(url);
}

/**
 * Live devtools mode: a drop-in replacement for the @ai-sdk/devtools viewer.
 * The DevToolsTelemetry integration in the user's app writes
 * .devtools/generations.json and POSTs /api/notify after every step; this
 * server re-reads the file on each ping and pushes updates to the viewer.
 * The port must be exact - the app targets it directly (AI_SDK_DEVTOOLS_PORT).
 */
async function devtools(values: { port?: string; "no-open": boolean }): Promise<void> {
  const dbPath = resolve(process.cwd(), ".devtools/generations.json");
  const source = createLiveSource(dbPath);
  const hasData = source.reload();
  const preferred = parsePort(values.port ?? process.env.AI_SDK_DEVTOOLS_PORT ?? "4983");
  const { port } = await startServer(source, preferred, { exactPort: true }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
      fail(
        `port ${preferred} is in use - is @ai-sdk/devtools or another unbox-ai devtools running?\n` +
          `Pick another port with --port <n> and set AI_SDK_DEVTOOLS_PORT=<n> in your app.`,
      );
    }
    throw error;
  });
  const url = `http://localhost:${port}`;
  console.log(`unbox-ai: devtools viewer at ${url} (ctrl-c to stop)`);
  if (hasData) {
    console.log(`unbox-ai: loaded ${dbPath}`);
  } else {
    console.log(`unbox-ai: waiting for AI SDK calls. In your app:

  import { registerTelemetry } from "ai";
  import { DevToolsTelemetry } from "@ai-sdk/devtools";

  registerTelemetry(DevToolsTelemetry());
`);
  }
  if (!values["no-open"]) openBrowser(url);
}

function parseIndex(value: string | undefined): number {
  const n = Number(value);
  if (value === undefined || !Number.isInteger(n) || n < 0) {
    fail(`Expected a non-negative integer, got: ${value}`);
  }
  return n;
}

function parsePort(value: string): number {
  const port = parseIndex(value);
  if (port < 1 || port > 65535) fail(`Port out of range 1-65535: ${value}`);
  return port;
}

function parseRole(value: string): MessageRole {
  if (!(ROLES as string[]).includes(value)) {
    fail(`Unknown role: ${value}. Expected one of: ${ROLES.join(", ")}`);
  }
  return value as MessageRole;
}

declare const VERSION: string;

main();
