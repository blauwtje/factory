export type StreamEvent =
  | { Init: { session_id: string; api_key_source: string; model: string } }
  | { TextDelta: { text: string } }
  | { Assistant: { content: string } }
  | { ToolUse: { id: string; name: string; input: Record<string, unknown> } }
  | { ToolResult: { id: string; output: string; is_error: boolean } }
  | { RateLimit: { windows: Record<string, { utilization: number; resets_at: number }> } }
  | { ControlRequest: { request_id: string; tool_name: string; input: Record<string, unknown>; rules?: PermissionRule[] } }
  | { Tasks: { tasks: BackgroundTask[] } }
  | { Compacted: { trigger: string; pre_tokens: number } }
  | { Result: { session_id: string; outcome: "Finished" | "Failed" | "Stopped" } };

export type BackgroundTask = { task_id: string; task_type: string; description: string };

export type PermissionRule = { toolName: string; ruleContent?: string };

export type Turn = { User: { text: string } } | { Event: StreamEvent };

export type AgentEventPayload = { job_id: string; agent_id: string; event: StreamEvent };

export type Decision = "AllowOnce" | "AllowAlways" | { Deny: { reason: string } } | { Answer: { answers: Record<string, string> } };

export type AnswerLabel = "Allowed once" | "Always allowed" | "Denied" | "Answered";

export type ToolResult = { output: string; is_error: boolean; finished_at: number };

export type ChatItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; streaming: boolean }
  | { kind: "tool"; id: string; name: string; input: Record<string, unknown>; started_at: number; result?: ToolResult }
  | { kind: "compact"; trigger: string; pre_tokens: number }
  | { kind: "permission"; request_id: string; tool_name: string; input: Record<string, unknown>; rules?: PermissionRule[]; answer?: AnswerLabel };

export type ToolItem = Extract<ChatItem, { kind: "tool" }>;

export type PermissionItem = Extract<ChatItem, { kind: "permission" }>;

export type TurnStatus = "idle" | "working" | "waiting";

export type ChatState = { items: ChatItem[]; status: TurnStatus; queued: string[] };

export type ChatAction =
  | { type: "event"; event: StreamEvent; at: number }
  | { type: "user"; text: string }
  | { type: "history"; turns: Turn[] }
  | { type: "interrupted" }
  | { type: "answered"; request_id: string; answer: AnswerLabel };
