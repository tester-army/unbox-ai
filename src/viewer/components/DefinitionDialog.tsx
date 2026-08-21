import { useEffect, useState } from "react";
import { contentToText } from "@core/normalize";
import type { RawMessage, RawToolDef } from "@core/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { prettyArgs, prettyPayload } from "@/lib/pretty";
import type { TreemapLeaf } from "@/lib/treemap-data";

/** Full definition of a clicked treemap block: pretty-rendered, raw JSON a toggle away. */
export function DefinitionDialog({ leaf, onClose }: { leaf: TreemapLeaf; onClose: () => void }) {
  const [value, setValue] = useState<unknown>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setValue(undefined);
    setError(null);
    fetchRawValue(leaf.ref)
      .then((v) => !cancelled && setValue(v))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [leaf.ref]);

  const isTool = leaf.ref.includes("available_tools");
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <div className="flex items-baseline gap-4 border-b border-ta-grey-400 px-4 py-3">
          <DialogTitle>{leaf.label}</DialogTitle>
          <span className="type-accent-s text-ta-grey-200">{leaf.ref}</span>
          <Button className="ml-auto border-none" onClick={() => setShowRaw((v) => !v)}>
            {showRaw ? "pretty" : "json"}
          </Button>
          <DialogClose render={<Button className="border-none">close</Button>} />
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          {error ? (
            <p className="type-body-s text-ta-error">{error}</p>
          ) : value === undefined ? (
            <p className="type-accent-s text-ta-grey-200">loading...</p>
          ) : showRaw ? (
            <Mono>{JSON.stringify(value, null, 2)}</Mono>
          ) : isTool ? (
            <ToolDefinition tool={value as RawToolDef} />
          ) : (
            <MessageDefinition message={value as RawMessage} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface SchemaProperty {
  type?: string;
  description?: string;
  enum?: unknown[];
}

function ToolDefinition({ tool }: { tool: RawToolDef }) {
  const schema = tool.inputSchema as
    | { properties?: Record<string, SchemaProperty>; required?: string[] }
    | undefined;
  const properties = Object.entries(schema?.properties ?? {});
  const required = new Set(schema?.required ?? []);
  return (
    <div className="flex flex-col gap-4">
      {tool.description && (
        <p className="type-body-s whitespace-pre-wrap text-ta-grey-100">{tool.description}</p>
      )}
      {properties.length > 0 ? (
        <div>
          <p className="type-accent-s mb-1 text-ta-grey-200">parameters</p>
          <div className="border border-ta-grey-400">
            {properties.map(([name, prop]) => (
              <div
                key={name}
                className="grid grid-cols-[minmax(8rem,14rem)_6rem_1fr] gap-x-4 border-b border-ta-grey-450 px-3 py-1.5 last:border-b-0"
              >
                <span className="type-accent-s truncate text-ta-sand-50">
                  {name}
                  {required.has(name) && <span className="text-ta-orange-300">*</span>}
                </span>
                <span className="type-accent-s text-ta-grey-200">
                  {prop.enum ? prop.enum.map(String).join(" | ") : (prop.type ?? "-")}
                </span>
                <span className="type-body-s text-ta-grey-100">{prop.description ?? ""}</span>
              </div>
            ))}
          </div>
          <p className="type-accent-s mt-1 text-ta-grey-200">
            <span className="text-ta-orange-300">*</span> required
          </p>
        </div>
      ) : (
        <p className="type-accent-s text-ta-grey-200">no parameters</p>
      )}
    </div>
  );
}

function MessageDefinition({ message }: { message: RawMessage }) {
  const text = prettyPayload(contentToText(message.content));
  return (
    <div className="flex flex-col gap-3">
      {text && <p className="type-body-s whitespace-pre-wrap text-ta-grey-100">{text}</p>}
      {message.tool_calls?.map((call) => (
        <div key={call.id} className="border-l-2 border-ta-orange-300 bg-ta-grey-450 px-3 py-2">
          <p className="type-accent-s text-ta-orange-75">{call.function.name}</p>
          <Mono>{prettyArgs(call.function.arguments)}</Mono>
        </div>
      ))}
      {!text && !message.tool_calls?.length && (
        <p className="type-accent-s text-ta-grey-200">(empty message)</p>
      )}
    </div>
  );
}

function Mono({ children }: { children: string }) {
  return (
    <pre className="type-body-s overflow-x-auto whitespace-pre-wrap font-(family-name:--font-dm-mono) text-ta-grey-100">
      {children}
    </pre>
  );
}

/** Fetches a raw-trace value, failing legibly when the server is older than the viewer. */
async function fetchRawValue(ref: string): Promise<unknown> {
  const res = await fetch(`/api/raw?path=${encodeURIComponent(ref)}`);
  if (!res.headers.get("content-type")?.includes("application/json")) {
    throw new Error("this unbox-ai server is older than the viewer - restart it and reload");
  }
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body.value;
}
