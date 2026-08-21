import type {
  BreakdownGroupKey,
  Generation,
  NormalizedTrace,
} from "@core/types";

export type TreemapScope = "generation" | "cumulative";
export type TreemapSizeBy = "tokens" | "cost";

export interface TreemapLeaf {
  id: string;
  label: string;
  group: BreakdownGroupKey;
  /** Sizing value: estimated tokens, or estimated dollars when sizing by cost. */
  value: number;
  estTokens: number;
  preview: string;
  /** How many generations this item was sent in (cumulative scope). */
  sentCount: number;
}

export interface TreemapGroupData {
  key: BreakdownGroupKey;
  total: number;
  leaves: TreemapLeaf[];
}

/**
 * Builds treemap leaves for one generation, or aggregated over all
 * generations (each item summed across every request that resent it).
 * Cost sizing attributes each generation's cost proportionally to its
 * input-token split.
 */
export function buildTreemapData(
  trace: NormalizedTrace,
  selected: Generation,
  scope: TreemapScope,
  sizeBy: TreemapSizeBy,
): TreemapGroupData[] {
  const generations = scope === "generation" ? [selected] : trace.generations;
  const leaves = new Map<string, TreemapLeaf>();

  for (const gen of generations) {
    const totalTokens = gen.metrics.inputTokens + gen.metrics.outputTokens;
    const costPerToken = totalTokens > 0 ? gen.metrics.cost / totalTokens : 0;
    for (const group of gen.breakdown.groups) {
      for (const item of group.items) {
        const value = sizeBy === "tokens" ? item.estTokens : item.estTokens * costPerToken;
        const existing = leaves.get(item.id);
        if (existing) {
          existing.value += value;
          existing.estTokens += item.estTokens;
          existing.sentCount += 1;
        } else {
          leaves.set(item.id, {
            id: item.id,
            label: leafLabel(item.id, item.label, scope),
            group: group.key,
            value,
            estTokens: item.estTokens,
            preview: item.preview,
            sentCount: 1,
          });
        }
      }
    }
  }

  return groupLeaves(leaves);
}

/** Message/system ids embed their segment ("system:1:0"); cumulative view needs it visible. */
function leafLabel(id: string, label: string, scope: TreemapScope): string {
  if (scope !== "cumulative" || id.startsWith("tool:")) return label;
  const segment = id.split(":")[1];
  return `${label} · seg ${segment}`;
}

function groupLeaves(leaves: Map<string, TreemapLeaf>): TreemapGroupData[] {
  const keys: BreakdownGroupKey[] = ["system", "tools", "conversation"];
  return keys
    .map((key) => {
      const groupLeaves = [...leaves.values()].filter((leaf) => leaf.group === key);
      return {
        key,
        total: groupLeaves.reduce((acc, leaf) => acc + leaf.value, 0),
        leaves: groupLeaves,
      };
    })
    .filter((group) => group.leaves.length > 0);
}
