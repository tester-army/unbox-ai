import { useMemo, useState } from "react";
import type { Generation, NormalizedTrace } from "@core/types";
import { formatPercent, formatTokens } from "@core/format";
import { Treemap } from "@/components/Treemap";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  buildTreemapData,
  type TreemapScope,
  type TreemapSizeBy,
} from "@/lib/treemap-data";

interface TreemapSectionProps {
  trace: NormalizedTrace;
  generation: Generation;
}

/** The context treemap: where the input tokens of a request go. */
export function TreemapSection({ trace, generation }: TreemapSectionProps) {
  const [scope, setScope] = useState<TreemapScope>("generation");
  const [sizeBy, setSizeBy] = useState<TreemapSizeBy>("tokens");
  const [inspectedId, setInspectedId] = useState<string | null>(null);

  const groups = useMemo(
    () => buildTreemapData(trace, generation, scope, sizeBy),
    [trace, generation, scope, sizeBy],
  );
  const leaves = groups.flatMap((g) => g.leaves);
  const totalTokens = leaves.reduce((acc, l) => acc + l.estTokens, 0);
  // derived, so the inspector can never show a leaf from stale treemap data
  const inspected = leaves.find((leaf) => leaf.id === inspectedId) ?? null;

  return (
    <section className="border-b border-ta-grey-400">
      <div className="flex items-center gap-4 px-6 py-3">
        <h2 className="type-accent-m text-ta-sand-50">context</h2>
        <p className="type-accent-s text-ta-grey-200">
          {scope === "generation" ? `generation ${generation.index} input · est` : "all generations · est"}
        </p>
        <div className="ml-auto flex gap-2">
          <Tabs value={scope} onValueChange={setScope}>
            <TabsList>
              <TabsTrigger value="generation">generation</TabsTrigger>
              <TabsTrigger value="cumulative">cumulative</TabsTrigger>
            </TabsList>
          </Tabs>
          <Tabs value={sizeBy} onValueChange={setSizeBy}>
            <TabsList>
              <TabsTrigger value="tokens">tokens</TabsTrigger>
              <TabsTrigger value="cost">cost</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>
      <div className="px-6 pb-3">
        <Treemap groups={groups} onInspect={setInspectedId} />
        <div className="type-accent-s mt-2 flex min-h-10 items-start gap-4 border border-ta-grey-400 bg-ta-grey-450 px-3 py-2 text-ta-grey-100">
          {inspected ? (
            <>
              <span className="shrink-0 text-ta-orange-75">{inspected.label}</span>
              <span className="shrink-0">
                ~{formatTokens(inspected.estTokens)} tok (
                {formatPercent(inspected.estTokens, totalTokens)})
                {inspected.sentCount > 1 ? ` sent ${inspected.sentCount}x` : ""}
              </span>
              <span className="type-body-s min-w-0 truncate normal-case text-ta-grey-200">
                {inspected.preview || "(no text)"}
              </span>
            </>
          ) : (
            <span className="text-ta-grey-200">hover a block to inspect it</span>
          )}
        </div>
      </div>
    </section>
  );
}
