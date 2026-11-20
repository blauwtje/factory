import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useSyncExternalStore } from "react";
import { restartAction } from "./gate";

export const RELEASES_URL = "https://github.com/blauwtje/factory/releases";
export const releaseUrl = (version: string) => `${RELEASES_URL}/tag/v${version}`;

export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const IDLE_POLL_MS = 3000;

export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current" }
  | { kind: "available"; update: Update }
  | { kind: "downloading"; update: Update; percent: number | null }
  | { kind: "waiting"; update: Update }
  | { kind: "error"; message: string };

let state: UpdateState = { kind: "idle" };
let whatsNew = false;
const listeners = new Set<() => void>();

function set(next: UpdateState) {
  state = next;
  listeners.forEach((listener) => listener());
}

export const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const useUpdateState = () => useSyncExternalStore(subscribe, () => state);

export const getState = () => state;
export const isWhatsNewOpen = () => whatsNew;
export function setWhatsNew(open: boolean) {
  whatsNew = open;
  listeners.forEach((listener) => listener());
}
export const useWhatsNew = () => useSyncExternalStore(subscribe, isWhatsNewOpen);

export async function checkForUpdate(): Promise<Update | null> {
  if (state.kind === "downloading" || state.kind === "waiting") return null;
  if (state.kind !== "available") set({ kind: "checking" });
  try {
    const update = await check();
    set(update ? { kind: "available", update } : { kind: "current" });
    return update;
  } catch (reason) {
    set({ kind: "error", message: String(reason) });
    return null;
  }
}

export async function installUpdate(update: Update) {
  let total = 0;
  let received = 0;
  set({ kind: "downloading", update, percent: null });
  try {
    await update.download((event) => {
      if (event.event === "Started") total = event.data.contentLength ?? 0;
      if (event.event === "Progress") received += event.data.chunkLength;
      set({ kind: "downloading", update, percent: total ? Math.min(100, Math.round((received / total) * 100)) : null });
    });
  } catch (reason) {
    set({ kind: "error", message: String(reason) });
    return;
  }
  set({ kind: "waiting", update });
  await restartWhenIdle(update);
}

let restartNowRequested = false;
export const restartNow = () => {
  restartNowRequested = true;
};

async function restartWhenIdle(update: Update) {
  for (;;) {
    const idle = await invoke<boolean>("agents_idle").catch(() => false);
    const focused = restartNowRequested || (await getCurrentWindow().isFocused().catch(() => false));
    if (restartAction({ installed: true, idle, focused }) === "restart") {
      await update.install();
      return relaunch();
    }
    await new Promise((resolve) => setTimeout(resolve, IDLE_POLL_MS));
  }
}
