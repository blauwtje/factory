import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { ModelMenu } from "@/components/ai/model-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { listKinds, listRoles, listTools, resetKind, saveKind, saveRole, type Kind, type Role, type RoleInput } from "@/ipc";
import { AgentGlyph } from "@/job/look";
import { EFFORT_ITEMS, MODEL_ITEMS, type Choice } from "@/new-job/types";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "./ConfirmDialog";
import { cardClass, Panel, SavedNote } from "./parts";

export const NEW_ROLE: Role = { name: "", description: "", model: "claude-sonnet-5-5", effort: "medium", tools: ["Read", "Glob", "Grep"], prompt: "", origin: "custom" };
const FACTORY_TOOL = "mcp__factory__";

const toolLabel = (tool: string) => tool.replace(FACTORY_TOOL, "");
const inputOf = ({ name, description, model, effort, tools, prompt }: Role): RoleInput => ({ name, description, model, effort, tools, prompt });
const fingerprint = (role: RoleInput) => JSON.stringify([role.name, role.description, role.model, role.effort, [...role.tools].sort(), role.prompt]);

function ToolRack({ all, value, onChange }: { all: string[]; value: string[]; onChange: (tools: string[]) => void }) {
  const labelId = useId();
  const groups = [
    { title: "Claude Code", tools: all.filter((tool) => !tool.startsWith(FACTORY_TOOL)) },
    { title: "Factory", tools: all.filter((tool) => tool.startsWith(FACTORY_TOOL)) },
  ].filter(({ tools }) => tools.length > 0);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span id={labelId} className="text-label font-medium text-ink">
          Tools
        </span>
        <span className="text-caption tabular-nums text-muted">
          {value.length} of {all.length} on
        </span>
      </div>
      <ToggleGroup multiple aria-labelledby={labelId} value={value} onValueChange={(next: string[]) => onChange(all.filter((tool) => next.includes(tool)))} className="flex flex-col gap-3">
        {groups.map(({ title, tools }) => (
          <div key={title} className="flex flex-col gap-1.5">
            <span className="text-caption text-faint">{title}</span>
            <div className="flex flex-wrap gap-1.5">
              {tools.map((tool) => (
                <Toggle
                  key={tool}
                  value={tool}
                  title={tool}
                  className="h-7 rounded-md border border-dashed border-control px-2 font-mono text-label text-faint ui-focus transition-[background-color,border-color,color,scale] duration-(--duration-press) hover:border-muted hover:text-muted active:scale-(--press-scale) data-[pressed]:border-solid data-[pressed]:border-transparent data-[pressed]:bg-active data-[pressed]:text-ink"
                >
                  {toolLabel(tool)}
                </Toggle>
              ))}
            </div>
          </div>
        ))}
      </ToggleGroup>
    </div>
  );
}

type EditorProps = { role: Role; isNew: boolean; tools: string[]; taken: string[]; onSaved: (name: string) => Promise<void>; onReset: (name: string) => Promise<void> };

export function RoleEditor({ role, isNew, tools, taken, onSaved, onReset }: EditorProps) {
  const [base, setBase] = useState(role);
  const [draft, setDraft] = useState(() => inputOf(role));
  const [saves, setSaves] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const descriptionId = useId();
  const promptId = useId();
  if (base !== role) {
    setBase(role);
    setDraft(inputOf(role));
  }
  const all = [...tools, ...role.tools.filter((tool) => !tools.includes(tool))];
  const name = draft.name.trim();
  const nameTaken = isNew && taken.includes(name);
  const canSave = fingerprint(draft) !== fingerprint(role) && name !== "" && !nameTaken;
  const edit = (patch: Partial<RoleInput>) => setDraft((current) => ({ ...current, ...patch }));

  async function run(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError(String(reason));
    }
  }
  const save = () =>
    run(async () => {
      await saveRole({ ...draft, name });
      setSaves((count) => count + 1);
      await onSaved(name);
    });

  return (
    <div className={cn(cardClass, "flex min-w-0 flex-col p-0")}>
      <header className="flex items-center gap-3 border-b border-rule p-4">
        <AgentGlyph name={name || "new"} role={name} className="size-9 rounded-lg" />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {isNew ? (
            <Input aria-label="Name" aria-invalid={nameTaken || undefined} placeholder="agent-name" autoFocus value={draft.name} onChange={(event) => edit({ name: event.target.value })} className="max-w-60 font-mono" />
          ) : (
            <h4 className="truncate text-title font-medium text-ink">{role.name}</h4>
          )}
          {role.origin === "edited" && <Badge variant="secondary">Edited</Badge>}
          {role.origin === "custom" && !isNew && <Badge variant="outline">Custom</Badge>}
          {nameTaken && <span className="text-label text-failed-ink">That name is taken</span>}
        </div>
        {role.origin === "edited" && (
          <ConfirmDialog
            trigger={
              <Button variant="ghost" size="sm">
                <RotateCcw aria-hidden />
                Reset to default
              </Button>
            }
            title={`Reset ${role.name}?`}
            description="Your changes to this agent are removed and the built-in version comes back."
            action="Reset"
            onConfirm={() => run(() => onReset(role.name))}
          />
        )}
        {role.origin === "custom" && !isNew && (
          <ConfirmDialog
            trigger={
              <Button variant="ghost" size="sm">
                <Trash2 aria-hidden />
                Delete
              </Button>
            }
            title={`Delete ${role.name}?`}
            description="This agent and its instructions are removed. This cannot be undone."
            action="Delete"
            onConfirm={() => run(() => onReset(role.name))}
          />
        )}
      </header>
      <div className="flex flex-col gap-5 p-4">
        <div className="flex flex-col gap-2">
          <label htmlFor={descriptionId} className="text-label font-medium text-ink">
            Description
          </label>
          <Textarea id={descriptionId} placeholder="When the Orchestrator should pick this agent" value={draft.description} onChange={(event) => edit({ description: event.target.value })} className="min-h-0 text-pretty" />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-label font-medium text-ink">Model and effort</span>
          <ModelMenu model={draft.model} effort={draft.effort} models={MODEL_ITEMS} efforts={EFFORT_ITEMS} onChange={(next) => edit(next)} />
        </div>
        <ToolRack all={all} value={draft.tools} onChange={(next) => edit({ tools: next })} />
        <div className="flex flex-col gap-2">
          <label htmlFor={promptId} className="text-label font-medium text-ink">
            Instructions
          </label>
          <Textarea id={promptId} spellCheck={false} placeholder="What this agent does and how" value={draft.prompt} onChange={(event) => edit({ prompt: event.target.value })} className="min-h-48 max-h-[480px] overflow-y-auto font-mono text-note" />
        </div>
      </div>
      <footer className="sticky bottom-0 flex items-center justify-end gap-3 rounded-b-xl border-t border-rule bg-raised px-4 py-3">
        {error && (
          <span role="alert" className="mr-auto min-w-0 text-label text-failed-ink">
            {error}
          </span>
        )}
        <SavedNote value={saves} />
        <Button disabled={!canSave} onClick={save}>
          {isNew ? "Create agent" : "Save"}
        </Button>
      </footer>
    </div>
  );
}

function KindRow({ kind, roles, onSave, onReset }: { kind: Kind; roles: Choice[]; onSave: (kind: Omit<Kind, "edited">) => void; onReset: () => void }) {
  const value = { id: kind.id, role: kind.role, model: kind.model, effort: kind.effort };
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_10rem_11rem_1.75rem] items-center gap-3 px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-body capitalize text-ink">{kind.id}</span>
        {kind.edited && <Badge variant="secondary">Edited</Badge>}
        <SavedNote value={`${kind.role} ${kind.model} ${kind.effort}`} />
      </div>
      <Select items={roles} value={kind.role} onValueChange={(role) => role && onSave({ ...value, role })}>
        <SelectTrigger aria-label={`Agent for ${kind.id}`} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {roles.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex justify-end">
        <ModelMenu model={kind.model} effort={kind.effort} models={MODEL_ITEMS} efforts={EFFORT_ITEMS} onChange={(next) => onSave({ ...value, ...next })} />
      </div>
      {kind.edited && (
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Reset ${kind.id} to default`} onClick={onReset} />}>
            <RotateCcw />
          </TooltipTrigger>
          <TooltipContent>Reset to default</TooltipContent>
        </Tooltip>
      )}
    </li>
  );
}

export function TeamDefaults({ roles }: { roles: Role[] }) {
  const [kinds, setKinds] = useState<Kind[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    listKinds().then(setKinds, (reason) => setError(String(reason)));
  }, []);
  const run = (action: Promise<unknown>) =>
    action.then(listKinds).then(
      (next) => {
        setError(null);
        setKinds(next);
      },
      (reason) => setError(String(reason)),
    );
  const roleItems = roles.map(({ name }) => ({ value: name, label: name }));
  return (
    <Panel title="Team defaults" description="Which agent the Orchestrator starts for each kind of work, and on which model and effort.">
      {error && (
        <p role="alert" className="px-4 pt-3 text-label text-failed-ink">
          {error}
        </p>
      )}
      <ul aria-label="Team defaults" className="divide-y divide-rule">
        {kinds.map((kind) => (
          <KindRow key={kind.id} kind={kind} roles={roleItems} onSave={(next) => run(saveKind(next))} onReset={() => run(resetKind(kind.id))} />
        ))}
      </ul>
    </Panel>
  );
}

export function useRoles() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [tools, setTools] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([listRoles(), listTools()]).then(
      ([nextRoles, nextTools]) => {
        setRoles(nextRoles);
        setTools(nextTools);
      },
      (reason) => setError(String(reason)),
    );
  }, []);

  const reload = async () => setRoles(await listRoles());
  return { roles, tools, error, reload };
}
