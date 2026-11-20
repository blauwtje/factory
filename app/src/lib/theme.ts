import { useSyncExternalStore } from "react";
import { usePref } from "./prefs";

export type Scheme = "light" | "dark";

export const PALETTES = [
  { id: "graphite", label: "Blue" },
  { id: "moss", label: "Green" },
  { id: "tide", label: "Teal" },
  { id: "oxide", label: "Red" },
  { id: "mono", label: "Gray" },
] as const;

export type Palette = (typeof PALETTES)[number]["id"];

const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

function subscribe(listener: () => void) {
  const query = darkQuery();
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

export function useScheme(): Scheme {
  const [theme] = usePref("theme", "system");
  const system = useSyncExternalStore(subscribe, () => (darkQuery().matches ? "dark" : "light"));
  return theme === "system" ? system : theme;
}
