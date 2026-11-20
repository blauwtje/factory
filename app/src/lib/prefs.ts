import { useSyncExternalStore } from "react";
import type { Palette } from "./theme";

export type Theme = "system" | "light" | "dark";

export type UsageMode = "used" | "remaining";

export type SessionGroup = "none" | "project" | "status";

export type SessionSort = "started" | "active" | "needs_reply";

export type SessionWindow = 0 | 1 | 3 | 7 | 30;

type Prefs = {
  theme: Theme;
  palette: Palette;
  leadModel: string;
  leadEffort: string;
  leadPermissionMode: string;
  showUsage: boolean;
  usageMode: UsageMode;
  confirmMerge: boolean;
  activity: boolean;
  sessionGroup: SessionGroup;
  sessionSort: SessionSort;
  sessionWindow: SessionWindow;
  showArchived: boolean;
};

const storageKey = (key: keyof Prefs) => `factory.${key}`;

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  localStorage.setItem(storageKey(key), JSON.stringify(value));
  listeners.forEach((listener) => listener());
}

export function usePref<K extends keyof Prefs>(key: K, fallback: Prefs[K]) {
  const stored = useSyncExternalStore(subscribe, () => localStorage.getItem(storageKey(key)));
  const value = stored === null ? fallback : (JSON.parse(stored) as Prefs[K]);
  return [value, (next: Prefs[K]) => setPref(key, next)] as const;
}
