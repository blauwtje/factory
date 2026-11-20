import { Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuGroup, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { deleteCustomizeItem, readCustomizeItem, saveCustomizeItem, type Customize, type CustomizeDraft, type CustomizeItem, type CustomizeKind, type CustomizeSaveRequest } from "@/ipc";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/settings/ConfirmDialog";
import { cardClass } from "@/settings/parts";
import { focusRow, ItemDetail, type Detail } from "./ItemBrowser";
import { KINDS } from "./kinds";

type EditKind = CustomizeSaveRequest["kind"];
type Scope = CustomizeSaveRequest["scope"];

const EDIT_KINDS: CustomizeKind[] = ["skill", "agent", "rule", "memory"];
export const canEdit = (kind: CustomizeKind): kind is EditKind => EDIT_KINDS.includes(kind);
type EditableItem = CustomizeItem & { kind: EditKind };
const editable = (item: CustomizeItem): item is EditableItem => (item.source === "user" || item.source === "project") && canEdit(item.kind);

const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SCOPE_LABELS: Record<Scope, string> = { user: "User", project: "This project" };

type Form = { name: string; description: string; paths: string; body: string };
type Editing = { kind: EditKind; scope: Scope; item: CustomizeItem | null; base: Form; form: Form };

const BLANK: Form = { name: "", description: "", paths: "", body: "" };
const formOf = (draft: CustomizeDraft): Form => ({ ...draft, paths: draft.paths.join(", ") });
const draftOf = (form: Form): CustomizeDraft => ({
  name: form.name.trim(),
  description: form.description,
  paths: form.paths
    .split(",")
    .map((glob) => glob.trim())
    .filter(Boolean),
  body: form.body,
});
const changed = ({ form, base }: Editing) => JSON.stringify(form) !== JSON.stringify(base);
const nameValid = ({ kind, form }: Editing) => kind === "memory" || NAME.test(form.name.trim());

type FieldProps = { label: string; hint?: string; error?: boolean; children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: true }) => ReactNode };

function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  const hintId = useId();
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-label font-medium text-ink">
        {label}
      </label>
      {children({ id, "aria-describedby": hint ? hintId : undefined, "aria-invalid": error || undefined })}
      {hint && (
        <p id={hintId} aria-live={error ? "polite" : undefined} className={cn("text-label", error ? "text-failed-ink" : "text-muted")}>
          {hint}
        </p>
      )}
    </div>
  );
}

type FormProps = { editing: Editing; error: string | null; onChange: (form: Form) => void; onSave: () => void; onCancel: () => void };

function ItemForm({ editing, error, onChange, onSave, onCancel }: FormProps) {
  const { kind, scope, item, form } = editing;
  const valid = nameValid(editing);
  const canSave = valid && changed(editing);
  const edit = (patch: Partial<Form>) => onChange({ ...form, ...patch });

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    } else if (event.key === "s" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (canSave) onSave();
    }
  }

  return (
    <form
      onKeyDown={onKeyDown}
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave) onSave();
      }}
      className={cn(cardClass, "flex min-w-0 flex-col p-0")}
    >
      <header className="flex items-center gap-2 border-b border-rule p-4">
        <h4 className="min-w-0 truncate text-title font-medium text-ink">{item ? `Edit ${item.name}` : `New ${KINDS[kind].noun.toLowerCase()}`}</h4>
        <Badge variant="outline">{SCOPE_LABELS[scope]}</Badge>
      </header>
      <div className="flex flex-col gap-5 p-4">
        {kind !== "memory" && (
          <Field label="Name" hint="Lowercase letters, digits and hyphens, up to 64." error={form.name !== "" && !valid}>
            {(props) => <Input {...props} autoFocus spellCheck={false} autoComplete="off" value={form.name} onChange={(event) => edit({ name: event.target.value })} className="font-mono" />}
          </Field>
        )}
        {kind !== "memory" && (
          <Field label="Description">
            {(props) => <Textarea {...props} value={form.description} onChange={(event) => edit({ description: event.target.value })} className="min-h-0 text-pretty" />}
          </Field>
        )}
        {kind === "rule" && (
          <Field label="Paths" hint="Comma separated globs. Empty loads the rule in every session.">
            {(props) => <Input {...props} spellCheck={false} placeholder="src/**/*.ts, docs/*.md" value={form.paths} onChange={(event) => edit({ paths: event.target.value })} className="font-mono" />}
          </Field>
        )}
        <Field label="Body">
          {(props) => <Textarea {...props} autoFocus={kind === "memory"} spellCheck={false} value={form.body} onChange={(event) => edit({ body: event.target.value })} className="min-h-48 font-mono text-note" />}
        </Field>
      </div>
      <footer className="sticky bottom-0 flex items-center justify-end gap-2 rounded-b-xl border-t border-rule bg-raised px-4 py-3">
        {error && (
          <span role="alert" className="mr-auto min-w-0 text-label text-failed-ink">
            {error}
          </span>
        )}
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canSave}>
          Save
        </Button>
      </footer>
    </form>
  );
}

function DiscardDialog({ open, onKeep, onDiscard }: { open: boolean; onKeep: () => void; onDiscard: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onKeep()}>
      <DialogContent>
        <DialogTitle className="mb-2">Discard changes?</DialogTitle>
        <p className="text-body text-pretty text-muted">Your edits are not saved.</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onKeep}>
            Keep editing
          </Button>
          <Button variant="destructive" onClick={onDiscard}>
            Discard
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type Places = { kind: CustomizeKind; project: string | null; extra?: ReactNode; onNew: (scope: Scope) => void };

export function NewMenu({ kind, project, extra, onNew }: Places) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
        <Plus aria-hidden />
        New {KINDS[kind].noun.toLowerCase()}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Save in</DropdownMenuLabel>
          {extra}
          <DropdownMenuItem onClick={() => onNew("user")}>{SCOPE_LABELS.user}</DropdownMenuItem>
          <DropdownMenuItem disabled={!project} onClick={() => onNew("project")}>
            {SCOPE_LABELS.project}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

let leaveGuard: ((then: () => void) => void) | null = null;
export const guardLeave = (then: () => void) => (leaveGuard ? leaveGuard(then) : then());

export function useItemEditor(project: string | null, reload: () => Promise<Customize | void>) {
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [leaving, setLeaving] = useState<(() => void) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const focusNext = useRef<string | null>(null);
  const saving = useRef(false);
  const unsaved = editing !== null && changed(editing);

  useEffect(() => {
    if (!unsaved) return;
    leaveGuard = (then) => setLeaving(() => then);
    return () => {
      leaveGuard = null;
    };
  }, [unsaved]);

  useEffect(() => {
    if (focusNext.current && focusRow(focusNext.current)) focusNext.current = null;
  });

  const leave = (then: () => void) => (editing && changed(editing) ? setLeaving(() => then) : then());
  const close = (id: string | null) => {
    setEditing(null);
    setError(null);
    setSelected(id);
    focusNext.current = id;
  };

  const select = (id: string | null) =>
    leave(() => {
      setEditing(null);
      setError(null);
      setSelected(id);
    });

  const startNew = (kind: EditKind, scope: Scope) =>
    leave(() => {
      setError(null);
      setSelected(null);
      setEditing({ kind, scope, item: null, base: BLANK, form: BLANK });
    });

  async function run(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError(String(reason));
    }
  }

  const startEdit = (item: EditableItem) =>
    run(async () => {
      const form = formOf(await readCustomizeItem(item.path));
      setEditing({ kind: item.kind, scope: item.source === "project" ? "project" : "user", item, base: form, form });
    });

  const save = async (target: Editing) => {
    if (saving.current) return;
    saving.current = true;
    await run(async () => {
      const written = await saveCustomizeItem({ kind: target.kind, scope: target.scope, project, original_path: target.item?.path ?? null, draft: draftOf(target.form) });
      const next = await reload();
      close(next?.items.find((entry) => entry.path === written)?.id ?? null);
    });
    saving.current = false;
  };

  const remove = (item: CustomizeItem) =>
    run(async () => {
      await deleteCustomizeItem(item.path);
      await reload();
      setSelected(null);
    });

  const actions = (item: CustomizeItem) => {
    if (!editable(item)) return null;
    return (
      <>
        <Button variant="outline" size="sm" onClick={() => startEdit(item)}>
          <Pencil aria-hidden />
          Edit
        </Button>
        <ConfirmDialog
          trigger={
            <Button variant="ghost" size="sm">
              <Trash2 aria-hidden />
              Delete
            </Button>
          }
          title={`Move ${item.name} to the Trash?`}
          description="Claude no longer loads it. You can put it back from the Trash."
          action="Move to Trash"
          onConfirm={() => remove(item)}
        />
      </>
    );
  };

  const detail = (item: CustomizeItem | undefined): Detail | null => {
    if (editing) {
      return {
        label: editing.item ? editing.item.name : `New ${KINDS[editing.kind].noun.toLowerCase()}`,
        wide: true,
        content: <ItemForm editing={editing} error={error} onChange={(form) => setEditing({ ...editing, form })} onSave={() => save(editing)} onCancel={() => leave(() => close(editing.item?.id ?? null))} />,
      };
    }
    if (!item) return null;
    return { label: item.name, content: <ItemDetail item={item} actions={actions(item)} error={error} /> };
  };

  const dialog = (
    <DiscardDialog
      open={leaving !== null}
      onKeep={() => setLeaving(null)}
      onDiscard={() => {
        setLeaving(null);
        leaving?.();
      }}
    />
  );

  return { selected, select, startNew, detail, dialog };
}
