import { useEffect, useState, type ReactNode } from "react";
import { Check, CircleDashed, CircleDot, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, X, type LucideIcon } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { jobLinks, onAgentEvent, type JobLinks, type PullRequest } from "@/ipc";
import { cn } from "@/lib/utils";

const STATES: Record<PullRequest["state"], { icon: LucideIcon; ink: string; word: string }> = {
  open: { icon: GitPullRequest, ink: "text-running", word: "Open" },
  draft: { icon: GitPullRequestDraft, ink: "text-faint", word: "Draft" },
  merged: { icon: GitMerge, ink: "text-done", word: "Merged" },
  closed: { icon: GitPullRequestClosed, ink: "text-failed", word: "Closed" },
};

const CHECKS: Record<NonNullable<PullRequest["checks"]>, { icon: LucideIcon; ink: string; word: string }> = {
  passing: { icon: Check, ink: "text-done", word: "Checks passing" },
  failing: { icon: X, ink: "text-failed", word: "Checks failing" },
  pending: { icon: CircleDashed, ink: "text-running", word: "Checks running" },
};

const open = (url: string) => () => void openUrl(url).catch(() => undefined);

export function useJobLinks(jobId: string) {
  const [links, setLinks] = useState<JobLinks>();
  useEffect(() => {
    const load = () => jobLinks(jobId).then(setLinks, () => undefined);
    load();
    window.addEventListener("focus", load);
    const stop = onAgentEvent(({ event }) => "Result" in event && load());
    return () => {
      window.removeEventListener("focus", load);
      stop();
    };
  }, [jobId]);
  return links;
}

function Chip({ label, tip, onClick, children }: { label: string; tip: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="sm" aria-label={label} onClick={onClick} className="gap-1 text-muted tabular-nums" />}>{children}</TooltipTrigger>
      <TooltipContent side="bottom">{tip}</TooltipContent>
    </Tooltip>
  );
}

export function PullRequestChips({ pullRequest }: { pullRequest: PullRequest }) {
  const state = STATES[pullRequest.state];
  const checks = pullRequest.checks && CHECKS[pullRequest.checks];
  const words = [state.word, checks?.word].filter(Boolean).join(", ");
  return (
    <>
      <Chip label={`Pull request #${pullRequest.number}, ${words.toLowerCase()}: ${pullRequest.title}`} tip={`${pullRequest.title} · ${words}`} onClick={open(pullRequest.url)}>
        <state.icon aria-hidden className={cn("size-3.5", state.ink)} />
        <span className="text-label">#{pullRequest.number}</span>
        {checks && <checks.icon aria-hidden strokeWidth={3} className={cn("size-3", checks.ink)} />}
      </Chip>
      {pullRequest.issues.map((issue) => (
        <Chip key={issue.number} label={`Linked issue #${issue.number}`} tip={`Closes issue #${issue.number}`} onClick={open(issue.url)}>
          <CircleDot aria-hidden className="size-3.5 text-faint" />
          <span className="text-label">#{issue.number}</span>
        </Chip>
      ))}
    </>
  );
}
