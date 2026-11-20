import { Children, type ComponentProps, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { bundledLanguages, type BundledLanguage } from "shiki";
import type { Components } from "streamdown";
import { CodeBlock, CodeBlockActions, CodeBlockCopyButton, CodeBlockHeader, CodeBlockTitle } from "@/components/ai/code-block";
import { MessageResponse } from "@/components/ai/message";
import { cn } from "@/lib/utils";
import { GITHUB_PATTERN, parseGithubUrl } from "./github";
import { GithubLinkChip } from "./GithubChip";

const PLAIN = "text" as BundledLanguage;

function language(className: string | undefined): { id: BundledLanguage; label: string } {
  const name = /language-([\w+#-]+)/.exec(className ?? "")?.[1]?.toLowerCase();
  if (!name) return { id: PLAIN, label: "text" };
  return { id: name in bundledLanguages ? (name as BundledLanguage) : PLAIN, label: name };
}

function text(children: unknown): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(text).join("");
  return "";
}

function BlockCode(props: object) {
  const { className, children } = props as { className?: unknown; children?: unknown };
  const { id, label } = language(typeof className === "string" ? className : undefined);
  return (
    <CodeBlock code={text(children).replace(/\n$/, "")} language={id} className="my-4">
      <CodeBlockHeader className="h-8">
        <CodeBlockTitle className="ui-overline text-faint">{label}</CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton />
        </CodeBlockActions>
      </CodeBlockHeader>
    </CodeBlock>
  );
}

const LOCAL = "(?:localhost|127\\.0\\.0\\.1):\\d{1,5}(?:/[^\\s<>()]*)?";
const URL_PATTERN = `${GITHUB_PATTERN}|https?://[^\\s<>()]+|\\b${LOCAL}`;
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;

const OPENABLE = /^(https?:|mailto:|tel:)/;

const hrefOf = (url: string) => (/^https?:\/\//.test(url) ? url : `http://${url}`);

function Link({ href, className, children, ...props }: ComponentProps<"a">) {
  const github = href ? parseGithubUrl(href) : null;
  if (github) return <GithubLinkChip link={github} />;
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        event.preventDefault();
        if (href && OPENABLE.test(href)) openUrl(href).catch(() => undefined);
      }}
      className={cn("font-medium text-accent-text underline decoration-accent-text/35 underline-offset-2 transition-colors duration-(--duration-press) hover:decoration-accent-text", className)}
    >
      {children}
    </a>
  );
}

function linkify(children: ReactNode): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child !== "string") return child;
    const parts: ReactNode[] = [];
    let last = 0;
    for (const match of child.matchAll(new RegExp(URL_PATTERN, "g"))) {
      const url = match[0].replace(TRAILING_PUNCTUATION, "");
      parts.push(child.slice(last, match.index));
      parts.push(
        <Link key={match.index} href={hrefOf(url)}>
          {url}
        </Link>,
      );
      last = match.index + url.length;
    }
    parts.push(child.slice(last));
    return parts;
  });
}

const WHOLE_URL = new RegExp(`^(?:${URL_PATTERN})$`);

const COMPONENTS: Components = {
  pre: ({ children }) => <>{children}</>,
  code: BlockCode,
  inlineCode: ({ className, children, ...props }) => {
    const code = (
      <code className={cn("rounded-xs bg-raised px-1 py-px font-mono text-[0.875em] text-ink", className)} {...props}>
        {children}
      </code>
    );
    const url = text(children);
    return WHOLE_URL.test(url) ? <Link href={hrefOf(url)}>{code}</Link> : code;
  },
  a: (props) => <Link {...(props as ComponentProps<"a">)} />,
  p: ({ children, ...props }) => <p {...props}>{linkify(children)}</p>,
  li: ({ children, ...props }) => <li {...props}>{linkify(children)}</li>,
  strong: ({ className, children, ...props }) => (
    <strong className={cn("font-semibold text-ink", className)} {...props}>
      {linkify(children)}
    </strong>
  ),
  h1: ({ className, children, ...props }) => (
    <h1 className={cn("mt-6 text-heading font-semibold text-ink", className)} {...props}>
      {linkify(children)}
    </h1>
  ),
  h2: ({ className, children, ...props }) => (
    <h2 className={cn("mt-6 text-prose font-semibold text-ink", className)} {...props}>
      {linkify(children)}
    </h2>
  ),
  h3: ({ className, children, ...props }) => (
    <h3 className={cn("mt-5 text-prose font-medium text-muted", className)} {...props}>
      {linkify(children)}
    </h3>
  ),
  blockquote: ({ className, ...props }) => (
    <blockquote className={cn("border-l border-edge pl-4 text-muted", className)} {...props} />
  ),
  hr: ({ className, ...props }) => <hr className={cn("my-4 border-rule", className)} {...props} />,
  table: ({ className, ...props }) => (
    <div className="my-4 overflow-x-auto rounded-lg border border-edge">
      <table className={cn("w-full border-collapse text-body", className)} {...props} />
    </div>
  ),
  thead: ({ className, ...props }) => <thead className={cn("bg-raised", className)} {...props} />,
  th: ({ className, ...props }) => (
    <th className={cn("border-b border-edge px-3 py-2 text-left ui-overline text-muted", className)} {...props} />
  ),
  td: ({ className, children, ...props }) => (
    <td className={cn("border-b border-rule px-3 py-2 align-top", className)} {...props}>
      {linkify(children)}
    </td>
  ),
  tr: ({ className, ...props }) => <tr className={cn("last:[&>td]:border-b-0", className)} {...props} />,
};

export function Markdown({ children, streaming = false, className }: { children: string; streaming?: boolean; className?: string }) {
  return (
    <MessageResponse components={COMPONENTS} isAnimating={streaming} className={className}>
      {children}
    </MessageResponse>
  );
}
