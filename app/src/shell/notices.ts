import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isPermissionGranted, onAction, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import type { AgentEventPayload, StreamEvent } from "@/chat/types";
import { onAgentEvent } from "@/ipc";
import type { ProjectSummary } from "./types";

export const DONE_AFTER_MS = 30_000;

function bodyFor(event: StreamEvent, turnMs: number) {
  if ("ControlRequest" in event) return `Needs permission for ${event.ControlRequest.tool_name}`;
  if (!("Result" in event)) return null;
  const { outcome } = event.Result;
  if (outcome === "Failed") return "Turn failed";
  return outcome === "Finished" && turnMs >= DONE_AFTER_MS ? "Finished" : null;
}

export async function granted() {
  return (await isPermissionGranted()) || (await requestPermission()) === "granted";
}

export function useNotices(projects: ProjectSummary[], open: (id: string) => void) {
  const projectsRef = useRef(projects);
  const openRef = useRef(open);

  useEffect(() => {
    projectsRef.current = projects;
    openRef.current = open;
  });

  useEffect(() => {
    const turnStarts = new Map<string, number>();

    async function notify({ job_id, agent_id, event }: AgentEventPayload) {
      const now = Date.now();
      const turnMs = now - (turnStarts.get(agent_id) ?? now);
      if ("Result" in event) turnStarts.delete(agent_id);
      else if (!turnStarts.has(agent_id)) turnStarts.set(agent_id, now);
      const body = bodyFor(event, turnMs);
      if (!body || (await getCurrentWindow().isFocused()) || !(await granted())) return;
      const title = projectsRef.current.flatMap((project) => project.sessions).find((session) => session.id === job_id)?.title ?? job_id;
      sendNotification({ title, body, extra: { job_id } });
    }

    const stopEvents = onAgentEvent((payload) => void notify(payload).catch(() => undefined));
    const registration = onAction(({ actionId, notification }) => {
      const job_id = notification?.extra?.job_id;
      if (actionId === "tap" && typeof job_id === "string") openRef.current(job_id);
    }).catch(() => undefined);
    return () => {
      stopEvents();
      void registration.then((listener) => listener?.unregister());
    };
  }, []);
}
