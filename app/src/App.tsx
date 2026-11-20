import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { claudeInfo, listJobs, onAgentEvent, setTrayStatus, type JobRow } from "@/ipc";
import { usePref } from "@/lib/prefs";
import { useScheme } from "@/lib/theme";
import type { ClaudeResult } from "@/shell/SettingsPage";
import { Shell } from "@/shell/Shell";
import { trayStatus } from "@/shell/tray-status";
import type { JobStatus, ProjectSummary } from "@/shell/types";
import { UpdateHost } from "@/update/UpdateHost";

type ListedJob = JobRow & { created_at?: number };

function shown(status: JobStatus, active: boolean, failed: boolean): JobStatus {
  if (status !== "planning" && status !== "building") return status;
  if (active) return status;
  return failed ? "failed" : "waiting";
}

function toProjects(jobs: ListedJob[], asking: ReadonlySet<string>): ProjectSummary[] {
  const byPath = new Map<string, ProjectSummary>();
  for (const { id, title, status, active, failed, archived, pinned, created_at, project_path, project_name, branch, worktree, needs_reply, context_tokens, last_active_at, account_id } of jobs) {
    const project = byPath.get(project_path) ?? { path: project_path, name: project_name, sessions: [] };
    project.sessions.push({
      id,
      title,
      status: asking.has(id) ? "awaiting_approval" : shown(status, active, failed),
      createdAt: created_at,
      archived,
      pinned,
      branch: branch || undefined,
      worktree: worktree?.split("/").filter(Boolean).at(-1),
      needsReply: needs_reply,
      contextTokens: context_tokens ?? undefined,
      lastActiveAt: last_active_at,
      accountId: account_id ?? undefined,
    });
    byPath.set(project_path, project);
  }
  return [...byPath.values()];
}

export function App() {
  const [jobs, setJobs] = useState<ListedJob[]>([]);
  const [asking, setAsking] = useState<ReadonlyMap<string, string>>(new Map());
  const [claude, setClaude] = useState<ClaudeResult | null>(null);
  const reload = useCallback(() => void listJobs().then(setJobs), []);
  const scheme = useScheme();
  const [palette] = usePref("palette", "graphite");

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = scheme;
    document.documentElement.dataset.palette = palette;
  }, [scheme, palette]);

  useEffect(() => {
    claudeInfo().then(
      (info) => setClaude({ info }),
      (reason) => setClaude({ error: String(reason) }),
    );
  }, []);

  useEffect(() => {
    reload();
    return onAgentEvent(({ job_id, agent_id, event }) => {
      setAsking((current) => {
        if ("ControlRequest" in event) return new Map(current).set(agent_id, job_id);
        if (!current.has(agent_id)) return current;
        const next = new Map(current);
        next.delete(agent_id);
        return next;
      });
      if ("Init" in event || "Result" in event) reload();
    });
  }, [reload]);

  useEffect(() => {
    void getCurrentWindow().setBadgeCount(asking.size || undefined);
  }, [asking.size]);

  const projects = toProjects(jobs, new Set(asking.values()));
  const { title, tooltip } = trayStatus(projects);
  useEffect(() => {
    setTrayStatus(title, tooltip).catch(() => {});
  }, [title, tooltip]);

  return (
    <>
      <Shell claude={claude ?? undefined} projects={projects} onSessionsChanged={reload} />
      <UpdateHost />
    </>
  );
}
