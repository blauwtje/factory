export const STATUS_LABELS = {
  planning: "Running",
  waiting: "Idle",
  awaiting_approval: "Approve plan",
  building: "Working",
  done: "Done",
  merged: "Merged",
  failed: "Failed",
} as const;

export type JobStatus = keyof typeof STATUS_LABELS;

export type SessionSummary = {
  id: string;
  title: string;
  status: JobStatus;
  createdAt?: number;
  archived?: boolean;
  pinned?: boolean;
  branch?: string;
  worktree?: string;
  needsReply?: boolean;
  contextTokens?: number;
  lastActiveAt?: number;
  accountId?: string;
};
export type ProjectSummary = { path: string; name: string; sessions: SessionSummary[] };

export type Page = "home" | "session" | "settings" | "customize";

export type SettingsSection =
  | "general"
  | "sessions"
  | "permissions"
  | "usage"
  | "statistics"
  | "cli"
  | "about"
  | "overview"
  | "plugins"
  | "skills"
  | "agents"
  | "mcp"
  | "hooks"
  | "rules"
  | "memory";

export const withoutArchived = (projects: ProjectSummary[]): ProjectSummary[] =>
  projects
    .map((project) => ({ ...project, sessions: project.sessions.filter((session) => !session.archived) }))
    .filter((project) => project.sessions.length > 0);
