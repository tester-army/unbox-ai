import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Minimal DS-styled button: square corners, mono uppercase label.
 * Every control in the app is CONTROL_H tall - buttons, tab triggers alike.
 */
function Button({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "type-accent-s inline-flex h-7 cursor-pointer items-center border border-ta-grey-400 px-3 text-ta-grey-100",
        "transition-colors hover:border-ta-sand-300 hover:text-ta-sand-50",
        "disabled:cursor-default disabled:opacity-40 disabled:hover:border-ta-grey-400 disabled:hover:text-ta-grey-100",
        className,
      )}
      {...props}
    />
  );
}

export { Button };
