import { parseArgs } from "node:util";
import type { MessageRole } from "../core/types";
import { event } from "./commands/event";
import { events } from "./commands/events";
import { get } from "./commands/get";
import { messages } from "./commands/messages";
import { summary } from "./commands/summary";
import { fail, loadTrace } from "./load";
import { openBrowser } from "./open-browser";
import { startServer } from "./server";

const HELP = `unbox-ai - visualize and explore AI traces

Usage:
  unbox-ai <trace.json>                  open the visualization (summary when piped)
  unbox-ai view <trace.json>             open the visualization
  unbox-ai summary <trace.json>          totals + one line per generation
  unbox-ai events <trace.json>           generation table (tokens, latency, cost, tool calls)
  unbox-ai event <trace.json> <idx>      one generation: metrics, token split, new messages
  unbox-ai messages <trace.json>         search messages (--role, --event, --grep, --limit)
  unbox-ai get <trace.json> <path>       raw value at a path, e.g. events[3].messages[2].content

Options:
  --json          machine-readable output, unbounded (summary, events, event, messages)
  --port <n>      server port for view (default 4177)
  --no-open       start the server without opening a browser
  --role <r>      filter: system | user | assistant | tool-result | unknown
  --event <n>     filter: only messages of generation n
  --grep <re>     filter: case-insensitive regex over content and tool calls
  --limit <n>     max messages printed (default 30)

Plain output is bounded; truncations include the exact "get" invocation
that returns the rest. --json is complete and therefore unbounded.
All commands are read-only - safe for agents to run freely.`;

const COMMANDS = new Set(["view", "summary", "events", "event", "messages", "get"]);

const ROLES: MessageRole[] = ["system", "user", "assistant", "tool-result", "unknown"];

function main(): void {
  const { values, positionals } = parseArgs({
    options: {
      json: { type: "boolean", default: false },
      port: { type: "string", default: "4177" },
      "no-open": { type: "boolean", default: false },
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
  const command = COMMANDS.has(first!) ? first! : defaultCommand();
  const [tracePath, arg] = COMMANDS.has(first!) ? rest : [first, ...rest];
  if (!tracePath) fail("Missing trace file. See: unbox-ai --help");

  const loaded = loadTrace(tracePath);

  switch (command) {
    case "view":
      view(loaded, values).catch((error) =>
        fail(error instanceof Error ? error.message : String(error)),
      );
      return;
    case "summary":
      summary(loaded, values.json);
      return;
    case "events":
      events(loaded, values.json);
      return;
    case "event":
      event(loaded, parseIndex(arg), values.json);
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
  loaded: ReturnType<typeof loadTrace>,
  values: { port: string; "no-open": boolean },
): Promise<void> {
  const { port } = await startServer(loaded.trace, loaded.raw, parsePort(values.port));
  const url = `http://localhost:${port}`;
  console.log(`unbox-ai: serving ${loaded.path} at ${url} (ctrl-c to stop)`);
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
