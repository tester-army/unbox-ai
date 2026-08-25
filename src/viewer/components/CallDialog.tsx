import { formatMs } from "@core/format";
import { prettyArgs, prettyPayload } from "@core/pretty";
import type { PairedToolCall } from "@core/types";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";

interface CallDialogProps {
  call: PairedToolCall;
  gen: number;
  onClose: () => void;
}

/** A tool call's full input and output in a modal. */
export function CallDialog({ call, gen, onClose }: CallDialogProps) {
  const [showRaw, setShowRaw] = useState(false);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <div className="flex items-center gap-4 border-b border-ta-grey-400 px-6 py-3">
          <DialogTitle>{call.name}</DialogTitle>
          <span className="type-accent-s text-ta-grey-200">
            generation {gen}
            {call.durationMs !== undefined && ` · ${formatMs(call.durationMs)}`}
            {call.success === false && " · "}
            {call.success === false && <span className="text-ta-error">failed</span>}
          </span>
          <Button className="ml-auto border-none" onClick={() => setShowRaw((v) => !v)}>
            {showRaw ? "pretty" : "json"}
          </Button>
          <DialogClose render={<Button className="border-none">close</Button>} />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
          {showRaw ? (
            <div>
              <div className="mb-2 flex items-center justify-end">
                <CopyButton className="border-none" text={() => JSON.stringify(call, null, 2)} />
              </div>
              <Mono>{JSON.stringify(call, null, 2)}</Mono>
            </div>
          ) : (
            <>
              <div>
                <div className="mb-2 flex items-center gap-3">
                  <p className="type-accent-s text-ta-grey-200">input</p>
                  <CopyButton className="ml-auto border-none" text={() => prettyArgs(call.args)} />
                </div>
                <Mono>{prettyArgs(call.args)}</Mono>
              </div>
              <div>
                <div className="mb-2 flex items-center gap-3">
                  <p className="type-accent-s text-ta-grey-200">output</p>
                  {call.result !== undefined && (
                    <CopyButton
                      className="ml-auto border-none"
                      text={() => prettyPayload(call.result!)}
                    />
                  )}
                </div>
                {call.result !== undefined ? (
                  <Mono>{prettyPayload(call.result)}</Mono>
                ) : (
                  <p className="type-accent-s text-ta-grey-300">no result recorded in the trace</p>
                )}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Mono({ children }: { children: string }) {
  return (
    <pre className="type-body-s overflow-x-auto whitespace-pre-wrap border border-ta-grey-400 bg-ta-grey-450 p-3 font-(family-name:--font-dm-mono) leading-relaxed text-ta-grey-100">
      {children}
    </pre>
  );
}
