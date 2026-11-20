import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { contextUsage, onAgentEvent, type ContextUsage, type Tokens } from "@/ipc";
import { cn } from "@/lib/utils";
import { formatTokens } from "@/stats/format";
import { ContextLoaded } from "./ContextLoaded";

const BREAKDOWN = [
  ["Input", "input"],
  ["Cache write", "cache_write"],
  ["Cache read", "cache_read"],
  ["Output", "output"],
] as const;

export const percent = (share: number) => `${Math.round(share * 100)}%`;

const SWATCHES: Record<string, string> = {
  memory_files: "bg-accent",
  skills: "bg-accent/65",
  custom_agents: "bg-accent/40",
  mcp_tools: "bg-accent/25",
  messages: "bg-ink",
  system_prompt: "bg-faint",
  system_tools: "bg-faint/50",
};

const swatchOf = (id?: string) => (id && SWATCHES[id]) || "bg-muted/40";

export const shareOf = (usage: ContextUsage) => (usage.maxTokens > 0 ? usage.totalTokens / usage.maxTokens : 0);

export function contextHeading(usage: ContextUsage) {
  if (usage.maxTokens <= 0) return `${formatTokens(usage.totalTokens)} tokens`;
  return `${formatTokens(usage.totalTokens)} of ${formatTokens(usage.maxTokens)} · ${percent(shareOf(usage))}`;
}

function Line({ label, value, swatch }: { label: string; value: string; swatch?: string }) {
  return (
    <li className="flex items-center gap-2 text-label">
      {swatch && <span aria-hidden className={cn("size-2 shrink-0 rounded-[2px]", swatch)} />}
      <span className="mr-auto text-muted">{label}</span>
      <span className="font-mono tabular-nums text-ink">{value}</span>
    </li>
  );
}

export function useContextUsage(agentId: string) {
  const [usage, setUsage] = useState<ContextUsage | null>();
  useEffect(() => {
    const load = () => contextUsage(agentId).then(setUsage, () => setUsage(null));
    load();
    return onAgentEvent(({ agent_id, event }) => agent_id === agentId && ("Init" in event || "Result" in event || "Compacted" in event) && load());
  }, [agentId]);
  return usage;
}

export function ContextSection({ usage, tokens }: { usage: ContextUsage | null | undefined; tokens?: Tokens }) {
  if (!usage) return <p className="px-2 text-label text-muted">Context usage is not available yet.</p>;
  const windowed = usage.maxTokens > 0;
  const used = usage.categories.filter((category) => category.kind === "used" && category.tokens > 0).sort((a, b) => b.tokens - a.tokens);
  return (
    <div className="flex flex-col gap-2 px-2">
      {windowed && used.length > 0 && (
        <div aria-hidden className="flex h-1.5 gap-px overflow-hidden rounded-full bg-active">
          {used.map((category) => (
            <span key={category.name} className={swatchOf(category.id)} style={{ width: `${(category.tokens / usage.maxTokens) * 100}%` }} />
          ))}
        </div>
      )}
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
        {used.map((category) => (
          <Line key={category.name} label={category.name} value={formatTokens(category.tokens)} swatch={swatchOf(category.id)} />
        ))}
      </ul>
      <Collapsible>
        <CollapsibleTrigger className="group/trigger ui-press flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-md text-label text-muted ui-focus-inset transition-colors duration-(--duration-press) hover:text-ink">
          <ChevronRight aria-hidden className="size-3.5 shrink-0 text-faint transition-[rotate] duration-(--duration-menu) ease-out group-data-[panel-open]/trigger:rotate-90" />
          Details
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="flex flex-col gap-3 pt-1">
            {tokens && (
              <section aria-label="Session tokens" className="flex flex-col gap-1.5">
                <p className="flex justify-between text-label">
                  <span className="font-medium text-ink">Session tokens</span>
                  <span className="font-mono tabular-nums text-muted">{formatTokens(tokens.uncached)}</span>
                </p>
                <ul className="flex flex-col gap-1.5">
                  {BREAKDOWN.map(([name, key]) => (
                    <Line key={key} label={name} value={tokens[key].toLocaleString("en-US")} />
                  ))}
                </ul>
              </section>
            )}
            <ContextLoaded usage={usage} />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
