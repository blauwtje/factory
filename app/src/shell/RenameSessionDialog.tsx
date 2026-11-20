import { Dialog } from "@base-ui/react/dialog";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { dialogPopup } from "@/components/ui/dialog";

type Props = { title: string; open: boolean; onOpenChange: (open: boolean) => void; onConfirm: (title: string) => void };

function RenameForm({ title, onConfirm }: Pick<Props, "title" | "onConfirm">) {
  const [value, setValue] = useState(title);
  const blank = value.trim() === "";
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!blank) onConfirm(value);
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <Dialog.Title className="text-title font-medium text-ink">Rename session</Dialog.Title>
      <label htmlFor="rename-session-title" className="text-label font-medium text-muted">
        Title
      </label>
      <Input id="rename-session-title" autoFocus value={value} onChange={(event) => setValue(event.target.value)} onFocus={(event) => event.target.select()} />
      <div className="mt-4 flex justify-end gap-2">
        <Dialog.Close render={<Button type="button" variant="ghost" />}>Cancel</Dialog.Close>
        <Button type="submit" disabled={blank}>
          Save
        </Button>
      </div>
    </form>
  );
}

export function RenameSessionDialog({ title, open, onOpenChange, onConfirm }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="ui-backdrop fixed inset-0 bg-ink/15 dark:bg-black/50" />
        <Dialog.Popup className={dialogPopup}>
          <RenameForm title={title} onConfirm={onConfirm} />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
