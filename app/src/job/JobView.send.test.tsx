import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { TitleActionsProvider, TitleActionsSlot } from "@/shell/title-actions";
import { JobView } from "./JobView";
import type { AgentRow } from "./types";

vi.mock("@/chat/DiffView", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/chat/DiffView")>()),
  DiffView: ({ onLineClick }: { onLineClick?: (line: { number: number; side: "old" | "new" }) => void }) => (
    <button onClick={() => onLineClick?.({ number: 3, side: "new" })}>line 3</button>
  ),
}));

const agents: AgentRow[] = [
  { id: "a1", name: "lead", role: "lead", kind: "lead", model: "claude-opus-5-5", effort: "high", why: "plans the work", worktree: "~/code/app/.worktrees/session", status: "waiting", permission_mode: "" },
];

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  mockIPC((cmd) => {
    if (cmd === "list_agents") return agents;
    if (cmd === "agent_history") return [];
    if (cmd === "list_jobs") return [{ id: "j1", status: "done", permission_mode: "" }];
    if (cmd === "merge_forecast") return "Clean";
    if (cmd === "job_overlaps") return [];
    if (cmd === "job_commits") return [];
    if (cmd === "job_changes") return [{ path: "a.ts", old_path: null, status: "Modified", binary: false, before: "", after: "x" }];
  }, { shouldMockEvents: true });
});

afterEach(async () => {
  cleanup();
  await act(async () => {});
  clearMocks();
  vi.unstubAllGlobals();
});

test("review comments sent from the Changes panel show in the lead's chat at once", async () => {
  render(
    <TitleActionsProvider>
      <TitleActionsSlot />
      <JobView jobId="j1" />
    </TitleActionsProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Changes" }));
  fireEvent.click(await screen.findByText("line 3"));
  fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "rename this" } });
  fireEvent.click(screen.getByText("Add comment"));
  fireEvent.click(screen.getByText("Send 1 comment"));
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Changes" }));
  expect(screen.getByText("Review comments on your changes: - a.ts:3 (change): rename this")).toBeTruthy();
});
