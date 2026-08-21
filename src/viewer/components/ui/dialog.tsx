import { Dialog as BaseDialog } from "@base-ui-components/react/dialog";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const Dialog = BaseDialog.Root;
const DialogClose = BaseDialog.Close;

function DialogContent({ className, children, ...props }: ComponentProps<typeof BaseDialog.Popup>) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className="fixed inset-0 z-40 bg-black/50" />
      <BaseDialog.Popup
        className={cn(
          "fixed left-1/2 top-1/2 z-50 flex max-h-[80vh] w-[min(56rem,90vw)] -translate-x-1/2 -translate-y-1/2 flex-col border border-ta-grey-400 bg-ta-grey-500",
          className,
        )}
        {...props}
      >
        {children}
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  );
}

function DialogTitle({ className, ...props }: ComponentProps<typeof BaseDialog.Title>) {
  return <BaseDialog.Title className={cn("type-accent-m text-ta-sand-50", className)} {...props} />;
}

export { Dialog, DialogClose, DialogContent, DialogTitle };
