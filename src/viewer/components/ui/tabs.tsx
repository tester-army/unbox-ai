import { Tabs as BaseTabs } from "@base-ui-components/react/tabs";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

function Tabs(props: ComponentProps<typeof BaseTabs.Root>) {
  return <BaseTabs.Root {...props} />;
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
        "type-accent-s cursor-pointer px-3 py-1.5 text-ta-grey-200 transition-colors",
        "hover:text-ta-sand-50 data-[selected]:bg-ta-sand-50 data-[selected]:text-ta-grey-500",
        className,
      )}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger };
