import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { Ban, Check, ChevronDown, FilePen, Hand, Map, ShieldAlert, ShieldQuestion, Sparkles, type LucideIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { ModelMenu } from "@/components/ai/model-menu";
import { Button } from "@/components/ui/button";
import { chipClass } from "@/components/ui/chip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { claudePermissionMode, permissionModes, setAgentModel, setPermissionMode } from "@/ipc";
import { cached, fetchCached } from "@/lib/cache";
import { EFFORT_ITEMS, MODEL_ITEMS } from "@/new-job/types";
import { cn } from "@/lib/utils";
import type { AgentRow } from "./types";

const KNOWN_MODES: Record<string, { label: string; hint: string; icon: LucideIcon; risky?: boolean }> = {
  manual: { label: "Manual", hint: "Every action asks first.", icon: Hand },
  acceptEdits: { label: "Accept edits", hint: "File edits go through; other actions still ask.", icon: FilePen },
  auto: { label: "Auto", hint: "Claude Code decides what needs your answer.", icon: Sparkles },
  plan: { label: "Plan", hint: "Reads and plans only, changes nothing.", icon: Map },
  dontAsk: { label: "Don't ask", hint: "Anything not already allowed is denied.", icon: Ban },
  bypassPermissions: { label: "Bypass permissions", hint: "Nothing asks. Only for a safe sandbox.", icon: ShieldAlert, risky: true },
};

const ORDER = Object.keys(KNOWN_MODES);

const rank = (id: string) => (ORDER.includes(id) ? ORDER.indexOf(id) : ORDER.length);

const humanise = (id: string) =>
  id
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

const labelOf = (id: string) => KNOWN_MODES[id]?.label ?? humanise(id);

const MODES = "permission-modes";

function PermissionOption({ id }: { id: string }) {
  const key = useId();
  const hint = KNOWN_MODES[id]?.hint;
  const risky = KNOWN_MODES[id]?.risky;
  const Icon = KNOWN_MODES[id]?.icon ?? ShieldQuestion;
  return (
    <Radio.Root
      value={id}
      aria-labelledby={`${key}-name`}
      aria-describedby={hint && `${key}-hint`}
      className={cn("group grid cursor-default grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 rounded-md px-2 py-1.5 text-left outline-none ui-focus-inset transition-colors duration-(--duration-press) hover:bg-active data-[checked]:bg-active", risky && "mt-1")}
    >
      <span aria-hidden className={cn("row-span-2 flex size-7 items-center justify-center rounded-md bg-raised text-muted group-data-[checked]:bg-surface group-data-[checked]:text-ink", risky && "bg-approval-soft text-approval-ink group-data-[checked]:bg-approval-soft group-data-[checked]:text-approval-ink")}>
        <Icon className="size-3.5" />
      </span>
      <span id={`${key}-name`} className={cn("text-body font-medium text-ink", risky && "text-approval-ink")}>
        {labelOf(id)}
      </span>
      <Check aria-hidden className="row-span-2 size-4 text-accent-text opacity-0 group-data-[checked]:opacity-100" />
      {hint && (
        <span id={`${key}-hint`} className="col-start-2 text-label text-muted">
          {hint}
        </span>
      )}
    </Radio.Root>
  );
}

export function PermissionMenu({ mode, title, onChange }: { mode: string; title: string; onChange: (mode: string) => void }) {
  const heading = useId();
  const [modes, setModes] = useState(() => cached<string[]>(MODES));
  const [claudeMode, setClaudeMode] = useState("");
  useEffect(() => {
    fetchCached(MODES, permissionModes).then(setModes, () => undefined);
    claudePermissionMode().then((next) => setClaudeMode(next ?? ""), () => undefined);
  }, []);
  if (!modes?.length) return null;
  const chosen = mode || claudeMode;
  const current = chosen === "" || chosen === "default" ? "manual" : chosen;
  const Icon = KNOWN_MODES[current]?.icon ?? ShieldQuestion;
  const risky = KNOWN_MODES[current]?.risky;
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="ghost" size="xs" aria-label={`Permissions, ${labelOf(current)}`} className={cn(chipClass, risky && "border-approval/40 bg-approval-soft text-approval-ink hover:bg-approval-soft hover:text-approval-ink data-[popup-open]:bg-approval-soft data-[popup-open]:text-approval-ink")} />}>
        <Icon aria-hidden className={cn("size-3.5", risky ? "text-approval-ink" : "text-muted")} />
        <span>{labelOf(current)}</span>
        <ChevronDown aria-hidden className="size-3 text-faint" />
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-[22rem] gap-0 p-1.5">
        <p id={heading} className="ui-overline px-2 pb-1 pt-1 text-faint">
          {title}
        </p>
        <RadioGroup aria-labelledby={heading} value={current} onValueChange={(next) => onChange(String(next))} className="flex flex-col gap-0.5">
          {[...modes].sort((a, b) => rank(a) - rank(b)).map((id) => (
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
