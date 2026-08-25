import { useState } from "react";
import type { Message, MessageRole } from "@core/types";
import { formatCompact, formatTokens } from "@core/format";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { prettyArgs, prettyPayload } from "@core/pretty";
import { cn } from "@/lib/utils";

const COLLAPSED_CHARS = 700;
const RESULT_PREVIEW_CHARS = 240;

const ROLE_STYLE: Record<MessageRole, string> = {
  system: "text-ta-sand-300",
  user: "text-ta-orange-75",
  assistant: "text-ta-sand-50",
  "tool-result": "text-ta-grey-200",
  unknown: "text-ta-grey-200",
};

export function MessageCard({ message }: { message: Message }) {
  const [expanded, setExpanded] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const overflows = message.text.length > COLLAPSED_CHARS;
  const text = expanded ? message.text : message.text.slice(0, COLLAPSED_CHARS);

  return (
    <article className="border border-ta-grey-400 bg-ta-grey-450">
      <div className="flex items-center gap-3 border-b border-ta-grey-400 px-3 py-1">
        <span className={cn("type-accent-s", ROLE_STYLE[message.role])}>{message.role}</span>
        <span className="type-accent-s text-ta-grey-200">
          #{message.index} · ~{formatTokens(message.approxTokens)} tok
        </span>
        <CopyButton
          className="ml-auto border-none"
          text={() => (showRaw ? JSON.stringify(message, null, 2) : message.text)}
        />
        <Button className="border-none" onClick={() => setShowRaw((v) => !v)}>
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
            {message.reasoning !== undefined && <Thinking reasoning={message.reasoning} />}
            {message.text && (
              <p className="type-body-s whitespace-pre-wrap text-ta-grey-100">
                {text}
                {overflows && !expanded && <span className="text-ta-grey-200"> ...</span>}
              </p>
            )}
            {overflows && (
              <Button className="mt-2" onClick={() => setExpanded((v) => !v)}>
                {expanded ? "collapse" : `show all ${formatCompact(message.text.length)} chars`}
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

const THINKING_PREVIEW_CHARS = 160;

/** Collapsed reasoning content; providers that withhold it still leave a trace. */
function Thinking({ reasoning }: { reasoning: string }) {
  const [open, setOpen] = useState(false);
  if (!reasoning) {
    return (
      <p className="type-accent-s mb-2 text-ta-grey-200">
        thinking · content withheld by provider
      </p>
    );
  }
  const overflows = reasoning.length > THINKING_PREVIEW_CHARS;
  return (
    <div className="mb-2 border border-ta-grey-400 bg-ta-grey-500 px-3 py-2">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="type-accent-s flex w-full cursor-pointer items-center gap-2 text-left text-ta-sand-300"
      >
        <span>{open ? "▾" : "▸"} thinking</span>
        <span className="text-ta-grey-200">~{formatTokens(Math.round(reasoning.length / 4))} tok</span>
      </button>
      <p
        className={cn(
          "type-body-s mt-1 whitespace-pre-wrap italic text-ta-grey-200",
          !open && "truncate",
        )}
      >
        {open ? reasoning : reasoning.slice(0, THINKING_PREVIEW_CHARS)}
        {!open && overflows && " ..."}
      </p>
    </div>
  );
}

function ToolCall({ name, args, result }: { name: string; args: unknown; result?: string }) {
  const [open, setOpen] = useState(false);
  const pretty = result !== undefined ? prettyPayload(result) : undefined;
  const short = pretty !== undefined && pretty.length <= RESULT_PREVIEW_CHARS;
  return (
    <div className="mt-2 border border-ta-grey-400 bg-ta-grey-500 px-3 py-2">
      <div className="flex items-center gap-2">
        <p className="type-accent-s text-ta-orange-75">{name}</p>
        <CopyButton className="ml-auto border-none" text={() => prettyArgs(args)} />
      </div>
      <pre className="type-body-s overflow-x-auto whitespace-pre-wrap font-(family-name:--font-dm-mono) text-ta-grey-100">
        {prettyArgs(args)}
      </pre>
      {pretty !== undefined && (
        <>
          {(short || open) && (
            <pre className="type-body-s mt-1 max-h-96 overflow-y-auto whitespace-pre-wrap border-t border-ta-grey-450 pt-1 font-(family-name:--font-dm-mono) leading-relaxed text-ta-grey-200">
              {pretty}
            </pre>
          )}
          <div className="mt-2 flex gap-2">
            {!short && (
              <Button onClick={() => setOpen((v) => !v)}>
                {open ? "hide result" : `show result (${formatCompact(pretty.length)} chars)`}
              </Button>
            )}
            {(short || open) && <CopyButton text={pretty} />}
          </div>
        </>
      )}
    </div>
  );
}
