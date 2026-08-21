import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Markdown rendered on DS tokens: mono headings, square code blocks, no shadows. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="type-body-m flex flex-col gap-3 text-ta-grey-100 [&_a]:text-ta-orange-75 [&_a]:underline">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (p) => <h3 className="type-accent-m mt-2 text-ta-sand-50" {...p} />,
          h2: (p) => <h3 className="type-accent-m mt-2 text-ta-sand-50" {...p} />,
          h3: (p) => <h4 className="type-accent-s mt-1 text-ta-sand-50" {...p} />,
          h4: (p) => <h4 className="type-accent-s mt-1 text-ta-sand-300" {...p} />,
          p: (p) => <p className="whitespace-pre-wrap" {...p} />,
          ul: (p) => <ul className="ml-5 list-disc marker:text-ta-grey-300" {...p} />,
          ol: (p) => <ol className="ml-5 list-decimal marker:text-ta-grey-300" {...p} />,
          li: (p) => <li className="my-0.5" {...p} />,
          strong: (p) => <strong className="font-semibold text-ta-sand-50" {...p} />,
          blockquote: (p) => (
            <blockquote className="border-l-2 border-ta-grey-400 pl-3 text-ta-grey-200" {...p} />
          ),
          code: (p) => (
            <code
              className="bg-ta-grey-450 px-1 font-(family-name:--font-dm-mono) text-[0.9em] text-ta-orange-75"
              {...p}
            />
          ),
          pre: (p) => (
            <pre
              className="overflow-x-auto border border-ta-grey-400 bg-ta-grey-450 p-3 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-ta-grey-100"
              {...p}
            />
          ),
          table: (p) => <table className="border-collapse" {...p} />,
          th: (p) => (
            <th className="border border-ta-grey-400 px-2 py-1 text-left text-ta-sand-50" {...p} />
          ),
          td: (p) => <td className="border border-ta-grey-450 px-2 py-1" {...p} />,
          hr: () => <hr className="border-ta-grey-400" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
