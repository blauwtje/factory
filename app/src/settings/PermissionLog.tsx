import { useEffect, useState } from "react";
import { permissionLog, type AuditEntry } from "@/ipc";
import { ProjectPicker } from "@/shell/ProjectPicker";
import { cardClass } from "./parts";

const answers: Record<AuditEntry["decision"], string> = {
  allow_once: "Allowed once",
  allow_always: "Always allowed",
  deny: "Denied",
};

const target = (input: AuditEntry["input"]) => String(input.command ?? input.file_path ?? "");

export function PermissionLog() {
  const [project, setProject] = useState("");
  const [entries, setEntries] = useState<AuditEntry[]>([]);

  useEffect(() => {
    void permissionLog(project || null).then(setEntries);
  }, [project]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <ProjectPicker value={project} onChange={setProject} label="Project:" optional />
      </div>
      {entries.length === 0 ? (
        <p className="text-body text-muted">{project ? "No permission answers in this project yet." : "No permission answers yet."}</p>
      ) : (
        <ul className={`${cardClass} divide-y divide-rule p-0`}>
          {entries.map((entry) => (
            <li key={`${entry.job_id}-${entry.agent_id}-${entry.time}-${entry.tool_name}-${target(entry.input)}`} className="flex flex-col gap-1 px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-x-3 text-body text-ink">
                <time className="text-label text-faint" dateTime={new Date(entry.time * 1000).toISOString()}>
                  {new Date(entry.time * 1000).toLocaleString()}
                </time>
                <span className="font-medium">{entry.tool_name}</span>
                <span className="text-muted">{answers[entry.decision]}</span>
              </div>
              <code className="break-all font-mono text-label text-muted">{target(entry.input)}</code>
              {entry.reason && <p className="text-label text-muted">{entry.reason}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
