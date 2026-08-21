import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Minimal DS-styled button: square corners, mono uppercase label. */
function Button({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      className={cn(
        "type-accent-s cursor-pointer border border-ta-grey-400 px-2 py-1 text-ta-grey-100",
        "transition-colors hover:border-ta-sand-300 hover:text-ta-sand-50",
        className,
      )}
      {...props}
    />
  );
}

export { Button };
