import { useState, type ReactNode } from "react";
import { Hint } from "@/components/ui/hint";
import type { GlossaryTerm } from "@/lib/glossary";
import { cn } from "@/lib/utils";

interface SectionProps {
  title: string;
  /** Glossary entry explaining how to read this section. */
  hint?: GlossaryTerm;
  /** Compact facts shown next to the title. */
  meta?: ReactNode;
  /** Controls rendered on the right, always visible. */
  actions?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

/** Collapsible dashboard section with a consistent, uncrowded header. */
export function Section({ title, hint, meta, actions, defaultOpen = true, children }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-ta-grey-400">
      <div className="flex items-baseline gap-4 px-6 py-3">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="type-accent-m flex cursor-pointer items-baseline gap-2 text-ta-sand-50"
        >
          <span className={cn("text-ta-grey-200 transition-transform", !open && "-rotate-90")}>
            ▾
          </span>
          {title}
        </button>
        {hint && (
          <Hint
            term={hint}
            className="type-accent-s self-center border border-ta-grey-400 px-1.5 leading-4 text-ta-grey-200 no-underline hover:border-ta-sand-300 hover:text-ta-sand-50"
          >
            ?
          </Hint>
        )}
        {meta && <span className="type-accent-s min-w-0 truncate text-ta-grey-200">{meta}</span>}
        {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {open && children}
    </section>
  );
}
