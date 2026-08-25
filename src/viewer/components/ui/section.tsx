import { type ReactNode, useState } from "react";
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
  className?: string;
  children: ReactNode;
}

/** Collapsible dashboard section with a consistent, uncrowded header. */
export function Section({
  title,
  hint,
  meta,
  actions,
  defaultOpen = true,
  className,
  children,
}: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={cn("border-b border-ta-grey-400", className)}>
      <div className="flex min-h-13 items-center gap-4 px-6 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="type-accent-m flex cursor-pointer items-center gap-2 text-ta-sand-50"
        >
          <span className={cn("text-ta-grey-200 transition-transform", !open && "-rotate-90")}>
            ▾
          </span>
          {hint ? (
            // the title itself explains the section on hover
            <Hint term={hint} className="cursor-pointer no-underline">
              {title}
            </Hint>
          ) : (
            title
          )}
        </button>
        {meta && <span className="type-accent-s min-w-0 truncate text-ta-grey-200">{meta}</span>}
        {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {open && children}
    </section>
  );
}
