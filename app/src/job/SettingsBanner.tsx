import { Info } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { onAgentEvent, setAgentModel, settingsChanged } from "@/ipc";
import type { AgentRow } from "./types";

export function SettingsBanner({ agent, onRestart }: { agent: AgentRow; onRestart: () => void }) {
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    const check = () => settingsChanged(agent.id).then(setChanged, () => setChanged(false));
    check();
    window.addEventListener("focus", check);
    const stop = onAgentEvent(({ agent_id, event }) => agent_id === agent.id && ("Init" in event || "Result" in event) && check());
    return () => {
      window.removeEventListener("focus", check);
      stop();
    };
  }, [agent.id]);

  if (!changed) return null;
  const restart = async () => {
    await setAgentModel(agent.id, agent.model, agent.effort);
    onRestart();
    setChanged(await settingsChanged(agent.id).catch(() => false));
  };
  return (
    <section aria-label="Settings changed" className="chat-column pt-2">
      <div className="flex items-center gap-2 rounded-md bg-raised/60 py-1 pr-1 pl-2.5 text-label text-muted">
        <Info aria-hidden className="size-3.5 shrink-0 text-faint" />
        <p className="min-w-0 flex-1 text-pretty">Settings changed since this agent started.</p>
        <Button variant="ghost" size="xs" className="shrink-0" disabled={agent.status === "running"} onClick={restart}>
          Restart
        </Button>
      </div>
    </section>
  );
}
