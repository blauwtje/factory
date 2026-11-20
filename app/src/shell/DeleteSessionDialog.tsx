import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Button } from "@/components/ui/button";
import { dialogPopup } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Props = { title: string; open: boolean; onOpenChange: (open: boolean) => void; onConfirm: () => void };

export function DeleteSessionDialog({ title, open, onOpenChange, onConfirm }: Props) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="ui-backdrop fixed inset-0 bg-ink/15 dark:bg-black/50" />
        <AlertDialog.Popup className={cn(dialogPopup, "flex flex-col gap-2")}>
          <AlertDialog.Title className="text-title font-medium text-ink">Delete this session?</AlertDialog.Title>
          <AlertDialog.Description className="text-body text-muted text-pretty">
            “{title}” and its worktree and branch will be removed. This cannot be undone.
          </AlertDialog.Description>
          <div className="mt-4 flex justify-end gap-2">
            <AlertDialog.Close render={<Button variant="ghost" />}>Cancel</AlertDialog.Close>
            <Button variant="destructive" onClick={onConfirm}>
              Delete
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
