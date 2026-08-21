import { hierarchy, treemap, treemapSquarify, type HierarchyRectangularNode } from "d3-hierarchy";
import { useMemo } from "react";
import type { BreakdownGroupKey } from "@core/types";
import { formatTokens } from "@core/format";
import type { TreemapGroupData, TreemapLeaf } from "@/lib/treemap-data";
import { useElementSize } from "@/lib/use-element-size";
import { cn } from "@/lib/utils";

const GROUP_HEADER = 20;

const GROUP_STYLE: Record<BreakdownGroupKey, { block: string; label: string }> = {
  system: { block: "bg-ta-sand-300/25 hover:bg-ta-sand-300/40", label: "text-ta-sand-300" },
  tools: { block: "bg-ta-orange-300/20 hover:bg-ta-orange-300/35", label: "text-ta-orange-75" },
  conversation: { block: "bg-ta-grey-300/25 hover:bg-ta-grey-300/40", label: "text-ta-grey-100" },
};

interface TreemapNode {
  key?: BreakdownGroupKey;
  leaf?: TreemapLeaf;
  children?: TreemapNode[];
}

interface TreemapProps {
  groups: TreemapGroupData[];
  onInspect: (leaf: TreemapLeaf | null) => void;
}

/** Squarified treemap rendered as plain divs - square corners, borders for depth. */
export function Treemap({ groups, onInspect }: TreemapProps) {
  const { ref, width } = useElementSize<HTMLDivElement>();
  const height = 380;

  const leaves = useMemo(() => {
    if (width === 0) return [];
    const root = hierarchy<TreemapNode>({
      children: groups.map((group) => ({
        key: group.key,
        children: group.leaves.map((leaf) => ({ leaf })),
      })),
    })
      .sum((node) => node.leaf?.value ?? 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    treemap<TreemapNode>()
      .tile(treemapSquarify)
      .size([width, height])
      .paddingInner(2)
      .paddingTop((node) => (node.depth === 1 ? GROUP_HEADER : 0))(root);
    return root.descendants().filter((node) => node.depth > 0) as HierarchyRectangularNode<TreemapNode>[];
  }, [groups, width, height]);

  return (
    <div
      ref={ref}
      className="relative w-full border border-ta-grey-400 bg-ta-grey-450"
      style={{ height }}
      onMouseLeave={() => onInspect(null)}
    >
      {leaves.map((node) => {
        const w = node.x1 - node.x0;
        const h = node.y1 - node.y0;
        if (w <= 0 || h <= 0) return null;
        if (node.depth === 1) {
          const key = node.data.key!;
          return (
            <div
              key={key}
              className="absolute border border-ta-grey-400"
              style={{ left: node.x0, top: node.y0, width: w, height: h }}
            >
              {w > 70 && (
                <span
                  className={cn(
                    "type-accent-s absolute left-1 top-0.5",
                    GROUP_STYLE[key].label,
                  )}
                >
                  {key} ~{formatTokens(sumTokens(node))}
                </span>
              )}
            </div>
          );
        }
        const leaf = node.data.leaf!;
        const style = GROUP_STYLE[leaf.group];
        return (
          <div
            key={leaf.id}
            className={cn("absolute cursor-default overflow-hidden transition-colors", style.block)}
            style={{ left: node.x0, top: node.y0, width: w, height: h }}
            onMouseEnter={() => onInspect(leaf)}
            title={`${leaf.label} ~${formatTokens(leaf.estTokens)} tok`}
          >
            {w > 56 && h > 26 && (
              <span className="type-accent-s block truncate px-1 pt-0.5 text-ta-sand-50">
                {leaf.label}
              </span>
            )}
            {w > 56 && h > 42 && (
              <span className="type-accent-s block px-1 text-ta-grey-100">
                {formatTokens(leaf.estTokens)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function sumTokens(node: HierarchyRectangularNode<TreemapNode>): number {
  return node
    .leaves()
    .reduce((acc, leaf) => acc + (leaf.data.leaf?.estTokens ?? 0), 0);
}
