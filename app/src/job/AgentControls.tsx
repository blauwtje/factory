import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { ModelMenu } from "@/components/ai/model-menu";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { claudePermissionMode, permissionModes, setAgentModel, setPermissionMode } from "@/ipc";
import { EFFORT_ITEMS, MODEL_ITEMS } from "@/new-job/types";
import type { AgentRow } from "./types";

const KNOWN_MODES: Record<string, { label: string; hint: string }> = {
  acceptEdits: { label: "Accept edits", hint: "File edits go through; other actions still ask." },
  bypassPermissions: { label: "Bypass permissions", hint: "Nothing asks. Only for a safe sandbox." },
  dontAsk: { label: "Don't ask", hint: "Anything not already allowed is denied." },
  manual: { label: "Manual", hint: "Every action asks first." },
  auto: { label: "Auto", hint: "Claude Code decides what needs your answer." },
  plan: { label: "Plan", hint: "Reads and plans only, changes nothing." },
};

const humanise = (id: string) =>
  id
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

const labelOf = (id: string) => KNOWN_MODES[id]?.label ?? humanise(id);

let modesRequest: Promise<string[]> | undefined;

function loadModes() {
  modesRequest ??= permissionModes().catch((error) => {
    modesRequest = undefined;
    throw error;
  });
  return modesRequest;
}

function PermissionOption({ id }: { id: string }) {
  const key = useId();
  const hint = KNOWN_MODES[id]?.hint;
  return (
    <Radio.Root
      value={id}
      aria-labelledby={`${key}-name`}
      aria-describedby={hint && `${key}-hint`}
      className="group grid cursor-default grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-md px-2 py-1.5 text-left outline-none ui-focus-inset transition-colors duration-(--duration-press) hover:bg-active data-[checked]:bg-active"
    >
      <span id={`${key}-name`} className="text-body font-medium text-ink">
        {labelOf(id)}
      </span>
      <Check aria-hidden className="row-span-2 size-4 text-accent-text opacity-0 group-data-[checked]:opacity-100" />
      {hint && (
        <span id={`${key}-hint`} className="text-label text-muted">
          {hint}
        </span>
      )}
    </Radio.Root>
  );
}

export function PermissionMenu({ mode, title, onChange }: { mode: string; title: string; onChange: (mode: string) => void }) {
  const heading = useId();
  const [modes, setModes] = useState<string[]>();
  const [claudeMode, setClaudeMode] = useState("");
  useEffect(() => {
    loadModes().then(setModes, () => undefined);
    claudePermissionMode().then((next) => setClaudeMode(next ?? ""), () => undefined);
  }, []);
  if (!modes?.length) return null;
  const chosen = mode || claudeMode;
  const current = chosen === "" || chosen === "default" ? "manual" : chosen;
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="ghost" size="xs" aria-label={`Permissions, ${labelOf(current)}`} className="gap-1.5 rounded-full border border-edge bg-raised/60 px-2.5 text-ink" />}>
        <span>{labelOf(current)}</span>
        <ChevronDown aria-hidden className="size-3 text-faint" />
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-80 gap-0 p-1.5">
        <p id={heading} className="ui-overline px-2 pb-1 pt-1 text-faint">
          {title}
        </p>
        <RadioGroup aria-labelledby={heading} value={current} onValueChange={(next) => onChange(String(next))} className="flex flex-col gap-0.5">
          {modes.map((id) => (
            <PermissionOption key={id} id={id} />
          ))}
        </RadioGroup>
      </PopoverContent>
    </Popover>
  );
}

export function AgentControls({ agent, onChange }: { agent: AgentRow; onChange: () => void }) {
  const pick = async ({ model, effort }: { model: string; effort: string }) => {
    await setAgentModel(agent.id, model, effort);
    onChange();
  };
  const pickMode = async (mode: string) => {
    await setPermissionMode(agent.id, mode);
    onChange();
  };
  return (
    <div className="flex shrink-0 items-center gap-1">
      {agent.kind === "lead" && <PermissionMenu mode={agent.permission_mode} title="Permissions · this session" onChange={pickMode} />}
      <ModelMenu model={agent.model} effort={agent.effort} models={MODEL_ITEMS} efforts={EFFORT_ITEMS} onChange={pick} />
    </div>
  );
}
