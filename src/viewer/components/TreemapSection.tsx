import { useMemo, useState } from "react";
import type { Generation, NormalizedTrace } from "@core/types";
import { formatPercent, formatTokens } from "@core/format";
import { DefinitionDialog } from "@/components/DefinitionDialog";
import { Treemap } from "@/components/Treemap";
import { Hint } from "@/components/ui/hint";
import { Section } from "@/components/ui/section";
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
  const [pinnedId, setPinnedId] = useState<string | null>(null);

  const groups = useMemo(
    () => buildTreemapData(trace, generation, scope, sizeBy),
    [trace, generation, scope, sizeBy],
  );
  const leaves = groups.flatMap((g) => g.leaves);
  const totalTokens = leaves.reduce((acc, l) => acc + l.estTokens, 0);
  // derived, so the inspector can never show a leaf from stale treemap data
  const pinned = leaves.find((leaf) => leaf.id === pinnedId) ?? null;
  const inspected = leaves.find((leaf) => leaf.id === inspectedId) ?? pinned;

  return (
    <Section
      title="context"
      hint="context treemap"
      meta={
        scope === "generation" ? (
          <>
            gen {generation.index} ·{" "}
            <span className="text-ta-orange-75">
              {formatTokens(generation.metrics.inputTokens - generation.breakdown.cacheableTokens)}
            </span>{" "}
            <Hint term="fresh input">fresh</Hint> ·{" "}
            {formatTokens(generation.breakdown.cacheableTokens)}{" "}
            <Hint term="repeated prefix">repeated prefix</Hint> · <Hint term="est">est</Hint>
          </>
        ) : (
          <>
            all generations · <Hint term="est">est</Hint>
          </>
        )
      }
      actions={
        <>
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
        </>
      }
    >
      <div className="px-6 pb-3">
        <Treemap
          groups={groups}
          onInspect={setInspectedId}
          onOpen={(id) => setPinnedId((current) => (current === id ? null : id))}
        />
        <div className="type-accent-s mt-2 flex min-h-10 items-center gap-4 border border-ta-grey-400 bg-ta-grey-450 px-3 py-2 text-ta-grey-100">
          {inspected ? (
            <>
              <span className="shrink-0 text-ta-orange-75">{inspected.label}</span>
              <span className="shrink-0">
                ~{formatTokens(inspected.estTokens)} tok (
                {formatPercent(inspected.estTokens, totalTokens)})
                {inspected.sentCount > 1 ? ` sent ${inspected.sentCount}x` : ""}
                {inspected.cached === undefined ? "" : inspected.cached ? " · repeated prefix" : " · fresh"}
              </span>
              <span className="type-body-s min-w-0 truncate normal-case text-ta-grey-200">
                {inspected.preview || "(no text)"}
              </span>
            </>
          ) : (
            <span className="text-ta-grey-200">hover a block to inspect it · click to pin its full definition</span>
          )}
        </div>
        {pinned && (
          <DefinitionDialog
            traceId={trace.traceId}
            leaf={pinned}
            onClose={() => setPinnedId(null)}
          />
        )}
      </div>
    </Section>
  );
}
