import { cloneElement, isValidElement, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

import { highlightText } from "./utils";

/** 在段落边界截断，避免切在加粗或表格中间。 */
export function clipMarkdown(text: string, max: number) {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const para = slice.lastIndexOf("\n\n");
  const line = slice.lastIndexOf("\n");
  const cut = para > max * 0.5 ? para : line > max * 0.5 ? line : max;
  return `${slice.slice(0, cut).trimEnd()}\n\n…`;
}

function highlightNodes(node: ReactNode, query?: string): ReactNode {
  if (!query) return node;
  if (typeof node === "string") return highlightText(node, query);
  if (Array.isArray(node)) {
    return node.map((child, i) => (
      <span key={i}>{highlightNodes(child, query)}</span>
    ));
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return cloneElement(
      node,
      undefined,
      highlightNodes(node.props.children, query),
    );
  }
  return node;
}

function markdownComponents(query?: string): Components {
  const hi = (children: ReactNode) => highlightNodes(children, query);
  return {
    p: ({ children }) => (
      <p className="my-1.5 leading-6 first:mt-0 last:mb-0">{hi(children)}</p>
    ),
    h1: ({ children }) => (
      <h3 className="mt-3 mb-1.5 text-base font-semibold first:mt-0">{hi(children)}</h3>
    ),
    h2: ({ children }) => (
      <h3 className="mt-3 mb-1.5 border-b border-edge-strong pb-1 text-sm font-semibold text-foreground first:mt-0">
        {hi(children)}
      </h3>
    ),
    h3: ({ children }) => (
      <h4 className="mt-2.5 mb-1 text-sm font-semibold first:mt-0">{hi(children)}</h4>
    ),
    ul: ({ children }) => (
      <ul className="my-1.5 list-disc space-y-0.5 pl-4 marker:text-muted-foreground">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="my-1.5 list-decimal space-y-0.5 pl-4 marker:text-muted-foreground">{children}</ol>
    ),
    li: ({ children }) => <li className="leading-6">{hi(children)}</li>,
    strong: ({ children }) => <strong className="font-semibold">{hi(children)}</strong>,
    em: ({ children }) => <em>{hi(children)}</em>,
    hr: () => <hr className="my-3 border-edge" />,
    a: ({ href, children }) =>
      href && /^https?:\/\//i.test(href) ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="text-primary underline decoration-primary/40 underline-offset-2"
        >
          {hi(children)}
        </a>
      ) : (
        <span>{hi(children)}</span>
      ),
    code: ({ className, children }) =>
      className ? (
        <code className="font-mono text-[0.85em]">{children}</code>
      ) : (
        <code className="rounded bg-background px-1 py-px font-mono text-[0.85em] font-medium text-foreground">
          {hi(children)}
        </code>
      ),
    pre: ({ children }) => (
      <pre className="my-2 overflow-auto rounded-lg bg-background/80 p-2.5 text-xs leading-5">
        {children}
      </pre>
    ),
    table: ({ children }) => (
      <div className="my-2 overflow-x-auto rounded-lg border border-edge-strong bg-background">
        <table className="w-full border-collapse text-sm text-foreground [&_td:first-child]:font-mono [&_td:first-child]:whitespace-nowrap">
          {children}
        </table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-muted">{children}</thead>,
    tr: ({ children }) => (
      <tr className="border-t border-edge-strong first:border-t-0">{children}</tr>
    ),
    th: ({ children }) => (
      <th className="px-2.5 py-1.5 text-left font-medium text-foreground">{hi(children)}</th>
    ),
    td: ({ children }) => (
      <td className="px-2.5 py-1.5 align-top leading-5 text-foreground">{hi(children)}</td>
    ),
    blockquote: ({ children }) => (
      <blockquote className="my-2 border-l-2 border-primary/40 pl-3 text-muted-foreground">
        {children}
      </blockquote>
    ),
  };
}

export function MarkdownText({
  text,
  query,
}: {
  text: string;
  query?: string;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      components={markdownComponents(query)}
    >
      {text}
    </ReactMarkdown>
  );
}
