import type { SessionGroup, SessionSort, SessionWindow } from "@/lib/prefs";
import type { JobStatus, ProjectSummary, SessionSummary } from "./types";

export type Entry = { session: SessionSummary; project: ProjectSummary };

export type Arranged = { key: string; label: string; project?: ProjectSummary; entries: Entry[] };

export type View = { group: SessionGroup; sort: SessionSort; window: SessionWindow; archived: boolean };

const DAY = 86_400;

const STATUS_GROUPS = ["Needs reply", "Running", "Idle", "Done", "Failed"] as const;

type StatusGroup = (typeof STATUS_GROUPS)[number];

const GROUP_OF: Record<JobStatus, StatusGroup> = {
  awaiting_approval: "Needs reply",
  planning: "Running",
  building: "Running",
  waiting: "Idle",
  done: "Done",
  merged: "Done",
  failed: "Failed",
};

export const needsReply = (session: SessionSummary) => session.needsReply === true || session.status === "awaiting_approval";

const statusGroup = (session: SessionSummary): StatusGroup => (needsReply(session) ? "Needs reply" : GROUP_OF[session.status]);

const activeAt = (session: SessionSummary) => session.lastActiveAt ?? session.createdAt ?? 0;

const COMPARE: Record<SessionSort, (a: SessionSummary, b: SessionSummary) => number> = {
  started: (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0),
  active: (a, b) => activeAt(b) - activeAt(a),
  needs_reply: (a, b) => Number(needsReply(b)) - Number(needsReply(a)) || activeAt(b) - activeAt(a),
};

export function visible(session: SessionSummary, view: Pick<View, "window" | "archived">, now = Date.now() / 1000) {
  if (session.archived && !view.archived) return false;
  const stamp = session.lastActiveAt ?? session.createdAt;
  return view.window === 0 || stamp === undefined || now - stamp <= view.window * DAY;
}

function ordered(entries: Entry[], sort: SessionSort): Entry[] {
  const sorted = [...entries].sort((a, b) => COMPARE[sort](a.session, b.session));
  return [...sorted.filter(({ session }) => session.pinned), ...sorted.filter(({ session }) => !session.pinned)];
}

export function arrange(projects: ProjectSummary[], view: View, now = Date.now() / 1000): Arranged[] {
  const entries = projects.flatMap((project) => project.sessions.filter((session) => visible(session, view, now)).map((session) => ({ session, project })));
  if (view.group === "none") return entries.length ? [{ key: "all", label: "", entries: ordered(entries, view.sort) }] : [];
  if (view.group === "status") {
    return STATUS_GROUPS.map((label) => ({ key: label, label, entries: ordered(entries.filter(({ session }) => statusGroup(session) === label), view.sort) })).filter(({ entries }) => entries.length > 0);
  }
  return projects
    .map((project) => ({ key: project.path, label: project.name, project, entries: ordered(entries.filter((entry) => entry.project === project), view.sort) }))
    .filter(({ entries }) => entries.length > 0);
}

export function compactTokens(tokens: number) {
  return tokens < 1000 ? String(tokens) : `${Math.round(tokens / 1000)}k`;
}

export const branchName = (branch: string) => branch.replace(/^factory\//, "");
