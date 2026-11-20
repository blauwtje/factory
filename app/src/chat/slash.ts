import type { CustomizeItem } from "@/ipc";

export const GROUPS = ["Skills", "Commands", "Agents", "Tools"] as const;
export type SlashGroup = (typeof GROUPS)[number];
export type SlashEntry = { id: string; name: string; label: string; insert: string; group: SlashGroup; description: string; plugin: string | null };

export const BUILT_IN: SlashEntry[] = [
  { id: "builtin:compact", name: "compact", label: "/compact", insert: "/compact ", group: "Commands", description: "Summarize the conversation to free up context", plugin: null },
];

const OPEN_SLASH = /(^|\s)\/([\w:.-]*)$/;

export function openSlash(text: string, cursor: number) {
  const match = OPEN_SLASH.exec(text.slice(0, cursor));
  if (!match) return null;
  const query = match[2];
  return { start: cursor - query.length - 1, query };
}

const GROUP_OF: Partial<Record<CustomizeItem["kind"], SlashGroup>> = { skill: "Skills", command: "Commands", agent: "Agents", mcp: "Tools" };

function entryOf({ id, name, description, plugin, kind }: CustomizeItem): SlashEntry {
  const group = GROUP_OF[kind]!;
  if (group === "Agents") return { id, name, label: `@agent-${name}`, insert: `@agent-${name} `, group, description, plugin };
  if (group === "Tools") return { id, name, label: name, insert: `Use the ${name} tools to `, group, description, plugin };
  return { id, name, label: `/${name}`, insert: `/${name} `, group, description, plugin };
}

export function slashEntries(items: readonly CustomizeItem[]): SlashEntry[] {
  const found = items.filter((item) => item.enabled && item.kind in GROUP_OF).map(entryOf);
  return [...BUILT_IN, ...found].filter(
    (entry, index, all) => all.findIndex((other) => other.group === entry.group && other.name === entry.name && other.plugin === entry.plugin) === index,
  );
}

export function filterSlash(entries: readonly SlashEntry[], query: string) {
  const needle = query.toLowerCase();
  const rank = (entry: SlashEntry) => {
    const name = entry.name.toLowerCase();
    if (name.startsWith(needle)) return 0;
    return name.includes(needle) ? 1 : 2;
  };
  return entries
    .filter((entry) => rank(entry) < 2)
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => GROUPS.indexOf(a.entry.group) - GROUPS.indexOf(b.entry.group) || rank(a.entry) - rank(b.entry) || a.index - b.index)
    .map(({ entry }) => entry);
}

export function completeSlash(text: string, start: number, cursor: number, insert: string) {
  return { text: text.slice(0, start) + insert + text.slice(cursor), cursor: start + insert.length };
}
