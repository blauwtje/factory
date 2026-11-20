import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { ChangesPanel } from "./ChangesPanel";
import type { FileChange } from "@/ipc";

vi.mock("@/chat/DiffView", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/chat/DiffView")>()),
  DiffView: ({
    path,
    onLineClick,
  }: {
    path: string;
    onLineClick?: (line: { number: number; side: "old" | "new" }) => void;
  }) => (
    <div>
      <button onClick={() => onLineClick?.({ number: 3, side: "new" })}>{`new ${path}`}</button>
      <button onClick={() => onLineClick?.({ number: 5, side: "old" })}>{`old ${path}`}</button>
    </div>
  ),
}));

afterEach(async () => {
  cleanup();
  await act(async () => {});
  clearMocks();
});

const file: FileChange = { path: "a.ts", old_path: null, status: "Modified", binary: false, before: "", after: "" };

function mockBackend() {
  const sent: { agent_id: string; text: string }[] = [];
  mockIPC((cmd, args) => {
    if (cmd === "job_commits") return [];
    if (cmd === "job_changes") return [file];
    if (cmd === "send_message") sent.push(args as { agent_id: string; text: string });
  });
  return sent;
}

test("a question is marked answer only and a comment defaults to a change", async () => {
  const sent = mockBackend();
  render(<ChangesPanel jobId="j1" leadId="lead-1" />);

  fireEvent.click(await screen.findByText("new a.ts"));
  fireEvent.click(screen.getByText("Question"));
  fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "why this?" } });
  fireEvent.click(screen.getByText("Add comment"));

  fireEvent.click(screen.getByText("old a.ts"));
  fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "drop it" } });
  fireEvent.click(screen.getByText("Add comment"));

  fireEvent.click(screen.getByText("Send 2 comments"));
  await waitFor(() => expect(sent).toHaveLength(1));
  expect(sent[0].text).toBe(
    [
      "Review comments on your changes:",
      "- a.ts:3 (question, answer only and change no file): why this?",
      "- a.ts:5 (old) (change): drop it",
    ].join("\n"),
  );
});
