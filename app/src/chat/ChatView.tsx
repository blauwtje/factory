import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { motion } from "motion/react";
import { MessagesSquare, Sparkles } from "lucide-react";
import { useStickToBottomContext } from "use-stick-to-bottom";
import { Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton } from "@/components/ai/conversation";
import { Message, MessageContent } from "@/components/ai/message";
import { TextShimmer } from "@/components/motion/text-shimmer";
import { agentHistory, sendMessage } from "@/ipc";
import { ease } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { Composer } from "./Composer";
import { Markdown } from "./Markdown";
import { PermissionCard } from "./PermissionCard";
import { PlanCard, type PlanPhase } from "./PlanCard";
import { QuestionCard, questionsOf } from "./QuestionCard";
import { toRows, type Row } from "./rows";
import { ToolGroup, ToolRow } from "./ToolRow";
import { EMPTY_CHAT, reduce } from "./transcript";
import type { AgentEventPayload, AnswerLabel, ChatAction, ChatItem, ChatState, Decision, PermissionItem } from "./types";

type Answer = (id: string, decision: Decision, answer: AnswerLabel) => void;

const TOOL_ROWS = new Set<Row["kind"]>(["tool", "tools"]);

type View = ChatState & { live: boolean; past: number; loaded: boolean };

const EMPTY_VIEW: View = { ...EMPTY_CHAT, live: false, past: 0, loaded: false };

export type Focus = { agentId: string; text: string; seq: number; key: number };

const HIGHLIGHT_MS = 2000;

function step(view: View, action: ChatAction): View {
  const next = reduce(view, action);
  const past = action.type === "history" ? view.past + next.items.length - view.items.length : view.past;
  return { ...next, live: action.type !== "history", past, loaded: view.loaded || action.type === "history" };
}

function focusedKey(items: ChatItem[], past: number, focus: Focus): string | undefined {
  let best: { index: number; distance: number } | undefined;
  let position = 0;
  items.forEach((item, index) => {
    if (item.kind !== "user" && item.kind !== "assistant") return;
    const distance = Math.abs(position++ - focus.seq);
    if (item.text !== focus.text || (best && best.distance <= distance)) return;
    best = { index, distance };
  });
  return best && String(best.index - past);
}

function FocusScroll({ target, focus }: { target: RefObject<HTMLDivElement | null>; focus: Focus }) {
  const { stopScroll } = useStickToBottomContext();
  useEffect(() => {
    stopScroll();
    target.current?.scrollIntoView({ block: "center" });
  }, [focus.key, stopScroll, target]);
  return null;
}

const ENTER = { opacity: 0, y: 4 };

const senders = new Map<string, (text: string) => Promise<void>>();

export async function sendToAgent(agentId: string, text: string) {
  const send = senders.get(agentId);
  if (send) return send(text);
  await sendMessage(agentId, text);
}

function RowView({ row, planPhase, onAnswer, onComments }: { row: Row; planPhase?: PlanPhase; onAnswer: Answer; onComments?: (text: string) => void }) {
  if (row.kind === "user") {
    return (
      <Message from="user" className="max-w-[85%]">
        <MessageContent className="whitespace-pre-wrap text-prose [overflow-wrap:anywhere]">{row.text}</MessageContent>
      </Message>
    );
  }
  if (row.kind === "assistant") {
    return (
      <Message from="assistant" className="max-w-none">
        <Markdown streaming={row.item.streaming} className="text-prose text-ink">
          {row.item.text}
        </Markdown>
      </Message>
    );
  }
  if (row.kind === "tool") return <ToolRow item={row.item} />;
  if (row.kind === "tools") return <ToolGroup items={row.items} />;
  if (row.kind === "loop") {
    return (
      <p role="status" className="text-label text-approval-ink">
        Same {row.name} call {row.count} times in a row
      </p>
    );
  }
  if (row.kind === "compact") {
    return (
      <div role="separator" className="border-t border-line pt-2 text-center text-label text-ink-muted">
        Context compacted · {row.trigger} · {Math.round(row.pre_tokens / 1000)}k tokens before
      </div>
    );
  }
  if (row.kind === "plan") return <PlanCard tool={row.tool} message={row.message} previous={row.previous} phase={planPhase} onComments={onComments} />;
  const { request_id } = row.item;
  const questions = row.item.tool_name === "AskUserQuestion" ? questionsOf(row.item.input) : undefined;
  if (questions) return <QuestionCard item={row.item} questions={questions} onAnswer={(decision, answer) => onAnswer(request_id, decision, answer)} />;
  return <PermissionCard item={row.item} onAnswer={(decision, answer) => onAnswer(request_id, decision, answer)} />;
}

function busy(last: ChatItem | undefined): boolean {
  if (last?.kind === "assistant") return last.streaming;
  return last?.kind === "tool" && !last.result;
}

function Thinking() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15, delay: 0.2, ease: ease.out }}
      className="mt-5 flex h-8 items-center gap-2 text-label text-muted"
    >
      <Sparkles className="size-4 text-faint" aria-hidden />
      <TextShimmer>Thinking</TextShimmer>
    </motion.div>
  );
}

function EmptyChat() {
  return (
    <ConversationEmptyState
      icon={<MessagesSquare className="size-5" aria-hidden />}
      title="No messages yet"
      description="The agent's replies, tool calls and diffs appear here as it works. Send a message to steer it."
    />
  );
}

type ChatViewProps = {
  agentId: string;
  planPhase?: PlanPhase;
  composerTools?: ReactNode;
  aboveComposer?: ReactNode;
  focus?: Focus;
  project?: string | null;
};

export function ChatView({ agentId, planPhase, composerTools, aboveComposer, focus, project }: ChatViewProps) {
  const [{ items, status, queued, live, past, loaded }, dispatch] = useReducer(step, EMPTY_VIEW);
  const rows = toRows(items, past);
  const last = items.at(-1);
  const lastPlanKey = rows.filter((row) => row.kind === "plan").at(-1)?.key;
  const focused = loaded && focus ? focusedKey(items, past, focus) : undefined;
  const focusRef = useRef<HTMLDivElement>(null);
  const [expired, setExpired] = useState<number>();
  const lit = focus !== undefined && focused !== undefined && expired !== focus.key;
  const pending = items.find((item): item is PermissionItem => item.kind === "permission" && !item.answer);
  const blocked = pending && (pending.tool_name === "AskUserQuestion" ? "Answer the question above first" : "Allow or deny the request above first");
  const thinking = status === "working" && planPhase !== "review" && !busy(last);

  useEffect(() => {
    const unlisten = listen<AgentEventPayload>("agent-event", ({ payload }) => {
      if (payload.agent_id === agentId) dispatch({ type: "event", event: payload.event, at: Date.now() });
    });
    return () => void unlisten.then((stop) => stop());
  }, [agentId]);

  useEffect(() => {
    let current = true;
    agentHistory(agentId).then((turns) => current && dispatch({ type: "history", turns }), () => undefined);
    return () => {
      current = false;
    };
  }, [agentId]);

  useEffect(() => {
    if (!focus || !loaded) return;
    const timer = setTimeout(() => setExpired(focus.key), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [focus, loaded]);

  const send = useCallback(
    async (text: string) => {
      dispatch({ type: "user", text });
      await invoke("send_message", { agent_id: agentId, text });
    },
    [agentId],
  );

  useEffect(() => {
    senders.set(agentId, send);
    return () => void senders.delete(agentId);
  }, [agentId, send]);

  function stop() {
    dispatch({ type: "interrupted" });
    void invoke("interrupt_agent", { agent_id: agentId });
  }

  const answer = useCallback<Answer>(
    (request_id, decision, label) => {
      dispatch({ type: "answered", request_id, answer: label });
      void invoke("answer_permission", { agent_id: agentId, request_id, decision });
    },
    [agentId],
  );

  return (
    <div className="chat-flow flex h-full flex-col">
      <Conversation className="min-h-0" aria-busy={last?.kind === "assistant" && last.streaming}>
        {rows.length === 0 && !thinking ? (
          <EmptyChat />
        ) : (
          <ConversationContent className="chat-column gap-0 pt-6 pb-8">
            {rows.map((row, index) => (
              <motion.div
                key={row.key}
                ref={row.key === focused ? focusRef : undefined}
                data-focused={lit && row.key === focused ? "" : undefined}
                initial={live ? ENTER : false}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.16, ease: ease.out }}
                className={cn(index > 0 && (TOOL_ROWS.has(row.kind) && TOOL_ROWS.has(rows[index - 1].kind) ? "mt-0.5" : "mt-5"), lit && row.key === focused && "rounded-md bg-raised")}
              >
                <RowView row={row} planPhase={planPhase} onAnswer={answer} onComments={row.key === lastPlanKey ? send : undefined} />
              </motion.div>
            ))}
            {thinking && <Thinking />}
            {queued.map((text, index) => (
              <div key={index} className="mt-5">
                <RowView row={{ kind: "user", key: String(index), text }} onAnswer={answer} />
                <p className="mt-1 text-right text-label text-muted">Queued</p>
              </div>
            ))}
          </ConversationContent>
        )}
        {focus && focused !== undefined && <FocusScroll target={focusRef} focus={focus} />}
        <ConversationScrollButton />
      </Conversation>
      <div className="chat-column pb-5">
        {aboveComposer}
        <Composer working={status !== "idle"} blocked={blocked} tools={composerTools} project={project} onSend={send} onStop={stop} />
      </div>
    </div>
  );
}
