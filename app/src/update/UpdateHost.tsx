import { sendNotification } from "@tauri-apps/plugin-notification";
import { useEffect } from "react";
import { toast } from "sonner";
import { granted } from "@/shell/notices";
import { WhatsNewDialog } from "./WhatsNewDialog";
import { CHECK_EVERY_MS, checkForUpdate, installUpdate, restartNow, setWhatsNew, useUpdateState } from "./store";

const TOAST_ID = "update";

function useUpdateToast() {
  const state = useUpdateState();
  useEffect(() => {
    if (state.kind === "available") {
      const { update } = state;
      toast(`Factory ${update.version} is available`, {
        id: TOAST_ID,
        duration: Infinity,
        action: { label: `Update to ${update.version}`, onClick: () => void installUpdate(update) },
        cancel: { label: "What's new", onClick: () => setWhatsNew(true) },
      });
    } else if (state.kind === "downloading") {
      toast.loading(state.percent === null ? "Downloading update" : `Downloading update ${state.percent}%`, { id: TOAST_ID, duration: Infinity });
    } else if (state.kind === "waiting") {
      toast.loading("Restarting when agents finish", {
        id: TOAST_ID,
        duration: Infinity,
        action: { label: "Restart now", onClick: restartNow },
      });
    } else if (state.kind === "error") {
      toast.dismiss(TOAST_ID);
    }
  }, [state]);
}

export function UpdateHost() {
  useUpdateToast();
  useEffect(() => {
    let notified = "";
    const run = async () => {
      const update = await checkForUpdate();
      if (update && update.version !== notified && (await granted().catch(() => false))) {
        notified = update.version;
        sendNotification({ title: "Update available", body: `Factory ${update.version} is ready to install` });
      }
    };
    void run();
    const timer = setInterval(() => void run(), CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, []);
  return <WhatsNewDialog />;
}
