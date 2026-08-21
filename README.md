# unbox-ai

Unbox AI traces. One command opens a local visualization of an agent run:
a bundle-analyzer-style treemap of where your input tokens go, a latency
waterfall, and a deduplicated conversation view.

```bash
npx unbox-ai trace.json
```

## Why

Agent traces are unreadable raw: every generation resends the full context, so
a 16-generation trace holds hundreds of duplicated messages. In a typical run,
~90% of input tokens are the system prompt and tool definitions, paid again on
every request. unbox-ai makes that visible:

- **Context treemap** - input tokens attributed to system prompt, each tool
  definition, and each conversation message. Toggle per-generation vs
  cumulative (size x times resent) and tokens vs cost.
- **Timeline waterfall** - latency per generation with TTFT marks, tokens, cost.
- **Generation detail** - only the messages new since the previous generation,
  tool calls paired with their results, raw JSON one click away.

Token attribution is estimated (character-proportional, scaled to the reported
per-generation totals) and labeled as such.

## For agents

The same binary is a bounded, read-only trace explorer - safe to allowlist:

```bash
unbox-ai summary trace.json          # totals + one line per generation
unbox-ai events trace.json           # table: tokens, latency, cost, tool calls
unbox-ai event trace.json 5          # one generation, new messages only
unbox-ai messages trace.json --grep "error" --role assistant --limit 10
unbox-ai get trace.json 'events[5].messages[10].tool_calls[0]'
```

Every command caps its output; truncations print the exact `get` invocation
that returns the rest. `--json` gives machine-readable output. When stdout is
not a TTY, bare `unbox-ai trace.json` prints the summary instead of starting
a server, so agents never spawn one by accident.

Drop this in your AGENTS.md:

```markdown
To inspect AI trace files, use `npx unbox-ai` (read-only, bounded output):
`unbox-ai summary <trace>`, then `unbox-ai event <trace> <idx>` to drill in,
`unbox-ai messages <trace> --grep <re>` to search, and the printed `get`
pointers to fetch full values.
```

## Options

```
--json        machine-readable output
--port <n>    server port (default 4177)
--no-open     start the server without opening a browser
```

## Trace format

unbox-ai reads gateway-style trace exports: a JSON object with `events[]` of
`generation` entries carrying `model`, `metrics` (latency, tokens, cost),
`available_tools`, and cumulative `messages` snapshots. Conversation resets
inside one trace are detected and shown as segments. Adapters for other
formats (OTel, OpenInference) are welcome contributions.

## Development

```bash
npm install
UNBOX_TRACE=path/to/trace.json npm run dev   # viewer with live reload
npm run build                                 # dist/viewer + dist/cli
node dist/cli/index.js summary path/to/trace.json
```

## License

MIT
