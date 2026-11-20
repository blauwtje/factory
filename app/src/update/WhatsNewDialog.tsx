import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink } from "lucide-react";
import { Markdown } from "@/chat/Markdown";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { installUpdate, releaseUrl, setWhatsNew, useUpdateState, useWhatsNew } from "./store";

export function WhatsNewDialog() {
  const open = useWhatsNew();
  const state = useUpdateState();
  if (!("update" in state)) return null;
  const { update } = state;
  return (
    <Dialog open={open} onOpenChange={setWhatsNew}>
      <DialogContent className="max-w-[min(36rem,calc(100vw-2rem))]">
        <DialogTitle>What&apos;s new in {update.version}</DialogTitle>
        <div className="max-h-96 overflow-y-auto text-body">
          <Markdown>{update.body || "No release notes."}</Markdown>
        </div>
        <div className="mt-5 flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => void openUrl(releaseUrl(update.version)).catch(() => undefined)}>
            <ExternalLink className="size-3.5" />
            Release page
          </Button>
          {state.kind === "available" && (
            <Button
              onClick={() => {
                setWhatsNew(false);
                void installUpdate(update);
              }}
            >
              Update to {update.version}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
