import { createContext, useContext, type ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";

export type ContextUsage = { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number };

type ContextValue = { usedTokens: number; maxTokens: number; usage?: ContextUsage };

const UsageContext = createContext<ContextValue>({ usedTokens: 0, maxTokens: 1 });

const percent = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, style: "percent" });
const compact = new Intl.NumberFormat("en-US", { notation: "compact" });

const RADIUS = 9;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function Context({ usedTokens, maxTokens, usage, ...props }: ComponentProps<typeof HoverCard> & ContextValue) {
  return (
    <UsageContext.Provider value={{ usedTokens, maxTokens, usage }}>
      <HoverCard {...props} />
    </UsageContext.Provider>
  );
}

function ratio({ usedTokens, maxTokens }: ContextValue) {
  return Math.min(usedTokens / maxTokens, 1);
}

export function ContextRing({ className }: { className?: string }) {
  const used = ratio(useContext(UsageContext));
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={cn("size-4 -rotate-90", className)}>
      <circle cx="12" cy="12" r={RADIUS} fill="none" stroke="currentColor" strokeWidth="2.5" opacity="0.2" />
      <circle
        cx="12"
        cy="12"
        r={RADIUS}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={CIRCUMFERENCE * (1 - used)}
        className="transition-[stroke-dashoffset] duration-(--duration-panel) ease-out"
      />
    </svg>
  );
}

export function ContextTrigger({ className, ...props }: ComponentProps<typeof Button>) {
  const value = useContext(UsageContext);
  return (
    <HoverCardTrigger
      delay={0}
      closeDelay={0}
      render={<Button variant="ghost" size="sm" aria-label={`Model context usage, ${percent.format(ratio(value))}`} className={cn("gap-1.5 text-muted", className)} {...props} />}
    >
      <span className="text-label tabular-nums">{percent.format(ratio(value))}</span>
      <ContextRing />
    </HoverCardTrigger>
  );
}

function Row({ label, tokens }: { label: string; tokens?: number }) {
  if (!tokens) return null;
  return (
    <div className="flex items-center justify-between text-label">
      <span className="text-muted">{label}</span>
      <span className="font-mono tabular-nums text-ink">{compact.format(tokens)}</span>
    </div>
  );
}

export function ContextContent({ className, ...props }: ComponentProps<typeof HoverCardContent>) {
  const value = useContext(UsageContext);
  const { usedTokens, maxTokens, usage } = value;
  return (
    <HoverCardContent className={cn("w-64 p-0", className)} {...props}>
      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-center justify-between text-label">
          <span className="font-medium text-ink">{percent.format(ratio(value))} of context</span>
          <span className="font-mono tabular-nums text-muted">
            {compact.format(usedTokens)} / {compact.format(maxTokens)}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-active">
          <div className="h-full origin-left rounded-full bg-accent transition-transform duration-(--duration-panel) ease-out" style={{ transform: `scaleX(${ratio(value)})` }} />
        </div>
      </div>
      {usage && (
        <div className="flex flex-col gap-1.5 border-t border-rule p-3">
          <Row label="Input" tokens={usage.inputTokens} />
          <Row label="Output" tokens={usage.outputTokens} />
          <Row label="Cache read" tokens={usage.cacheReadTokens} />
          <Row label="Cache write" tokens={usage.cacheWriteTokens} />
        </div>
      )}
    </HoverCardContent>
  );
}
