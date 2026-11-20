import { Check, Copy } from "lucide-react";
import { motion } from "motion/react";
import { createContext, memo, useContext, useEffect, useRef, useState, type ComponentProps, type CSSProperties, type HTMLAttributes } from "react";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { createHighlighter, type BundledLanguage, type BundledTheme, type HighlighterGeneric, type ThemedToken } from "shiki";
import { Button } from "@/components/ui/button";
import { duration, ease } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { FACTORY_DARK, FACTORY_LIGHT, SYNTAX_THEMES } from "./syntax-theme";

const THEMES = SYNTAX_THEMES;

const FONT_STYLE = { italic: 1, bold: 2, underline: 4 };

type Highlighter = HighlighterGeneric<BundledLanguage, BundledTheme>;

const highlighters = new Map<BundledLanguage, Promise<Highlighter>>();

function highlighter(language: BundledLanguage) {
  const cached = highlighters.get(language);
  if (cached) return cached;
  const created = createHighlighter({ langs: [language], themes: [FACTORY_LIGHT, FACTORY_DARK], engine: createJavaScriptRegexEngine() });
  highlighters.set(language, created);
  return created;
}

const tokenCache = new Map<string, ThemedToken[][]>();

const cacheKey = (code: string, language: BundledLanguage) => `${language}\u0000${code}`;

const plainTokens = (code: string): ThemedToken[][] =>
  code.split("\n").map((line) => (line === "" ? [] : [{ content: line, offset: 0 } as ThemedToken]));

export async function highlightCode(code: string, language: BundledLanguage) {
  const key = cacheKey(code, language);
  const cached = tokenCache.get(key);
  if (cached) return cached;
  const { tokens } = (await highlighter(language)).codeToTokens(code, { lang: language, themes: THEMES });
  tokenCache.set(key, tokens);
  return tokens;
}

function useTokens(code: string, language: BundledLanguage) {
  const [result, setResult] = useState<{ key: string; tokens: ThemedToken[][] } | null>(null);
  const key = cacheKey(code, language);
  useEffect(() => {
    let current = true;
    void highlightCode(code, language).then((tokens) => current && setResult({ key, tokens }));
    return () => {
      current = false;
    };
  }, [code, language, key]);
  return tokenCache.get(key) ?? (result?.key === key ? result.tokens : plainTokens(code));
}

function tokenStyle(token: ThemedToken): CSSProperties {
  const style = token.fontStyle ?? 0;
  return {
    color: token.color,
    fontStyle: style & FONT_STYLE.italic ? "italic" : undefined,
    fontWeight: style & FONT_STYLE.bold ? "bold" : undefined,
    textDecoration: style & FONT_STYLE.underline ? "underline" : undefined,
    ...(token.htmlStyle as CSSProperties | undefined),
  };
}

const LINE_NUMBERS =
  "before:mr-4 before:inline-block before:w-6 before:select-none before:text-right before:text-faint before:content-[counter(line)] before:[counter-increment:line]";

const CodeBlockBody = memo(function CodeBlockBody({ code, language, showLineNumbers }: { code: string; language: BundledLanguage; showLineNumbers: boolean }) {
  const lines = useTokens(code, language);
  return (
    <pre className="m-0 overflow-auto px-3 py-3 text-label leading-5">
      <code className={cn("font-mono", showLineNumbers && "[counter-reset:line]")}>
        {lines.map((line, lineIndex) => (
          <span key={lineIndex} className={cn("block", showLineNumbers && LINE_NUMBERS)}>
            {line.length === 0
              ? "\n"
              : line.map((token, tokenIndex) => (
                  <span key={tokenIndex} className="dark:text-(--shiki-dark)!" style={tokenStyle(token)}>
                    {token.content}
                  </span>
                ))}
          </span>
        ))}
      </code>
    </pre>
  );
});

const CodeBlockContext = createContext("");

type CodeBlockProps = HTMLAttributes<HTMLDivElement> & {
  code: string;
  language: BundledLanguage;
  showLineNumbers?: boolean;
};

export function CodeBlock({ code, language, showLineNumbers = false, className, children, ...props }: CodeBlockProps) {
  return (
    <CodeBlockContext.Provider value={code}>
      <div
        data-language={language}
        className={cn("group/code relative w-full overflow-hidden rounded-md border border-edge bg-raised text-ink", className)}
        style={{ containIntrinsicSize: "auto 160px", contentVisibility: "auto" }}
        {...props}
      >
        {children}
        <CodeBlockBody code={code} language={language} showLineNumbers={showLineNumbers} />
      </div>
    </CodeBlockContext.Provider>
  );
}

export function CodeBlockHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex h-9 items-center justify-between gap-2 border-b border-edge px-3 text-label text-muted", className)} {...props} />;
}

export function CodeBlockTitle({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex min-w-0 items-center gap-2", className)} {...props} />;
}

export function CodeBlockFilename({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("truncate font-mono", className)} {...props} />;
}

export function CodeBlockActions({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("-mr-1.5 flex items-center gap-1", className)} {...props} />;
}

type CopyButtonProps = ComponentProps<typeof Button> & { onCopy?: () => void; onError?: (error: Error) => void; timeout?: number };

export function CopyButton({ text, label, onCopy, onError, timeout = 2000, children, ...props }: CopyButtonProps & { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      onError?.(error as Error);
      return;
    }
    setCopied(true);
    onCopy?.();
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), timeout);
  }

  const Icon = copied ? Check : Copy;
  return (
    <Button aria-label={copied ? "Copied" : label} variant="ghost" size="icon-xs" onClick={copy} {...props}>
      {children ?? (
        <motion.span
          key={copied ? "copied" : "copy"}
          initial={copied ? { opacity: 0, scale: 0.8 } : false}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: duration.press, ease: ease.out }}
          className="inline-flex"
        >
          <Icon />
        </motion.span>
      )}
    </Button>
  );
}

export function CodeBlockCopyButton(props: CopyButtonProps) {
  return <CopyButton text={useContext(CodeBlockContext)} label="Copy code" {...props} />;
}
