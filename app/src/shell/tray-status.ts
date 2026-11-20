import type { ProjectSummary } from "@/shell/types";

export function trayStatus(projects: ProjectSummary[]): { title: string; tooltip: string } {
  const sessions = projects.flatMap((project) => project.sessions).filter((session) => !session.archived);
  const needsYou = sessions.filter((session) => session.status === "awaiting_approval").length;
  const running = sessions.filter((session) => session.status === "planning" || session.status === "building").length;
  const parts = [running && `${running} running`, needsYou && `${needsYou} needs you`].filter(Boolean);
  const title = needsYou ? `${needsYou} needs you` : running ? `${running} running` : "";
  return { title, tooltip: ["Factory", parts.join(", ")].filter(Boolean).join(": ") };
}
