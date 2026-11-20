import { AlertDialog } from "@base-ui/react/alert-dialog";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { dialogPopup } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Props = { trigger: ReactElement; title: string; description: string; action: string; onConfirm: () => void };

export function ConfirmDialog({ trigger, title, description, action, onConfirm }: Props) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger render={trigger} />
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="ui-backdrop fixed inset-0 bg-ink/15 dark:bg-black/50" />
        <AlertDialog.Popup className={cn(dialogPopup, "flex flex-col gap-2")}>
          <AlertDialog.Title className="text-title font-medium text-ink">{title}</AlertDialog.Title>
          <AlertDialog.Description className="text-body text-pretty text-muted">{description}</AlertDialog.Description>
          <div className="mt-4 flex justify-end gap-2">
            <AlertDialog.Close render={<Button variant="ghost" />}>Cancel</AlertDialog.Close>
            <AlertDialog.Close render={<Button variant="destructive" onClick={onConfirm} />}>{action}</AlertDialog.Close>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
