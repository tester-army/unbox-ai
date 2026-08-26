import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

interface CopyButtonProps {
  /** Text to copy, or a producer so large strings aren't built until needed. */
  text: string | (() => string);
  /** Idle label; the confirmation always reads "copied". */
  label?: string;
  title?: string;
  className?: string;
}

/** Copies text to the clipboard with a brief "copied" confirmation. */
export function CopyButton({ text, label = "copy", title, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <Button
      className={className}
      title={title}
      onClick={async (e) => {
        e.stopPropagation();
        const value = typeof text === "function" ? text() : text;
        try {
          await navigator.clipboard.writeText(value);
        } catch {
          // clipboard API needs permissions/activation; fall back to execCommand
          const area = document.createElement("textarea");
          area.value = value;
          area.style.position = "fixed";
          area.style.opacity = "0";
          document.body.appendChild(area);
          area.select();
          document.execCommand("copy");
          area.remove();
        }
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? "copied" : label}
    </Button>
  );
}
