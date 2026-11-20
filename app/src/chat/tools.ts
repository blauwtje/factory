import type { ToolItem } from "./types";

export type ToolKind = { running: string; done: string; target: string };

const KINDS: Record<string, ToolKind> = {
  Bash: { running: "Running", done: "Ran", target: "command" },
  Read: { running: "Reading", done: "Read", target: "file_path" },
  Edit: { running: "Editing", done: "Edited", target: "file_path" },
  MultiEdit: { running: "Editing", done: "Edited", target: "file_path" },
  Write: { running: "Writing", done: "Wrote", target: "file_path" },
  Grep: { running: "Searching for", done: "Searched for", target: "pattern" },
  Glob: { running: "Finding", done: "Found", target: "pattern" },
  WebFetch: { running: "Fetching", done: "Fetched", target: "url" },
  WebSearch: { running: "Searching the web for", done: "Searched the web for", target: "query" },
  Task: { running: "Running subagent", done: "Ran subagent", target: "description" },
  Agent: { running: "Running subagent", done: "Ran subagent", target: "description" },
  TodoWrite: { running: "Updating the todo list", done: "Updated the todo list", target: "" },
  mcp__factory__spawn_agent: { running: "Starting agent", done: "Started agent", target: "name" },
  mcp__factory__send_to_agent: { running: "Messaging", done: "Messaged", target: "name" },
  mcp__factory__set_agent_model: { running: "Changing the model of", done: "Changed the model of", target: "name" },
  mcp__factory__list_agents: { running: "Listing agents", done: "Listed agents", target: "" },
  mcp__factory__read_agent: { running: "Reading the result of", done: "Read the result of", target: "name" },
};

export function readableName(name: string): string {
  return name.replace(/^mcp__\w+?__/, "").replaceAll("_", " ");
}

export function toolKind(name: string): ToolKind {
  return KINDS[name] ?? { running: `Using ${readableName(name)}`, done: `Used ${readableName(name)}`, target: "" };
}

export function inputText(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value : "";
}

export function toolTarget(item: ToolItem): string {
  return inputText(item.input, toolKind(item.name).target);
}

const COPY_LABELS: Record<string, string> = { command: "Copy command", file_path: "Copy path" };

export function copyLabel(item: ToolItem): string | undefined {
  return toolTarget(item) ? COPY_LABELS[toolKind(item.name).target] : undefined;
}

export type ToolState = "running" | "done" | "failed";

export function toolState(item: ToolItem): ToolState {
  if (!item.result) return "running";
  return item.result.is_error ? "failed" : "done";
}

export function formatDuration(ms: number): string | undefined {
  if (ms < 1000) return undefined;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function toolDuration(item: ToolItem): string | undefined {
  return item.result && formatDuration(item.result.finished_at - item.started_at);
}

export type ToolCategory = "read" | "search" | "run" | "edit" | "other";

const CATEGORIES: Record<string, ToolCategory> = {
  Read: "read",
  Grep: "search",
  Glob: "search",
  WebSearch: "search",
  WebFetch: "search",
  Bash: "run",
  Edit: "edit",
  MultiEdit: "edit",
  Write: "edit",
};

const CATEGORY_ORDER: ToolCategory[] = ["read", "search", "run", "edit", "other"];

const PHRASES: Record<ToolCategory, { running: string; done: string; one: string; many: string }> = {
  read: { running: "reading", done: "read", one: "file", many: "files" },
  search: { running: "searching", done: "searched", one: "time", many: "times" },
  run: { running: "running", done: "ran", one: "command", many: "commands" },
  edit: { running: "editing", done: "edited", one: "file", many: "files" },
  other: { running: "making", done: "made", one: "other call", many: "other calls" },
};

export type SummaryPart = { verb: string; rest: string };

export function summaryParts(items: ToolItem[]): SummaryPart[] {
  const counts = new Map<ToolCategory, number>();
  const running = items.some((item) => !item.result);
  for (const item of items) {
    const category = CATEGORIES[item.name] ?? "other";
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  const parts = CATEGORY_ORDER.filter((category) => counts.has(category)).map((category) => {
    const count = counts.get(category) ?? 0;
    const phrase = PHRASES[category];
    return { verb: running ? phrase.running : phrase.done, rest: `${count} ${count === 1 ? phrase.one : phrase.many}` };
  });
  parts[0] = { ...parts[0], verb: parts[0].verb[0].toUpperCase() + parts[0].verb.slice(1) };
  return parts;
}

export function errorLine(item: ToolItem): string | undefined {
  if (!item.result?.is_error) return undefined;
  return item.result.output.split("\n").find((line) => line.trim())?.trim() ?? "Failed";
}
