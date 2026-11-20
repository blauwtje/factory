import type { CustomizeItem, CustomizeKind, CustomizeSource, ScanVerdict } from "@/ipc";
import type { SettingsSection } from "@/shell/types";
import { relativeTime } from "@/shell/time";
import { formatTokens } from "@/stats/format";

type KindInfo = { section: SettingsSection; noun: string; color: string | null; description: string };

export const KINDS: Record<CustomizeKind, KindInfo> = {
  plugin: { section: "plugins", noun: "Plugin", color: null, description: "Bundles of skills, agents, commands, hooks and MCP servers. A plugin's numbers are the sum of its parts." },
  skill: { section: "skills", noun: "Skill", color: "var(--chart-3)", description: "Know-how an agent loads when a task calls for it, and commands you start with a slash. Until then only the name and description sit in the context." },
  agent: { section: "agents", noun: "Agent", color: "var(--chart-4)", description: "Subagents Claude can start. Plugin agents are read-only; the others can be edited here." },
  mcp: { section: "mcp", noun: "MCP server", color: "var(--chart-5)", description: "Servers whose tools Claude can call. Their tool schemas load at session start." },
  hook: { section: "hooks", noun: "Hook", color: "var(--faint)", description: "Commands Claude Code runs on an event. They take no context unless they print to it." },
  rule: { section: "rules", noun: "Rule", color: "var(--chart-2)", description: "Instructions that load at session start, or once an agent touches files that match." },
  memory: { section: "memory", noun: "Memory", color: "var(--chart-1)", description: "CLAUDE.md files every session loads in full." },
  command: { section: "skills", noun: "Command", color: "var(--chart-other)", description: "Prompts you start with a slash. Only their descriptions load at session start." },
};

export const KIND_ORDER = Object.keys(KINDS) as CustomizeKind[];

export const kindOf = (section: SettingsSection) => KIND_ORDER.find((kind) => KINDS[kind].section === section);

export const PAGE_KINDS = KIND_ORDER.filter((kind) => kindOf(KINDS[kind].section) === kind);

export const inSection = (items: CustomizeItem[], section: SettingsSection) => items.filter((item) => KINDS[item.kind].section === section);

const SOURCE_LABELS: Record<CustomizeSource, string> = { factory: "Factory", user: "User", project: "Project", plugin: "Plugin" };

export const VERDICT_LABELS: Record<Exclude<ScanVerdict, "pass">, string> = { review: "Review", risk: "Risk" };

export const sourceLabel = (item: CustomizeItem) => (item.source === "plugin" && item.plugin ? item.plugin : SOURCE_LABELS[item.source]);

export const inContext = (items: CustomizeItem[]) => items.filter((item) => item.kind !== "plugin");

export function tokenText(value: number | null, exact: boolean) {
  if (value === null) return "—";
  if (value === 0 || exact) return formatTokens(value);
  return `~${formatTokens(value)}`;
}

export const lastUsedText = (lastUsed: string | null) => (lastUsed ? relativeTime(Date.parse(lastUsed) / 1000) : "Never");
