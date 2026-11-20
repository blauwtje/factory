import { Tabs } from "@base-ui/react/tabs";
import { motion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { StatusDot } from "@/shell/status";
import { formatTokens } from "@/stats/format";
import type { Tokens } from "@/ipc";
import { AgentGlyph } from "./look";
import { DOT_STATUS } from "./AgentsSection";
import { ORCHESTRATOR, type AgentRow } from "./types";

type Props = {
  lead: AgentRow;
  subagents: AgentRow[];
  current: AgentRow;
  asking: Set<string>;
  tokens: Map<string, Tokens>;
};

const FADE = "1.5rem";

function edgeMask(more: { start: boolean; end: boolean }) {
  if (!more.start && !more.end) return undefined;
  const start = more.start ? `transparent, #000 ${FADE}` : "#000, #000";
  const end = more.end ? `#000 calc(100% - ${FADE}), transparent` : "#000, #000";
  return `linear-gradient(to right, ${start}, ${end})`;
}

function useOverflowEdges(count: number) {
  const list = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ start: false, end: false });
  useEffect(() => {
    const node = list.current;
    if (!node) return;
    const measure = () => {
      const start = node.scrollLeft > 1;
      const end = node.scrollLeft + node.clientWidth < node.scrollWidth - 1;
      setMore((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
    };
    measure();
    node.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      node.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [count]);
  return { list, mask: edgeMask(more) };
}

const tabClass = "ui-press relative flex shrink-0 cursor-pointer items-center gap-2 rounded-full text-label text-muted outline-none ui-focus transition-colors duration-(--duration-press) hover:text-ink data-[active]:text-ink";

type TabProps = { agent: AgentRow; label: string; active: boolean; layoutId: string; asking: Set<string>; tokens: Map<string, Tokens>; size: "lead" | "sub" };

function AgentTab({ agent, label, active, layoutId, asking, tokens, size }: TabProps) {
  const used = tokens.get(agent.id);
  const lead = size === "lead";
  return (
    <Tabs.Tab value={agent.id} className={cn(tabClass, lead ? "h-9 px-3 text-body" : "h-7 px-2")}>
      {active && <motion.span aria-hidden layoutId={layoutId} transition={spring} className={cn("absolute inset-0 rounded-full", lead ? "bg-active ring-1 ring-edge" : "bg-active")} />}
      <AgentGlyph name={agent.name} role={agent.role} className={cn("relative rounded-full", lead ? "size-6 [&>svg]:size-3.5" : "size-4 [&>svg]:size-2.5")} />
      <span className={cn("relative truncate font-medium", lead ? "max-w-40" : "max-w-28")}>{label}</span>
      <StatusDot status={asking.has(agent.id) ? "awaiting_approval" : DOT_STATUS[agent.status]} className="relative" />
      {used && (
        <span className="relative font-mono text-caption tabular-nums text-faint">
          {formatTokens(used.uncached)}
          <span className="sr-only"> tokens</span>
        </span>
      )}
    </Tabs.Tab>
  );
}

export function AgentStrip({ lead, subagents, current, asking, tokens }: Props) {
  const layoutId = `agent-pill-${useId()}`;
  const { list, mask } = useOverflowEdges(subagents.length);
  return (
    <div className="chat-column pt-2">
      <Tabs.List aria-label="Agents" className="flex items-center gap-3 pb-1">
        <div className="shrink-0 rounded-full border border-edge bg-surface p-0.5">
          <AgentTab agent={lead} label={ORCHESTRATOR} active={lead.id === current.id} layoutId={layoutId} asking={asking} tokens={tokens} size="lead" />
        </div>
        <span aria-hidden className="h-4 w-3 shrink-0 self-start rounded-bl-md border-b border-l border-edge" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="px-2 text-caption text-faint">Subagents · {subagents.length}</span>
          <div ref={list} style={{ maskImage: mask, WebkitMaskImage: mask }} className="flex gap-0.5 overflow-x-auto [scrollbar-width:none]">
            {subagents.map((agent) => (
              <AgentTab key={agent.id} agent={agent} label={agent.name} active={agent.id === current.id} layoutId={layoutId} asking={asking} tokens={tokens} size="sub" />
            ))}
          </div>
        </div>
      </Tabs.List>
    </div>
  );
}
