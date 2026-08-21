import { Tooltip } from "@base-ui-components/react/tooltip";
import type { ReactNode } from "react";
import { GLOSSARY, type GlossaryTerm } from "@/lib/glossary";
import { cn } from "@/lib/utils";

interface HintProps {
  term: GlossaryTerm;
  /** Visible text; defaults to the term itself. */
  children?: ReactNode;
  className?: string;
}

/** A nuanced term with a plain-language explanation on hover. */
export function Hint({ term, children, className }: HintProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={
          <span
            className={cn(
              "cursor-help underline decoration-ta-grey-300 decoration-dotted underline-offset-3",
              className,
            )}
          >
            {children ?? term}
          </span>
        }
      />
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={6}>
          <Tooltip.Popup className="type-body-s z-10 max-w-72 border border-ta-grey-400 bg-ta-grey-500 px-3 py-2 normal-case tracking-normal text-ta-grey-100">
            {GLOSSARY[term]}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
