import type { ChatItem, PermissionItem, ToolItem } from "./types";

export const PLAN_TOOL = "mcp__factory__plan_ready";

type AssistantItem = Extract<ChatItem, { kind: "assistant" }>;

export type Row =
  | { kind: "user"; key: string; text: string }
  | { kind: "assistant"; key: string; item: AssistantItem }
  | { kind: "tool"; key: string; item: ToolItem }
  | { kind: "tools"; key: string; items: ToolItem[] }
  | { kind: "plan"; key: string; tool: ToolItem; message?: AssistantItem; previous?: string }
  | { kind: "permission"; key: string; item: PermissionItem }
  | { kind: "compact"; key: string; trigger: string; pre_tokens: number }
  | { kind: "loop"; key: string; name: string; count: number };

export const LOOP_THRESHOLD = 3;

const UNGROUPED_TOOLS = new Set([PLAN_TOOL, "Task", "Agent", "TodoWrite"]);

const isGrouped = (item: ChatItem | undefined): item is ToolItem => item?.kind === "tool" && !UNGROUPED_TOOLS.has(item.name);

function loopEnds(items: ChatItem[]): Map<number, { name: string; count: number }> {
  const ends = new Map<number, { name: string; count: number }>();
  let run = { signature: "", count: 0, last: -1 };
  const close = () => {
    const item = items[run.last];
    if (run.count >= LOOP_THRESHOLD && item?.kind === "tool") ends.set(run.last, { name: item.name, count: run.count });
  };
  items.forEach((item, index) => {
    if (item.kind === "assistant") return;
    const signature = item.kind === "tool" ? JSON.stringify([item.name, item.input]) : "";
    if (signature && signature === run.signature) {
      run = { signature, count: run.count + 1, last: index };
      return;
    }
    close();
    run = { signature, count: signature ? 1 : 0, last: signature ? index : -1 };
  });
  close();
  return ends;
}

export function toRows(items: ChatItem[], past: number): Row[] {
  const rows: Row[] = [];
  const ends = loopEnds(items);
  let previous: string | undefined;
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const first = index;
    const key = String(index - past);
    if (item.kind === "user") rows.push({ kind: "user", key, text: item.text });
    else if (item.kind === "assistant") rows.push({ kind: "assistant", key, item });
    else if (item.kind === "compact") rows.push({ kind: "compact", key: `compact-${key}`, trigger: item.trigger, pre_tokens: item.pre_tokens });
    else if (item.kind === "permission") rows.push({ kind: "permission", key: item.request_id, item });
    else if (item.name === PLAN_TOOL) {
      const next = items[index + 1];
      const message = next?.kind === "assistant" ? next : undefined;
      if (message) index++;
      rows.push({ kind: "plan", key: item.id, tool: item, message, previous });
      if (message) previous = message.text;
    } else if (isGrouped(items[index + 1])) {
      const calls: ToolItem[] = [];
      while (isGrouped(items[index])) calls.push(items[index++] as ToolItem);
      index--;
      rows.push({ kind: "tools", key: item.id, items: calls });
    } else rows.push({ kind: "tool", key: item.id, item });
    for (let at = first; at <= index; at++) {
      const end = ends.get(at);
      if (end) rows.push({ kind: "loop", key: `loop-${(items[at] as ToolItem).id}`, ...end });
    }
  }
  return rows;
}

export type PlanText = { intro: string; steps: string[]; outro: string };

const STEP = /^\s*\d+[.)]\s+(.*)$/;

export function splitPlan(text: string): PlanText {
  const lines = text.split("\n");
  const first = lines.findIndex((line) => STEP.test(line));
  if (first === -1) return { intro: text.trim(), steps: [], outro: "" };
  let last = first;
  while (last + 1 < lines.length && (STEP.test(lines[last + 1]) || /^\s+\S/.test(lines[last + 1]))) last++;
  const steps: string[] = [];
  for (const line of lines.slice(first, last + 1)) {
    const match = STEP.exec(line);
    if (match) steps.push(match[1]);
    else steps[steps.length - 1] += ` ${line.trim()}`;
  }
  return { intro: lines.slice(0, first).join("\n").trim(), steps, outro: lines.slice(last + 1).join("\n").trim() };
}
