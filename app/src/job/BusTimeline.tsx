import { useEffect, useRef, useState } from "react";
import { edgeFade, useScrollEdges } from "./look";
import { relativeTime } from "./summary";
import type { AgentRow, BusMessage } from "./types";

function useNow(interval: number) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(timer);
  }, [interval]);
  return now;
}

function useFollow(count: number) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [count]);
  return ref;
}

function Event({ message, sender, related, now, onSelect }: { message: BusMessage; sender?: AgentRow; related?: AgentRow; now: number; onSelect: (id: string) => void }) {
  const jumpTo = related ?? sender;
  const name = sender?.name ?? "agent";
  return (
    <li>
      <button
        type="button"
        disabled={!jumpTo}
        onClick={() => jumpTo && onSelect(jumpTo.id)}
        className="flex w-full cursor-pointer items-baseline gap-3 rounded-md px-2 py-1 text-left text-label ui-focus-inset transition-colors duration-(--duration-press) hover:bg-active/60 disabled:pointer-events-none"
      >
        <span title={`${name} ${message.label}`} className="min-w-0 truncate text-muted">
          <span className="text-ink">{name}</span> {message.label}
        </span>
        <time dateTime={new Date(message.at).toISOString()} className="ml-auto shrink-0 text-caption tabular-nums text-faint">
          {relativeTime(message.at, now)}
        </time>
      </button>
    </li>
  );
}

export function BusTimeline({ messages, agents, onSelect }: { messages: BusMessage[]; agents: AgentRow[]; onSelect: (id: string) => void }) {
  const now = useNow(15_000);
  const list = useFollow(messages.length);
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const byName = new Map(agents.map((agent) => [agent.name, agent]));
  const edges = useScrollEdges(list, "y", messages.length);
  return (
    <ol ref={list} aria-label="Agent activity" style={edgeFade("bottom", edges)} className="flex max-h-64 flex-col overflow-y-auto">
      {messages.map((message) => (
        <Event key={message.id} message={message} sender={byId.get(message.agentId)} related={byName.get(message.target)} now={now} onSelect={onSelect} />
      ))}
    </ol>
  );
}
