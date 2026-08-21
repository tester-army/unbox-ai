---
name: unbox-ai
description: Analyze AI agent trace files (*.trace.json - gateway or opencode exports) without reading the raw JSON. Use when asked to inspect an agent run, find why it was slow or expensive, check cache efficiency, debug tool calls, or summarize what an agent did. All commands are read-only with bounded output - safe to run freely.
---

# unbox-ai: explore AI traces from the CLI

Traces are too big to read raw (megabytes of duplicated context). `unbox-ai`
normalizes them and answers questions with bounded output. Never `cat` or Read
a trace file - always go through the CLI.

Run via `npx unbox-ai` (or `node dist/cli/index.js` in the unbox-ai repo).

## Workflow

Always start wide, then drill:

```bash
unbox-ai summary <trace>        # who/what/cost + one line per generation
unbox-ai tools <trace>          # per-tool usage: calls, failures, time, output size
unbox-ai events <trace>         # table: tokens, latency, cost per generation
unbox-ai event <trace> <idx>    # one generation: metrics + only its NEW messages
unbox-ai messages <trace> --grep <q> [--role r] [--event n] [--limit n]
unbox-ai get <trace> '<path>'   # exact raw value, e.g. events[3].messages[2].content
```

- `--json` on summary/events/event/tools/messages for machine-readable output
  (unbounded - prefer the plain forms first).
- Truncated output always prints the exact `get` invocation that returns the
  rest. Follow those pointers instead of guessing paths.
- `--grep` accepts regex; invalid regex silently falls back to literal search.
- `tools --all` lists every individual call with args.
- `unbox-ai view <trace>` starts a localhost visualization - only offer this
  to the human; as an agent, stay on the read commands.

## Reading the numbers

- **generation** = one model request/response. **segment** = one conversation
  thread (resets and interleaved agents split threads).
- `caching NN%` = input tokens that were a repeated, cache-eligible prefix
  (real cache reads when the trace reports them, else inferred from repeats).
- `latency NN% prompt wait` = share of model time spent re-reading input
  (TTFT). High = the run is prompt-bound; shrinking resent context cuts both
  cost and wall-clock.
- `re-paid ~N tokens` = identical system prompt/tools re-processed because
  fresh conversations start from zero - a prompt-caching or one-conversation
  opportunity.
- `event` shows only messages NEW in that generation; earlier context is in
  prior events of the same segment.

## Analysis recipes

Cost hotspots (which segment/agent burns the money):

```bash
unbox-ai events <trace> --json | jq 'group_by(.segment) | map({seg: .[0].segment, model: .[0].model, cost: ([.[].cost] | add), in: ([.[].inputTokens] | add)}) | sort_by(-.cost)'
```

Retry loops (same tool + same args repeating = a stuck agent):

```bash
unbox-ai tools <trace> --json | jq 'group_by(.name + (.args|tostring)) | map(select(length > 2) | {call: .[0].name, args: .[0].args, times: length})'
```

Latency outliers: `unbox-ai events <trace>` and scan the latency column;
drill into the outlier with `event`, and check its tool durations in
`tools --all` (wait-style tools show their requested duration).

Failures: `unbox-ai tools <trace>` failed column, then
`messages --grep "error|failed"` for the evidence trail.

## Supported formats

Gateway exports (`{events[]}` with cumulative message snapshots) and opencode
session exports (`{info, messages[{info, parts}]}`) are auto-detected -
`summary` prints which. Unknown files fail with a readable error; do not
retry with other commands.
