/**
 * Plain-language explanations for every nuanced term in the dashboard.
 * One source so the wording stays consistent wherever a term appears.
 */
export const GLOSSARY = {
  "model time":
    "Total time the model itself spent across all requests. Tool execution and idle time between requests are not included.",
  "prompt wait":
    "Time to first token (TTFT): how long the model reads the request before it starts answering. A high share means latency comes from input size, not from writing the answer.",
  "repeated prefix":
    "The part of a request that is byte-identical to the previous request. Providers can serve it from prompt cache instead of re-processing it, making it cheaper and faster. Reported cache reads are used when the trace has them; otherwise this is inferred from repeats.",
  "fresh input":
    "Input tokens that were not part of the previous request: new messages, plus anything rewritten in place (rewrites break the cache).",
  segment:
    "One conversation thread. A new segment starts when the context resets or a different agent takes a turn.",
  generation: "A single model request and its response.",
  est: "Estimated: per-block numbers are derived from character counts, scaled so they sum to the reported token totals.",
  "re-paid prefix":
    "Input tokens spent re-processing a system prompt and tool definitions that were already processed in an earlier conversation - paid again because each fresh conversation starts from zero.",
  "time chart":
    "Rows are events: generation bars sized by model latency, followed by their tool calls - drawn as bars when the trace reports execution time, dots when it does not. Drag the track to scrub, click a tool block for its input/output, press play to replay the run.",
  "context treemap":
    "Where the selected request's input tokens go: system prompt, each tool definition, and each conversation message, sized by estimated tokens. Bright blocks are fresh input; faint blocks are repeated prefix. Click a block for its full definition.",
} as const;

export type GlossaryTerm = keyof typeof GLOSSARY;
