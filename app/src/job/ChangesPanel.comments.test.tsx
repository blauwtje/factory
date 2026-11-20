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

const file = (path: string): FileChange => ({ path, old_path: null, status: "Modified", binary: false, before: "", after: "" });

function mockBackend(sendError?: string) {
  const sent: { agent_id: string; text: string }[] = [];
  mockIPC((cmd, args) => {
    if (cmd === "job_commits") return [];
    if (cmd === "job_changes") return [file("a.ts")];
    if (cmd === "send_message") {
      sent.push(args as { agent_id: string; text: string });
      if (sendError) throw sendError;
    }
  });
  return sent;
}

async function comment(label: string, text: string) {
  fireEvent.click(await screen.findByText(label));
  fireEvent.change(screen.getByLabelText("Comment"), { target: { value: text } });
  fireEvent.click(screen.getByText("Add comment"));
}

test("Send sends every comment as one message to the lead and clears the drafts", async () => {
  const sent = mockBackend();
  render(<ChangesPanel jobId="j1" leadId="lead-1" />);
  await comment("new a.ts", "rename this");
  await comment("old a.ts", "why removed");
  fireEvent.click(screen.getByText("Send 2 comments"));
  await waitFor(() => expect(screen.queryByText(/^Send \d/)).toBeNull());
  expect(sent).toEqual([
    {
      agent_id: "lead-1",
      text: "Review comments on your changes:\n- a.ts:3 (change): rename this\n- a.ts:5 (old) (change): why removed",
    },
  ]);
});

test("a send error keeps the drafts and shows the error", async () => {
  mockBackend("lead is gone");
  render(<ChangesPanel jobId="j1" leadId="lead-1" />);
  await comment("new a.ts", "rename this");
  fireEvent.click(screen.getByText("Send 1 comment"));
  expect(await screen.findByText(/lead is gone/)).toBeTruthy();
  expect(screen.getByText("Send 1 comment")).toBeTruthy();
});

test("without a lead nothing can be sent", async () => {
  mockBackend();
  render(<ChangesPanel jobId="j1" />);
  await comment("new a.ts", "rename this");
  expect((screen.getByText("Send 1 comment") as HTMLButtonElement).disabled).toBe(true);
});
