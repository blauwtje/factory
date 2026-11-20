import type { ChatAction, ChatItem, ChatState, StreamEvent, TurnStatus } from "./types";

export const EMPTY_CHAT: ChatState = { items: [], status: "idle", queued: [] };

function settle(items: ChatItem[]): ChatItem[] {
  const last = items.at(-1);
  if (last?.kind !== "assistant" || !last.streaming) return items;
  return [...items.slice(0, -1), { ...last, streaming: false }];
}

function applyEvent(items: ChatItem[], event: StreamEvent, at: number): ChatItem[] {
  if ("TextDelta" in event) {
    const last = items.at(-1);
    if (last?.kind === "assistant" && last.streaming) {
      return [...items.slice(0, -1), { ...last, text: last.text + event.TextDelta.text }];
    }
    return [...items, { kind: "assistant", text: event.TextDelta.text, streaming: true }];
  }
  if ("Assistant" in event) {
    const last = items.at(-1);
    const done: ChatItem = { kind: "assistant", text: event.Assistant.content, streaming: false };
    if (last?.kind === "assistant" && last.streaming) return [...items.slice(0, -1), done];
    return [...items, done];
  }
  if ("ToolUse" in event) {
    const { id, name, input } = event.ToolUse;
    return [...settle(items), { kind: "tool", id, name, input, started_at: at }];
  }
  if ("ToolResult" in event) {
    const { id, output, is_error } = event.ToolResult;
    return items.map((item) =>
      item.kind === "tool" && item.id === id ? { ...item, result: { output, is_error, finished_at: at } } : item,
    );
  }
  if ("ControlRequest" in event) {
    const { request_id, tool_name, input, rules } = event.ControlRequest;
    return [...settle(items), { kind: "permission", request_id, tool_name, input, rules }];
  }
  if ("Compacted" in event) return [...settle(items), { kind: "compact", ...event.Compacted }];
  if ("Result" in event) return settle(items);
  return items;
}

function statusAfter(event: StreamEvent, status: TurnStatus): TurnStatus {
  if ("Result" in event) return "idle";
  if ("ControlRequest" in event) return "waiting";
  if ("Init" in event || "RateLimit" in event || "Tasks" in event || "Compacted" in event) return status;
  return "working";
}

export function reduce(state: ChatState, action: ChatAction): ChatState {
  if (action.type === "event") {
    const items = applyEvent(state.items, action.event, action.at);
    if ("Result" in action.event && state.queued.length > 0) {
      const sent = state.queued.map((text): ChatItem => ({ kind: "user", text }));
      return { items: [...items, ...sent], status: "working", queued: [] };
    }
    return { ...state, items, status: statusAfter(action.event, state.status) };
  }
  if (action.type === "history") {
    const past = action.turns.reduce<ChatItem[]>(
      (items, turn) => ("User" in turn ? [...settle(items), { kind: "user", text: turn.User.text }] : applyEvent(items, turn.Event, 0)),
      [],
    );
    const live = new Set(state.items.flatMap((item) => (item.kind === "permission" ? [item.request_id] : [])));
    const fresh = past.filter((item) => item.kind !== "permission" || !live.has(item.request_id));
    return { ...state, items: [...fresh, ...state.items] };
  }
  if (action.type === "user") {
    if (state.status !== "idle") return { ...state, queued: [...state.queued, action.text] };
    return { ...state, items: [...settle(state.items), { kind: "user", text: action.text }], status: "working" };
  }
  if (action.type === "interrupted") {
    const items = state.items.map((item) =>
      item.kind === "permission" && !item.answer ? { ...item, answer: "Denied" as const } : item,
    );
    return { ...state, items };
  }
  const items = state.items.map((item) =>
    item.kind === "permission" && item.request_id === action.request_id ? { ...item, answer: action.answer } : item,
  );
  return { ...state, items, status: "working" };
}
