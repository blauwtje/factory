import { afterEach, beforeEach, expect, test } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { TitleActionsProvider, TitleActionsSlot } from "@/shell/title-actions";
import { JobView } from "./JobView";
import type { AgentRow } from "./types";

const agents: AgentRow[] = [
  { id: "a1", name: "lead", role: "lead", model: "claude-opus-5-5", effort: "high", why: "plans the work", worktree: "~/code/app/.worktrees/session", status: "running", permission_mode: "" },
  { id: "a2", name: "builder", role: "builder", model: "claude-sonnet-5-5", effort: "medium", why: "clear plan", worktree: "~/code/app/.worktrees/session", status: "waiting", permission_mode: "" },
];

beforeEach(() => {
  mockIPC((cmd) => {
    if (cmd === "list_agents") return agents;
    if (cmd === "agent_history") return [];
    if (cmd === "list_jobs") return [{ id: "j1", status: "building" }];
  }, { shouldMockEvents: true });
});

afterEach(async () => {
  cleanup();
  await act(async () => {});
  clearMocks();
});

test("the open agent panel adds no tab stop before the composer", async () => {
  const { container } = render(
    <TitleActionsProvider>
      <TitleActionsSlot />
      <JobView jobId="j1" />
    </TitleActionsProvider>,
  );
  await screen.findByRole("button", { name: /Model/ });
  const panels = Array.from(container.querySelectorAll<HTMLElement>("[role='tabpanel']"));
  const open = panels.filter((panel) => !panel.hidden);
  expect(open.map((panel) => panel.getAttribute("tabindex"))).toEqual(open.map(() => null));
});
