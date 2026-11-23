import type { Overlap } from "@/ipc";
import { agentLabel, type AgentRow, type JobState, MergeForecast, MergeOutcome } from "./types";

export type Tone = "approval" | "running" | "done" | "failed";

export type Summary = { tone: Tone; title: string; detail: string };

export function describe(outcome: MergeOutcome) {
  return "Merged" in outcome
    ? `Merged ${outcome.Merged.commit}`
    : `Conflict in ${outcome.Conflict.files.join(", ")}`;
}

export function describeForecast(forecast: MergeForecast) {
  if (forecast === "Clean") return "Merges cleanly";
  const { files } = forecast.Conflict;
  return `${files.length} ${files.length === 1 ? "file" : "files"} would conflict: ${files.join(", ")}`;
}

export function describeOverlap(overlap: Overlap) {
  return `Conflicts with ${overlap.title}: ${overlap.files.join(", ")}`;
}

const names = (agents: AgentRow[]) => {
  const list = agents.map(agentLabel);
  return list.length < 3 ? list.join(" and ") : `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
};

function working(agents: AgentRow[], asking: Set<string>, questioning: Set<string>): Summary | undefined {
  const askers = agents.filter((agent) => asking.has(agent.id));
  if (askers.length > 0 && askers.every((agent) => questioning.has(agent.id))) return { tone: "approval", title: `${names(askers)} ${askers.length === 1 ? "has a question" : "have questions"}`, detail: "Answer in the agent's chat to continue." };
  if (askers.length > 0) return { tone: "approval", title: `${names(askers)} ${askers.length === 1 ? "needs" : "need"} your permission`, detail: "Allow or deny the request in the agent's chat to continue." };
  const running = agents.filter((agent) => agent.status === "running");
  const failed = agents.filter((agent) => agent.status === "failed");
  if (failed.length > 0) return { tone: "failed", title: `${names(failed)} failed`, detail: "Open the agent to see what went wrong." };
  if (running.length === 0) return;
  return {
    tone: "running",
    title: `${names(running)} ${running.length === 1 ? "is" : "are"} working`,
    detail: "Nothing needs you right now.",
  };
}

export function summarize(job: JobState | undefined, agents: AgentRow[], asking: Set<string>, outcome?: MergeOutcome, forecast?: MergeForecast, questioning: Set<string> = new Set()): Summary | undefined {
  switch (job?.status) {
    case "awaiting_approval":
      return { tone: "approval", title: "Ready to build", detail: "The agents start building once you approve." };
    case "done":
      if (agents.some((agent) => agent.status === "running")) return working(agents, asking, questioning);
      if (outcome && "Conflict" in outcome) return { tone: "failed", title: describe(outcome), detail: "Resolve the conflicts or let the agent resolve them, then merge again." };
      return { tone: "done", title: outcome ? describe(outcome) : "Ready to merge", detail: outcome ? "The changes are in your branch." : forecast ? describeForecast(forecast) : "All agents finished. Merge the changes into your branch." };
    case "merged":
      return { tone: "done", title: "Merged", detail: "The changes are in your branch." };
    case "failed":
      return { tone: "failed", title: "The session failed", detail: job.failure ?? "No error was recorded. Send a message to try again." };
    case "planning":
      if (!agents.some((agent) => agent.status === "running")) return working(agents, asking, questioning);
      return { tone: "running", title: "Writing the plan", detail: "You approve it before anything is built." };
    default:
      return working(agents, asking, questioning);
  }
}

export function relativeTime(at: number, now: number) {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}
