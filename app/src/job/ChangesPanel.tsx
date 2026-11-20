import { useEffect, useState } from "react";
import { DiffView, lineCounts, type DiffLine } from "@/chat/DiffView";
import { sendToAgent } from "@/chat/ChatView";
import { jobChanges, jobCommits, type CommitRow, type FileChange, type Scope } from "@/ipc";

type Kind = "question" | "change";
type Draft = { path: string; line: DiffLine; text: string; kind: Kind };

const kindLabel: Record<Kind, string> = {
  question: "question, answer only and change no file",
  change: "change",
};

const place = ({ path, line }: Draft) => `${path}:${line.number}${line.side === "old" ? " (old)" : ""}`;

function reviewMessage(drafts: Draft[]): string {
  return ["Review comments on your changes:", ...drafts.map((draft) => `- ${place(draft)} (${kindLabel[draft.kind]}): ${draft.text}`)].join("\n");
}

function CommentForm({ onAdd }: { onAdd: (text: string, kind: Kind) => void }) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<Kind>("change");
  return (
    <div className="flex flex-col gap-2 border-t border-rule px-3 py-2">
      <textarea
        aria-label="Comment"
        value={text}
        onChange={(event) => setText(event.target.value)}
        className="rounded-md border border-rule bg-transparent px-2 py-1 text-label text-ink"
      />
      <div className="flex gap-1">
        {(["change", "question"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={kind === option}
            onClick={() => setKind(option)}
            className={`rounded-md border border-rule px-2 py-1 text-label ${kind === option ? "bg-rule text-ink" : "text-muted"}`}
          >
            {option === "change" ? "Change" : "Question"}
          </button>
        ))}
      </div>
      <button
        type="button"
        disabled={!text.trim()}
        onClick={() => onAdd(text.trim(), kind)}
        className="self-start rounded-md border border-rule px-2 py-1 text-label text-ink"
      >
        Add comment
      </button>
    </div>
  );
}

function FileDiff({ change, onComment }: { change: FileChange; onComment: (draft: Draft) => void }) {
  const [open, setOpen] = useState<DiffLine>();
  const { added, removed } = lineCounts(change.before, change.after);
  return (
    <section className="rounded-md border border-rule">
      <header className="flex items-center gap-2 px-3 py-2 text-label">
        <span className="min-w-0 flex-1 truncate font-mono text-ink">{change.path}</span>
        <span className="text-muted">{change.status}</span>
        {!change.binary && (
          <>
            <span className="tabular-nums text-diff-add">+{added}</span>
            <span className="tabular-nums text-diff-remove">-{removed}</span>
          </>
        )}
      </header>
      {change.binary ? (
        <p className="px-3 pb-2 text-label text-muted">Binary file, not shown</p>
      ) : (
        <DiffView path={change.path} before={change.before} after={change.after} onLineClick={setOpen} />
      )}
      {open && (
        <CommentForm
          key={`${open.side}:${open.number}`}
          onAdd={(text, kind) => {
            onComment({ path: change.path, line: open, text, kind });
            setOpen(undefined);
          }}
        />
      )}
    </section>
  );
}

function scopeOf(value: string): Scope {
  if (value === "branch" || value === "uncommitted") return { kind: value };
  return { kind: "commit", sha: value };
}

export function ChangesPanel({ jobId, leadId }: { jobId: string; leadId?: string }) {
  const [scope, setScope] = useState("branch");
  const [commits, setCommits] = useState<CommitRow[]>([]);
  const [changes, setChanges] = useState<FileChange[]>();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [error, setError] = useState<string>();

  const send = () => {
    if (!leadId) return;
    sendToAgent(leadId, reviewMessage(drafts)).then(
      () => {
        setDrafts([]);
        setError(undefined);
      },
      (failure) => setError(String(failure)),
    );
  };

  useEffect(() => {
    jobCommits(jobId).then((rows) => setCommits(rows ?? []));
  }, [jobId]);

  useEffect(() => {
    let current = true;
    jobChanges(jobId, scopeOf(scope)).then((next) => current && setChanges(next));
    return () => {
      current = false;
    };
  }, [jobId, scope]);

  if (!changes) return null;
  return (
    <div className="chat-column flex h-full flex-col gap-3 overflow-auto pb-4">
      <select
        aria-label="Scope"
        value={scope}
        onChange={(event) => setScope(event.target.value)}
        className="self-start rounded-md border border-rule bg-transparent px-2 py-1 text-label text-ink"
      >
        <option value="branch">Branch</option>
        <option value="uncommitted">Uncommitted</option>
        {commits.map((commit) => (
          <option key={commit.sha} value={commit.sha}>
            {commit.sha.slice(0, 7)} {commit.subject}
          </option>
        ))}
      </select>
      {changes.length === 0 && <p className="text-label text-muted">No changes yet.</p>}
      {changes.map((change) => (
        <FileDiff key={change.path} change={change} onComment={(draft) => setDrafts((all) => [...all, draft])} />
      ))}
      {drafts.length > 0 && (
        <div className="flex flex-col gap-2">
          {error && <p className="text-label text-diff-remove">{error}</p>}
          <button
            type="button"
            disabled={!leadId}
            onClick={send}
            className="self-start rounded-md border border-rule px-2 py-1 text-label text-ink"
          >
            Send {drafts.length} {drafts.length === 1 ? "comment" : "comments"}
          </button>
        </div>
      )}
    </div>
  );
}
