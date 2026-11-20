import { SquareTerminal } from "lucide-react";
import type { BackgroundTask } from "@/chat/types";
import type { Tokens } from "@/ipc";
import { STATUS_WORD, StatusDot } from "@/shell/status";
import type { JobStatus } from "@/shell/types";
import { formatTokens } from "@/stats/format";
import { cn } from "@/lib/utils";
import { AgentGlyph } from "./look";
import { AGENT_STATUS_LABELS, type AgentRow, type AgentStatus } from "./types";

export const DOT_STATUS: Record<AgentStatus, JobStatus> = {
  running: "building",
  waiting: "merged",
  done: "done",
  failed: "failed",
};

const WORD_CLASS: Record<AgentStatus, string> = {
  running: "text-running-ink",
  waiting: "text-muted",
  done: "text-muted",
  failed: "text-failed-ink",
};

export type ShellRow = { agent: AgentRow; task: BackgroundTask };

type Props = {
  subagents: AgentRow[];
  shellRows: ShellRow[];
  current: AgentRow;
  asking: Set<string>;
  tokens: Map<string, Tokens>;
  onSelect: (id: string) => void;
};

const rowClass = "ui-press flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left ui-focus-inset transition-colors duration-(--duration-press) hover:bg-active";

export function AgentsSection({ subagents, shellRows, current, asking, tokens, onSelect }: Props) {
  if (subagents.length === 0 && shellRows.length === 0) return <p className="px-2 text-label text-muted">No subagents yet. The Orchestrator starts them once the plan takes shape.</p>;
  return (
    <div className="flex flex-col gap-0.5">
      {subagents.map((agent) => {
        const asked = asking.has(agent.id);
        const status = agent.status;
        const word = asked ? { word: "Needs permission", className: STATUS_WORD.awaiting_approval?.className } : { word: AGENT_STATUS_LABELS[status], className: WORD_CLASS[status] };
        const used = tokens.get(agent.id);
        return (
          <button key={agent.id} type="button" aria-current={agent.id === current.id || undefined} onClick={() => onSelect(agent.id)} className={cn(rowClass, "aria-current:bg-active")}>
            <AgentGlyph name={agent.name} role={agent.role} className="size-5 rounded [&>svg]:size-3" />
            <span className="min-w-0 flex-1 truncate text-label text-ink">{agent.name}</span>
            <StatusDot status={asked ? "awaiting_approval" : DOT_STATUS[status]} />
            <span className={cn("text-label", word.className)}>{word.word}</span>
            {used && (
              <span className="font-mono text-caption tabular-nums text-faint">
                {formatTokens(used.uncached)}
                <span className="sr-only"> tokens</span>
              </span>
            )}
          </button>
        );
      })}
      {shellRows.length > 0 && (
        <>
          <p className="px-2 pt-2 pb-1 text-caption text-faint">Background shells</p>
          {shellRows.map(({ agent, task }) => (
            <button key={`${agent.id}-${task.task_id}`} type="button" onClick={() => onSelect(agent.id)} className={rowClass}>
              <SquareTerminal aria-hidden className="size-4 shrink-0 text-faint" />
              <span className="min-w-0 flex-1 truncate font-mono text-label text-ink">{task.description}</span>
              <span className="text-caption text-muted">{agent.name}</span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}
