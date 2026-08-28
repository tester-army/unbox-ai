<p align="center">
  <img src="https://github.com/user-attachments/assets/7fb2acb1-373a-44dd-9c32-b812f89f81a2" alt="unbox-ai" />
</p>

<p align="center">
  <a href="#quickstart"><strong>Quickstart</strong></a> |
  <a href="#ai-sdk-devtools-live"><strong>AI SDK DevTools</strong></a> |
  <a href="#the-viewer"><strong>Viewer</strong></a> |
  <a href="#for-agents"><strong>For Agents</strong></a> |
  <a href="#skill-installation"><strong>Skills</strong></a> |
  <a href="#trace-formats"><strong>Trace Formats</strong></a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/unbox-ai"><img src="https://img.shields.io/npm/v/unbox-ai?logo=npm&color=cb3837" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/unbox-ai"><img src="https://img.shields.io/npm/dm/unbox-ai?logo=npm" alt="npm downloads" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license" /></a>
</p>

## See where your agent's tokens actually go.

unbox-ai turns an AI agent trace into something you can read. One command opens
a local visualization of the run; the same binary doubles as a bounded,
read-only trace explorer for coding agents.

- Bundle-analyzer-style treemap of input tokens: system prompt, each tool
  definition, each message.
- Latency waterfall with TTFT, tokens, and cost per generation.
- Deduplicated conversation view: only what is new in each generation.
- Agent-safe CLI: capped output, `--json`, no accidental servers.

```bash
npx unbox-ai trace.json
```

<p align="center">
  <img src="https://github.com/user-attachments/assets/94773c30-8c8e-495b-9c6c-4c6c521c5051" alt="unbox-ai viewer" />
</p>

## Why

Agent traces are unreadable raw. Every generation resends the full context, so
a 16-generation trace holds hundreds of duplicated messages, and in a typical
run ~90% of input tokens are the system prompt and tool definitions, paid again
on every request. unbox-ai makes that visible.

## Quickstart

```bash
npx unbox-ai trace.json
```

That's it. A local server starts and your browser opens the viewer. Works with
gateway exports, opencode session exports, and AI SDK devtools databases (see
[Trace Formats](#trace-formats)).

```
--json        machine-readable output
--by <key>    summary aggregation: model | agent | segment
--port <n>    server port (view default 4177, devtools default 4983)
--no-open     start the server without opening a browser
```

## AI SDK DevTools (live)

`unbox-ai devtools` is a drop-in replacement for the
[`@ai-sdk/devtools`](https://www.npmjs.com/package/@ai-sdk/devtools) viewer:
same capture setup, this viewer instead. Instrument your app exactly as the
AI SDK documents it:

```ts
import { registerTelemetry } from "ai";
import { DevToolsTelemetry } from "@ai-sdk/devtools";

registerTelemetry(DevToolsTelemetry());
```

Then, instead of `npx @ai-sdk/devtools`, run:

```bash
npx unbox-ai devtools
```

Every `generateText` / `streamText` call streams into the viewer live - token
treemap, cache-hit attribution, latency waterfall, and diffed messages update
as your agent runs. Every run gets its own entry in the sidebar run list, with
nested agent runs (tools that call the AI SDK again) indented under their
parent; the viewer follows the newest run until you pin an older one, and
concurrent streams stay individually visible. The static commands work on the
database file too: `unbox-ai summary .devtools/generations.json`.

The run list is not devtools-only - `unbox-ai view a.trace.json b.trace.json`
opens several trace files (any mix of formats) as one run list.

## The Viewer

- **Context treemap** - input tokens attributed to system prompt, each tool
  definition, and each conversation message. Toggle per-generation vs
  cumulative (size x times resent) and tokens vs cost.
- **Timeline waterfall** - latency per generation with TTFT marks, tokens, cost.
- **Generation detail** - only the messages new since the previous generation,
  tool calls paired with their results, raw JSON one click away.
- **File tabs** - `unbox-ai view a.json b.json` opens one tab per file; the
  sidebar run list scopes to the active tab. Tabs close (x), and the + button
  or dropping a .json anywhere opens more traces without restarting the
  server.

Token attribution is estimated (character-proportional, scaled to the reported
per-generation totals) and labeled as such.

## For Agents

The same binary is a bounded, read-only trace explorer - safe to allowlist:

```bash
unbox-ai runs trace.json             # multi-run sources: one line per run, then scope with --run
unbox-ai summary trace.json          # totals + one line per generation
unbox-ai summary trace.json --by model   # totals grouped by model
unbox-ai events trace.json           # table: tokens, latency, cost, tool calls
unbox-ai event trace.json 5          # one generation, new messages only
unbox-ai tools trace.json            # every tool call: status, time, size, args
unbox-ai messages trace.json --grep "error" --role assistant --limit 10
unbox-ai get trace.json 'events[5].messages[10].tool_calls[0]'
unbox-ai compare a.json b.json       # A/B two runs: metric deltas + system prompt / tool diff
```

`compare` is built for prompt and model A/B: it prints token / cost / time /
cache deltas, a diff of the task (differing tasks make every delta
misleading), per-tool usage deltas (which tools each run leaned on), then a
line diff of the system prompt and the tool-set changes - added / removed
names plus, per changed tool, what changed (description or schema) and the
definition diff ("what changed and what did it buy"). Add
`--trajectory` for a content-aligned action table (LCS over tool sequences,
so an extra step in one run offsets nothing) that marks exactly which steps
differ. Two runs of one file: `unbox-ai compare db.json --run 0
--run 1`. The viewer has the same thing interactively: a **compare** button
(2+ runs) opens a side-by-side trajectory where each aligned generation
expands into both runs' messages.

In the viewer, **copy for agent** (header, top right) copies the exact
`summary` command for the run on screen - paste it into your agent to hand
over what you're looking at.

Every command caps its output; truncations print the exact `get` invocation
that returns the rest. `--json` gives machine-readable output. When stdout is
not a TTY, bare `unbox-ai trace.json` prints the summary instead of starting a
server, so agents never spawn one by accident.

## Skill Installation

An agent skill ships in [`skills/unbox-ai/`](skills/unbox-ai/SKILL.md) with the
full workflow and analysis recipes. Install it into your agent (Claude Code and
friends) via the [skills](https://skills.sh) CLI:

```bash
npx skills add tester-army/unbox-ai -g
```

Or copy `skills/unbox-ai/` into your agent's skills directory manually
(e.g. `~/.claude/skills/unbox-ai/`). Prefer zero setup? Drop this in your
AGENTS.md:

```markdown
To inspect AI trace files, use `npx unbox-ai` (read-only, bounded output):
`unbox-ai summary <trace>`, then `unbox-ai event <trace> <idx>` to drill in,
`unbox-ai messages <trace> --grep <re>` to search, and the printed `get`
pointers to fetch full values.
```

## Trace Formats

- **Gateway exports** - a JSON object with `events[]` of `generation` entries
  carrying `model`, `metrics` (latency, tokens, cost), `available_tools`, and
  cumulative `messages` snapshots. Conversation resets and multi-agent
  interleaving are detected and shown as segments.
- **opencode session exports** (`{info, messages[{info, parts}]}`) - adapted
  automatically. Real cache read/write tokens and per-tool execution times
  carry over. Note: opencode exports omit the system prompt and tool
  definitions, so token attribution assigns their weight to the conversation.
- **AI SDK devtools databases** (`{runs[], steps[]}`,
  `.devtools/generations.json` written by `@ai-sdk/devtools`) - adapted
  automatically, and served live by `unbox-ai devtools`. Cache-read tokens
  carry over; the AI SDK reports no cost or TTFT, so those show as zero/absent.
  Tool definitions arrive without their JSON schemas, so the treemap's tools
  group reflects names and descriptions only.

There is no universal AI-trace standard yet; the closest are the OpenTelemetry
GenAI semantic conventions, OpenInference, and OpenLLMetry (all span-based).
Adapters for those are welcome contributions: implement `TraceAdapter`
(detect + adapt) in `src/core/adapters/<name>.ts` and register it in
`src/core/adapters/index.ts` - `src/core/adapters/opencode.ts` is the
reference. `unbox-ai summary` prints which format was detected.

## Contributing

PRs welcome, especially trace-format adapters. The published CLI runs on Node >=18; developing and releasing need Node >=22.21 (what CI uses). To develop locally:

```bash
npm install
UNBOX_TRACE=path/to/trace.json npm run dev   # viewer with live reload
npm run build                                 # dist/viewer + dist/cli
node dist/cli/index.js summary path/to/trace.json
npm run check                                 # lint (biome) + typecheck + tests (vitest)
```

## Releasing

`npm run release` (from main, clean tree) runs [release-it](https://github.com/release-it/release-it): version inferred from conventional commits, CHANGELOG.md updated, git tag + GitHub release + npm publish. The GitHub token comes from `gh auth token` (or a `GITHUB_TOKEN` you export); npm needs `npm login` once. Preview with `npm run release -- --dry-run --ci`.

## License

MIT

---

<p align="center">
  Built with ❤️ by <a href="https://tester.army"><strong>TesterArmy</strong></a>
</p>
