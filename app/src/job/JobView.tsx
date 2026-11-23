import { useCallback, useEffect, useState } from "react";
import { Tabs } from "@base-ui/react/tabs";
import { ChatView, type Focus } from "@/chat/ChatView";
import { ChevronDown, Users } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { approvePlan, listAgents, listJobs, jobOverlaps, mergeForecast, mergeJob, onAgentEvent, resolveConflicts, onTokens, sessionTokens, type JobRow, type Overlap, type SessionTokens } from "@/ipc";
import { Button } from "@/components/ui/button";
import { readPersisted } from "@/lib/persisted";
import { usePref } from "@/lib/prefs";
import { cached, remember } from "@/lib/cache";
import { cn } from "@/lib/utils";
import { TitleActions } from "@/shell/title-actions";
import type { PlanPhase } from "@/chat/PlanCard";
import type { BackgroundTask, StreamEvent } from "@/chat/types";
import { AgentControls } from "./AgentControls";
import { AgentStrip } from "./AgentStrip";
import { ApprovalBar } from "./ApprovalBar";
import { BranchChip } from "./BranchChip";
import { BusTimeline } from "./BusTimeline";
import { ChangesPanel } from "./ChangesPanel";
import { PullRequestChips, useJobLinks } from "./PullRequestChips";
import { ActionButton, SessionStatus } from "./SessionBar";
import { SessionStatusMenu } from "./SessionStatusMenu";
import { SettingsBanner } from "./SettingsBanner";
import { describeOverlap, summarize, type Summary } from "./summary";
import { agentLabel, type AgentRow, type BusMessage, type JobState, type MergeForecast, type MergeOutcome } from "./types";

const BUS_LABELS: Record<string, (name: string) => string> = {
  spawn_agent: (name) => `started ${name}`,
  send_to_agent: (name) => `sent a message to ${name}`,
  set_agent_model: (name) => `changed the model of ${name}`,
  plan_ready: () => "marked the plan ready for approval",
};

const PLAN_PHASES: Record<JobState["status"], PlanPhase> = {
  planning: "draft",
  awaiting_approval: "review",
  building: "building",
  done: "done",
  merged: "done",
  failed: "draft",
};

const planPhase = (job?: JobState) => job && PLAN_PHASES[job.status];

const BUS_TOOL = /^mcp__factory__(spawn_agent|send_to_agent|set_agent_model|plan_ready)$/;

function toBusMessage(agentId: string, event: StreamEvent): BusMessage | undefined {
  if (!("ToolUse" in event)) return;
  const { id, name, input } = event.ToolUse;
  const tool = BUS_TOOL.exec(name)?.[1];
  if (!tool) return;
  const target = typeof input.name === "string" ? input.name : "";
  return { id, text: [tool, input.name].filter(Boolean).join(" "), label: BUS_LABELS[tool](target), agentId, target, at: Date.now() };
}

export function JobView({ jobId, focus, onCustomizeMcp }: { jobId: string; focus?: Focus; onCustomizeMcp?: () => void }) {
  const [agents, setAgents] = useState<AgentRow[] | undefined>(() => cached(`agents:${jobId}`));
  const [job, setJob] = useState<JobRow | undefined>(() => readPersisted<JobRow[]>("jobs")?.find((j) => j.id === jobId));
  const [outcome, setOutcome] = useState<MergeOutcome>();
  const [forecast, setForecast] = useState<MergeForecast>();
  const [overlaps, setOverlaps] = useState<Overlap[]>([]);
  const [selection, setSelection] = useState<{ id?: string; focus?: Focus }>({});
  const [busMessages, setBusMessages] = useState<BusMessage[]>([]);
  const [activityOpen, setActivityOpen] = usePref("activity", false);
  const [changesOpen, setChangesOpen] = useState(false);
  const [failure, setFailure] = useState<Summary>();
  const [asking, setAsking] = useState<Set<string>>(new Set());
  const [questioning, setQuestioning] = useState<Set<string>>(new Set());
  const [shells, setShells] = useState<ReadonlyMap<string, BackgroundTask[]>>(new Map());

  const [sessionTotals, setSessionTotals] = useState<SessionTokens>();
  const links = useJobLinks(jobId);

  useEffect(() => {
    const loadTokens = () => sessionTokens(jobId).then(setSessionTotals, () => undefined);
    loadTokens();
    return onTokens((id) => id === jobId && loadTokens());
  }, [jobId]);

  const load = useCallback(
    () =>
      Promise.all([
        listAgents(jobId).then((rows) => {
          setAgents(remember(`agents:${jobId}`, rows));
        }),
        listJobs().then((jobs) => {
          const found = jobs.find((j) => j.id === jobId);
          setJob(found);
          if (found?.status === "done") mergeForecast(jobId).then(setForecast, () => undefined);
          if (found && found.status !== "merged") jobOverlaps(jobId).then((list) => setOverlaps(list ?? []), () => undefined);
        }),
      ]),
    [jobId],
  );
  const roster = agents ?? [];
  const newestLead = roster.filter((a) => a.kind === "lead").at(-1);
  const setSelected = (id?: string) => setSelection({ id, focus });
  const focused = focus && selection.focus !== focus && agents?.some((agent) => agent.id === focus.agentId);
  const selected = focused ? focus.agentId : selection.id;

  const refresh = load;

  useEffect(() => {
    load();
  }, [load]);

  useEffect(
    () =>
      onAgentEvent(({ agent_id, event }) => {
        if ("Tasks" in event) setShells((current) => new Map(current).set(agent_id, event.Tasks.tasks));
        if ("Init" in event) setShells((current) => new Map(current).set(agent_id, []));
        setAsking((current) => {
          const next = new Set(current);
          if ("ControlRequest" in event) next.add(agent_id);
          else next.delete(agent_id);
          return next;
        });
        setQuestioning((current) => {
          const next = new Set(current);
          if ("ControlRequest" in event && event.ControlRequest.tool_name === "AskUserQuestion") next.add(agent_id);
          else next.delete(agent_id);
          return next;
        });
        const message = toBusMessage(agent_id, event);
        if (message) setBusMessages((messages) => [...messages, message]);
        if (message || "Init" in event || "Result" in event) load();
      }),
    [load],
  );

  const attempt = (title: string, run: () => Promise<void>) => async () => {
    try {
      await run();
      setFailure(undefined);
    } catch (error) {
      setFailure({ tone: "failed", title, detail: String(error) });
    }
  };
  const approve = attempt("Approve failed", async () => {
    await approvePlan(jobId);
    await refresh();
  });
  const merge = attempt("Merge failed", async () => {
    setOutcome(await mergeJob(jobId));
    await refresh();
  });
  const resolve = attempt("Resolve failed", async () => {
    await resolveConflicts(jobId);
    setOutcome(undefined);
    setForecast(undefined);
    await refresh();
  });

  const subagents = roster.filter((agent) => agent.kind !== "lead");
  const current = roster.find((a) => a.id === selected) ?? newestLead ?? roster[0];
  const summary = failure ?? (job && summarize(job, roster, asking, outcome, forecast, questioning));
  const merged = outcome !== undefined && "Merged" in outcome;
  const conflicting = (outcome && "Conflict" in outcome) || (forecast && forecast !== "Clean");
  const working = roster.some((agent) => agent.status === "running");
  const action =
    job?.status === "awaiting_approval"
      ? ({ kind: "approve", run: approve } as const)
      : job?.status === "done" && !merged
        ? ({ kind: "merge", run: merge } as const)
        : undefined;

  const tokens = new Map(sessionTotals?.agents.map(({ agent_id, tokens }) => [agent_id, tokens]));
  const latest = busMessages.at(-1);
  const latestSender = latest && (agentLabel(roster.find((agent) => agent.id === latest.agentId) ?? { name: "agent" }));

  return (
    <Tabs.Root value={current?.id ?? null} onValueChange={(id) => setSelected(id === newestLead?.id ? undefined : String(id))} className="flex h-full min-w-0 flex-col">
      <TitleActions>
        {job && current && !job.cleaned_up && <BranchChip branch={job.branch} worktree={current.worktree} agentId={current.id} branchUrl={links?.branch_url} />}
        {links?.pull_request && <PullRequestChips pullRequest={links.pull_request} />}
        {current && <SessionStatusMenu key={current.id} agent={current} agents={roster} asking={asking} tokens={tokens} sessionTotal={sessionTotals?.total} shells={shells} onSelect={setSelected} onCustomizeMcp={onCustomizeMcp} />}
        {job?.status === "done" && conflicting && !working && (
          <Button variant="outline" className="shrink-0" onClick={resolve}>
            Let the agent resolve
          </Button>
        )}
        {action && action.kind !== "approve" && <ActionButton action={action} />}
      </TitleActions>
      <Collapsible open={activityOpen && busMessages.length > 0} onOpenChange={(open) => setActivityOpen(open)}>
        <div className="chat-column flex min-w-0 items-center gap-3 pt-2 pb-1">
          {agents?.length === 0 && (
            <p className="flex items-center gap-2 text-label text-muted">
              <Users aria-hidden className="size-4 shrink-0 text-faint" />
              No agents yet. The Orchestrator starts them once the plan takes shape.
            </p>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {job && !job.cleaned_up && (
              <button
                type="button"
                aria-pressed={changesOpen}
                onClick={() => setChangesOpen((open) => !open)}
                className={cn("ui-press flex h-7 cursor-pointer items-center rounded-md px-2 text-label font-medium ui-focus hover:text-ink", changesOpen ? "text-ink" : "text-muted")}
              >
                Changes
              </button>
            )}
            {busMessages.length > 0 && (
              <CollapsibleTrigger className="ui-press flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-label font-medium text-muted ui-focus hover:text-ink">
                Activity
                <span className="tabular-nums text-faint">{busMessages.length}</span>
                <ChevronDown aria-hidden className={cn("size-3 transition-[rotate] duration-(--duration-menu)", activityOpen && "rotate-180")} />
              </CollapsibleTrigger>
            )}
          </div>
        </div>
        <CollapsibleContent className="chat-column">
          <div className="pb-1">
            <div className="border-b border-rule pb-2">
              <BusTimeline messages={busMessages} agents={roster} onSelect={setSelected} />
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
      <p role="status" className="sr-only">
        {latest && `${latestSender} ${latest.label}`}
      </p>
      {current && newestLead && subagents.length > 0 && !changesOpen && <AgentStrip lead={newestLead} subagents={subagents} current={current} asking={asking} tokens={tokens} />}
      {summary && <SessionStatus summary={summary} />}
      {current && <SettingsBanner key={current.id} agent={current} onRestart={refresh} />}
      {overlaps.map((overlap) => (
        <p key={overlap.job_id} className="chat-column text-caption text-muted">
          {describeOverlap(overlap)}
        </p>
      ))}
      {changesOpen && job && (
        <div className="mt-2 min-h-0 flex-1">
          <ChangesPanel jobId={job.id} leadId={newestLead?.id} />
        </div>
      )}
      <div className="mt-2 min-h-0 flex-1" hidden={changesOpen}>
        {roster.map((agent) => (
          <Tabs.Panel key={agent.id} value={agent.id} keepMounted tabIndex={undefined} className="h-full">
            <ChatView
              agentId={agent.id}
              project={job?.project_path}
              focus={focus?.agentId === agent.id ? focus : undefined}
              planPhase={planPhase(job)}
              aboveComposer={action?.kind === "approve" && agent.id === newestLead?.id && <ApprovalBar action={action} />}
              composerTools={agent.id === current?.id && <AgentControls key={agent.id} agent={agent} onChange={refresh} />}
            />
          </Tabs.Panel>
        ))}
      </div>
    </Tabs.Root>
  );
}
