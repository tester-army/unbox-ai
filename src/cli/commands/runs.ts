import { runSummaries, type TraceCollectionItem } from "../../core/collection";
import { formatTokens, printJson, table } from "../output";

/** One line per independent run; feeds --run selectors on the other commands. */
export function runs(items: TraceCollectionItem[], json: boolean): void {
  const summaries = runSummaries(items);
  if (json) {
    printJson(summaries.map((run, index) => ({ run: index, ...run })));
    return;
  }
  if (summaries.length === 0) {
    console.log("no runs yet");
    return;
  }
  console.log(
    table(
      ["run", "gens", "in", "out", "started", "name"],
      summaries.map((run, index) => [
        String(index),
        String(run.generations),
        formatTokens(run.totalTokens.input),
        formatTokens(run.totalTokens.output),
        run.timestamp,
        "  ".repeat(run.depth) +
          (run.depth > 0 ? "> " : "") +
          (run.inProgress ? "[live] " : "") +
          (run.name.length > 60 ? `${run.name.slice(0, 60)}...` : run.name),
      ]),
    ),
  );
  console.log("\nscope any command to one run: unbox-ai summary <trace> --run <n>");
}
