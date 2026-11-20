import { afterEach, beforeEach, expect, test } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { TitleActionsProvider, TitleActionsSlot } from "@/shell/title-actions";
import { JobView } from "./JobView";
import type { AgentRow } from "./types";

const agents: AgentRow[] = [
  { id: "a1", name: "lead", role: "lead", model: "claude-opus-5-5", effort: "high", why: "plans the work", worktree: "~/code/app/.worktrees/session", status: "waiting", permission_mode: "" },
];

const overlaps = [
  { job_id: "j2", title: "Fix login", files: ["src/auth.ts", "src/session.ts"] },
  { job_id: "j3", title: "Rename user", files: ["src/user.ts"] },
];

let status = "done";
let asked: string[] = [];

beforeEach(() => {
  asked = [];
  mockIPC((cmd) => {
    if (cmd === "list_agents") return agents;
    if (cmd === "agent_history") return [];
    if (cmd === "merge_forecast") return "Clean";
    if (cmd === "job_overlaps") {
      asked.push(cmd);
      return overlaps;
    }
    if (cmd === "list_jobs") return [{ id: "j1", status }];
  }, { shouldMockEvents: true });
});

afterEach(async () => {
  cleanup();
  await act(async () => {});
  clearMocks();
});

const view = () =>
  render(
    <TitleActionsProvider>
      <TitleActionsSlot />
      <JobView jobId="j1" />
    </TitleActionsProvider>,
  );

test("a done session lists each session it would conflict with under the status", async () => {
  status = "done";
  view();
  expect(await screen.findByText("Conflicts with Fix login: src/auth.ts, src/session.ts")).toBeTruthy();
  expect(screen.getByText("Conflicts with Rename user: src/user.ts")).toBeTruthy();
});

test("a merged session asks for no overlaps", async () => {
  status = "merged";
  view();
  await screen.findByText("Merged");
  await act(async () => {});
  expect(asked).toEqual([]);
  expect(screen.queryByText(/Conflicts with/)).toBeNull();
});
