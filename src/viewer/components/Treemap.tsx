import { hierarchy, treemap, treemapSquarify, type HierarchyRectangularNode } from "d3-hierarchy";
import { useMemo } from "react";
import type { BreakdownGroupKey } from "@core/types";
import { formatTokens } from "@core/format";
import type { TreemapGroupData, TreemapLeaf } from "@/lib/treemap-data";
import { useElementSize } from "@/lib/use-element-size";
import { cn } from "@/lib/utils";

const GROUP_HEADER = 20;
const HEIGHT = 380;

const GROUP_STYLE: Record<
  BreakdownGroupKey,
  { block: string; cachedBlock: string; label: string }
> = {
  system: {
    block: "bg-ta-sand-300/40 hover:bg-ta-sand-300/55",
    cachedBlock: "bg-ta-sand-300/10 hover:bg-ta-sand-300/25",
    label: "text-ta-sand-300",
  },
  tools: {
    block: "bg-ta-orange-300/35 hover:bg-ta-orange-300/50",
    cachedBlock: "bg-ta-orange-300/8 hover:bg-ta-orange-300/20",
    label: "text-ta-orange-75",
  },
  conversation: {
    block: "bg-ta-grey-300/40 hover:bg-ta-grey-300/55",
    cachedBlock: "bg-ta-grey-300/10 hover:bg-ta-grey-300/25",
    label: "text-ta-grey-100",
  },
};

type TreemapNode =
  | { children: TreemapNode[] }
  | { group: TreemapGroupData; children: TreemapNode[] }
  | { leaf: TreemapLeaf };

interface TreemapProps {
  groups: TreemapGroupData[];
  onInspect: (leafId: string | null) => void;
  onOpen: (leafId: string) => void;
}

/** Squarified treemap rendered as plain divs - square corners, borders for depth. */
export function Treemap({ groups, onInspect, onOpen }: TreemapProps) {
  const { ref, width } = useElementSize<HTMLDivElement>();

  const laidOut = useMemo(() => {
    if (width === 0) return null;
    const root = hierarchy<TreemapNode>(
      {
        children: groups.map((group) => ({
          group,
          children: group.leaves.map((leaf) => ({ leaf })),
        })),
      },
      (node) => ("children" in node ? node.children : undefined),
    )
      .sum((node) => ("leaf" in node ? node.leaf.value : 0))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    return treemap<TreemapNode>()
      .tile(treemapSquarify)
      .size([width, HEIGHT])
      .paddingInner(2)
      .paddingTop((node) => (node.depth === 1 ? GROUP_HEADER : 0))(root);
  }, [groups, width]);

  return (
    <div
      ref={ref}
      className="relative w-full border border-ta-grey-400 bg-ta-grey-450"
      style={{ height: HEIGHT }}
      onMouseLeave={() => onInspect(null)}
    >
      {laidOut?.children?.map((groupNode) => {
        const data = groupNode.data;
        if (!("group" in data)) return null;
        return (
          <GroupBlock key={data.group.key} node={groupNode} group={data.group}>
            {groupNode.children?.map((leafNode) => {
              const leafData = leafNode.data;
              if (!("leaf" in leafData)) return null;
              return (
                <LeafBlock
                  key={leafData.leaf.id}
                  node={leafNode}
                  leaf={leafData.leaf}
                  onInspect={onInspect}
                  onOpen={onOpen}
                />
              );
            })}
          </GroupBlock>
        );
      })}
    </div>
  );
}

interface GroupBlockProps {
  node: HierarchyRectangularNode<TreemapNode>;
  group: TreemapGroupData;
  children: React.ReactNode;
}

function GroupBlock({ node, group, children }: GroupBlockProps) {
  const width = node.x1 - node.x0;
  if (width <= 0 || node.y1 - node.y0 <= 0) return null;
  return (
    <>
      <div
        className="absolute border border-ta-grey-400"
        style={{ left: node.x0, top: node.y0, width, height: node.y1 - node.y0 }}
      >
        {width > 70 && (
          <span className={cn("type-accent-s absolute left-1 top-0.5", GROUP_STYLE[group.key].label)}>
            {group.key} ~{formatTokens(group.estTokens)}
          </span>
        )}
      </div>
      {children}
    </>
  );
}

interface LeafBlockProps {
  node: HierarchyRectangularNode<TreemapNode>;
  leaf: TreemapLeaf;
  onInspect: (leafId: string) => void;
  onOpen: (leafId: string) => void;
}

function LeafBlock({ node, leaf, onInspect, onOpen }: LeafBlockProps) {
  const width = node.x1 - node.x0;
  const height = node.y1 - node.y0;
  if (width <= 0 || height <= 0) return null;
  const style = GROUP_STYLE[leaf.group];
  return (
    <button
      className={cn(
        "absolute cursor-pointer overflow-hidden text-left transition-colors",
        leaf.cached ? style.cachedBlock : style.block,
      )}
      style={{ left: node.x0, top: node.y0, width, height }}
      onMouseEnter={() => onInspect(leaf.id)}
      onClick={() => onOpen(leaf.id)}
      title={`${leaf.label} ~${formatTokens(leaf.estTokens)} tok${
        leaf.cached === undefined ? "" : leaf.cached ? " (cached prefix)" : " (fresh)"
      }`}
    >
      {width > 56 && height > 26 && (
        <span
          className={cn(
            "type-accent-s block truncate px-1 pt-0.5",
            leaf.cached ? "text-ta-grey-200" : "text-ta-sand-50",
          )}
        >
          {leaf.label}
        </span>
      )}
      {width > 56 && height > 42 && (
        <span className="type-accent-s block px-1 text-ta-grey-100">
          {formatTokens(leaf.estTokens)}
        </span>
      )}
    </button>
  );
}
