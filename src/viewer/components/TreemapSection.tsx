import { useEffect, useMemo, useState } from "react";
import type { Generation, NormalizedTrace } from "@core/types";
import { formatPercent, formatTokens } from "@core/format";
import { Treemap } from "@/components/Treemap";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  buildTreemapData,
  type TreemapLeaf,
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
    <section className="border-b border-ta-grey-400">
      <div className="flex items-center gap-4 px-6 py-3">
        <h2 className="type-accent-m text-ta-sand-50">context</h2>
        <p className="type-accent-s text-ta-grey-200">
          {scope === "generation" ? (
            <>
              generation {generation.index} input · est ·{" "}
              <span className="text-ta-orange-75">
                {formatTokens(generation.metrics.inputTokens - generation.breakdown.cacheableTokens)}{" "}
                fresh (bright)
              </span>{" "}
              · {formatTokens(generation.breakdown.cacheableTokens)} repeated prefix (faint)
            </>
          ) : (
            "all generations · est"
          )}
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
        <Treemap
          groups={groups}
          onInspect={setInspectedId}
          onOpen={(id) => setPinnedId((current) => (current === id ? null : id))}
        />
        <div className="type-accent-s mt-2 flex min-h-10 items-start gap-4 border border-ta-grey-400 bg-ta-grey-450 px-3 py-2 text-ta-grey-100">
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
        {pinned && <DefinitionPanel leaf={pinned} onClose={() => setPinnedId(null)} />}
      </div>
    </section>
  );
}

/** Full raw definition of a pinned block, fetched on demand via /api/raw. */
function DefinitionPanel({ leaf, onClose }: { leaf: TreemapLeaf; onClose: () => void }) {
  const [content, setContent] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setContent(null);
    fetch(`/api/raw?path=${encodeURIComponent(leaf.ref)}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
        return body.value;
      })
      .then((value) => {
        if (!cancelled) {
          setContent(typeof value === "string" ? value : JSON.stringify(value, null, 2));
        }
      })
      .catch((error) => !cancelled && setContent(`failed to load: ${error}`));
    return () => {
      cancelled = true;
    };
  }, [leaf.ref]);

  return (
    <div className="mt-2 border border-ta-grey-400 bg-ta-grey-450">
      <div className="flex items-baseline gap-3 border-b border-ta-grey-400 px-3 py-1.5">
        <span className="type-accent-s text-ta-orange-75">{leaf.label}</span>
        <span className="type-accent-s text-ta-grey-200">{leaf.ref}</span>
        <Button className="ml-auto border-none" onClick={onClose}>
          close
        </Button>
      </div>
      <pre className="type-body-s max-h-72 overflow-auto whitespace-pre-wrap px-3 py-2 font-(family-name:--font-dm-mono) text-ta-grey-100">
        {content ?? "loading..."}
      </pre>
    </div>
  );
}
