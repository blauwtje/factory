import { Fragment, useState, type ReactNode } from "react";
import { ContextRing, Context } from "@/components/ai/context";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import type { BackgroundTask } from "@/chat/types";
import type { Tokens } from "@/ipc";
import { StatusDot } from "@/shell/status";
import type { JobStatus } from "@/shell/types";
import { formatTokens } from "@/stats/format";
import { cn } from "@/lib/utils";
import { AgentsSection } from "./AgentsSection";
import { ContextSection, contextHeading, percent, shareOf, useContextUsage } from "./ContextMeter";
import { McpSection, useMcpServers } from "./McpStatus";
import type { AgentRow } from "./types";

type Props = {
  agent: AgentRow;
  agents: AgentRow[];
  asking: Set<string>;
  tokens: Map<string, Tokens>;
  sessionTotal?: Tokens;
  shells: ReadonlyMap<string, BackgroundTask[]>;
  onSelect: (id: string) => void;
  onCustomizeMcp?: () => void;
};

function Section({ name, heading, children }: { name: string; heading: string; children: ReactNode }) {
  return (
    <section aria-label={name} className="flex flex-col gap-1.5">
      <p className="px-2 text-label font-medium text-ink">{heading}</p>
      {children}
    </section>
  );
}

export function SessionStatusMenu({ agent, agents, asking, tokens, sessionTotal, shells, onSelect, onCustomizeMcp }: Props) {
  const [open, setOpen] = useState(false);
  const usage = useContextUsage(agent.id);
  const { servers, reconnect } = useMcpServers(agent.id);
  const subagents = agents.filter((other) => other.kind !== "lead");
  const shellRows = agents.flatMap((other) => (shells.get(other.id) ?? []).map((task) => ({ agent: other, task })));
  const running = subagents.filter((other) => other.status === "running").length + shellRows.length;
  const agentCount = running > 0 ? running : subagents.length;
  const waiting = subagents.some((other) => asking.has(other.id));
  const dot: JobStatus = waiting ? "awaiting_approval" : running > 0 ? "building" : "done";
  const hasAgents = subagents.length > 0 || shellRows.length > 0;
  const windowed = !!usage && usage.maxTokens > 0;
  const share = usage ? shareOf(usage) : 0;

  const spoken = [
    hasAgents && (running > 0 ? `${running} running` : `${subagents.length} ${subagents.length === 1 ? "agent" : "agents"}`),
    usage && (windowed ? `${percent(share)} of context used` : `${formatTokens(usage.totalTokens)} tokens of context`),
    servers.length > 0 && `${servers.length} MCP ${servers.length === 1 ? "server" : "servers"}`,
  ].filter(Boolean);
  const segments: ReactNode[] = [
    hasAgents && (
      <span key="agents" className="flex items-center gap-1.5">
        <StatusDot status={dot} />
        {agentCount}
      </span>
    ),
    usage === undefined && <Skeleton key="context" className="h-4 w-10" />,
    usage && (
      <span key="context" className={cn("flex items-center gap-1.5", share >= 0.95 ? "text-failed-ink" : share >= 0.8 && "text-approval-ink")}>
        {windowed && <ContextRing />}
        {windowed ? percent(share) : formatTokens(usage.totalTokens)}
      </span>
    ),
    servers.length > 0 && <span key="mcp">{servers.length} MCP</span>,
  ].filter(Boolean);
  if (segments.length === 0) return null;

  const pick = (id: string) => {
    setOpen(false);
    onSelect(id);
  };
  return (
    <Context usedTokens={usage?.totalTokens ?? 0} maxTokens={Math.max(usage?.maxTokens ?? 1, 1)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger render={<Button variant="ghost" size="sm" aria-label={`Session status: ${spoken.join(", ")}`} className="gap-1.5 text-label tabular-nums text-muted" />}>
          {segments.map((segment, index) => (
            <Fragment key={index}>
              {index > 0 && (
                <span aria-hidden className="text-faint">
                  ·
                </span>
              )}
              {segment}
            </Fragment>
          ))}
        </PopoverTrigger>
        <PopoverContent align="end" className="max-h-[min(40rem,80vh)] w-80 gap-4 overflow-y-auto p-2">
          <Section name="Agents" heading="Agents">
            <AgentsSection subagents={subagents} shellRows={shellRows} current={agent} asking={asking} tokens={tokens} onSelect={pick} />
          </Section>
          <Section name="Context" heading={usage ? contextHeading(usage) : "Context"}>
            <ContextSection usage={usage} tokens={sessionTotal} />
          </Section>
          <Section name="MCP" heading="MCP">
            <McpSection servers={servers} onReconnect={reconnect} onCustomize={onCustomizeMcp} />
          </Section>
        </PopoverContent>
      </Popover>
    </Context>
  );
}
