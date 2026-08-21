import { Tabs as BaseTabs } from "@base-ui-components/react/tabs";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface TabsProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  children: ReactNode;
}

/** Typed Tabs root: callers get their union type back without casting. */
function Tabs<T extends string>({ value, onValueChange, children }: TabsProps<T>) {
  return (
    <BaseTabs.Root value={value} onValueChange={(next) => onValueChange(next as T)}>
      {children}
    </BaseTabs.Root>
  );
}

function TabsList({ className, ...props }: ComponentProps<typeof BaseTabs.List>) {
  return (
    <BaseTabs.List
      className={cn("inline-flex border border-ta-grey-400", className)}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: ComponentProps<typeof BaseTabs.Tab>) {
  return (
    <BaseTabs.Tab
      className={cn(
        // h-7 minus the list's 1px borders keeps tab groups exactly as tall as buttons
        "type-accent-s inline-flex h-[calc(--spacing(7)-2px)] cursor-pointer items-center px-3 text-ta-grey-200 transition-colors",
        "hover:text-ta-sand-50 data-[selected]:bg-ta-sand-50 data-[selected]:text-ta-grey-500",
        className,
      )}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger };
