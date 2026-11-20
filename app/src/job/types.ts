export const AGENT_STATUS_LABELS = {
  running: "Running",
  waiting: "Waiting",
  done: "Done",
  failed: "Failed",
} as const;

export type AgentStatus = keyof typeof AGENT_STATUS_LABELS;

export type AgentRow = {
  id: string;
  name: string;
  role: string;
  model: string;
  effort: string;
  why: string;
  worktree: string;
  status: AgentStatus;
  kind?: string;
  permission_mode: string;
};

export type JobState = { id: string; status: "planning" | "awaiting_approval" | "building" | "done" | "merged" | "failed" };

export type MergeOutcome = { Merged: { commit: string } } | { Conflict: { files: string[] } };

export type MergeForecast = "Clean" | { Conflict: { files: string[] } };

export type BusMessage = { id: string; text: string; label: string; agentId: string; target: string; at: number };

export const ORCHESTRATOR = "Orchestrator";

export const agentLabel = (agent: Pick<AgentRow, "name" | "kind">) => (agent.kind === "lead" ? ORCHESTRATOR : agent.name);
