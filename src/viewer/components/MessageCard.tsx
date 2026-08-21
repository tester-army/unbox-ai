import { useState } from "react";
import type { Message, MessageRole } from "@core/types";
import { formatTokens } from "@core/format";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const COLLAPSED_CHARS = 700;

const ROLE_STYLE: Record<MessageRole, string> = {
  system: "text-ta-sand-300",
  user: "text-ta-orange-75",
  assistant: "text-ta-sand-50",
  "tool-result": "text-ta-grey-200",
};

export function MessageCard({ message }: { message: Message }) {
  const [expanded, setExpanded] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const overflows = message.text.length > COLLAPSED_CHARS;
  const text = expanded ? message.text : message.text.slice(0, COLLAPSED_CHARS);

  return (
    <article className="border border-ta-grey-400 bg-ta-grey-450">
      <div className="flex items-baseline gap-3 border-b border-ta-grey-400 px-3 py-1.5">
        <span className={cn("type-accent-s", ROLE_STYLE[message.role])}>{message.role}</span>
        <span className="type-accent-s text-ta-grey-200">
          #{message.index} · ~{formatTokens(message.estTokens)} tok
        </span>
        <Button className="ml-auto border-none" onClick={() => setShowRaw((v) => !v)}>
          {showRaw ? "pretty" : "json"}
        </Button>
      </div>
      <div className="px-3 py-2">
        {showRaw ? (
          <pre className="type-body-s overflow-x-auto whitespace-pre-wrap font-(family-name:--font-dm-mono) text-ta-grey-100">
            {JSON.stringify(message, null, 2)}
          </pre>
        ) : (
          <>
            {message.text && (
              <p className="type-body-s whitespace-pre-wrap text-ta-grey-100">
                {text}
                {overflows && !expanded && <span className="text-ta-grey-200"> ...</span>}
              </p>
            )}
            {overflows && (
              <Button className="mt-2" onClick={() => setExpanded((v) => !v)}>
                {expanded ? "collapse" : `show all ${formatTokens(message.text.length)} chars`}
              </Button>
            )}
            {message.toolCalls?.map((call) => (
              <ToolCall key={call.id} name={call.name} args={call.args} result={call.result} />
            ))}
          </>
        )}
      </div>
    </article>
  );
}

function ToolCall({ name, args, result }: { name: string; args: unknown; result?: string }) {
  const [open, setOpen] = useState(false);
  const short = result !== undefined && result.length <= 240;
  return (
    <div className="mt-2 border-l-2 border-ta-orange-300 bg-ta-grey-500 px-3 py-2">
      <p className="type-accent-s text-ta-orange-75">
        {name}
        <span className="normal-case text-ta-grey-100"> {JSON.stringify(args)}</span>
      </p>
      {result !== undefined &&
        (short || open ? (
          <p className="type-body-s mt-1 whitespace-pre-wrap text-ta-grey-200">{result}</p>
        ) : (
          <Button className="mt-1" onClick={() => setOpen(true)}>
            show result ({formatTokens(result.length)} chars)
          </Button>
        ))}
    </div>
  );
}
