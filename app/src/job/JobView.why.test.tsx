import { afterEach, beforeEach, expect, test } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { TitleActionsProvider, TitleActionsSlot } from "@/shell/title-actions";
import { JobView } from "./JobView";
import type { AgentRow } from "./types";

const worktree = "~/code/app/.worktrees/session";
const planning: AgentRow = { id: "a1", name: "lead", role: "lead", model: "claude-opus-5-5", effort: "high", why: "Chosen when the session was created", worktree, status: "running", permission_mode: "" };
const builder: AgentRow = { id: "a2", name: "builder", role: "builder", model: "claude-sonnet-5-5", effort: "medium", why: "clear plan", worktree, status: "waiting", permission_mode: "" };

beforeEach(() => {
  mockIPC(
    (cmd) => {
      if (cmd === "list_agents") return [planning, builder];
      if (cmd === "agent_history") return [];
      if (cmd === "list_jobs") return [{ id: "j1", status: "building" }];
    },
    { shouldMockEvents: true },
  );
});

afterEach(async () => {
  cleanup();
  await act(async () => {});
  clearMocks();
});

test("the main view does not print the reason an agent was chosen", async () => {
  render(
    <TitleActionsProvider>
      <TitleActionsSlot />
      <JobView jobId="j1" />
    </TitleActionsProvider>,
  );
  await screen.findByRole("button", { name: /Model/ });
  expect(screen.queryByText("Chosen when the session was created")).toBeNull();
});
