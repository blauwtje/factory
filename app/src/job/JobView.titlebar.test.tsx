import { afterEach, beforeEach, expect, test } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { TitleActionsProvider, TitleActionsSlot } from "@/shell/title-actions";
import { JobView } from "./JobView";
import type { AgentRow } from "./types";

const worktree = "~/code/app/.worktrees/session";
const agents: AgentRow[] = [
  { id: "a1", name: "lead", role: "lead", kind: "lead", model: "claude-opus-5-5", effort: "high", why: "plans the work", worktree, status: "done", permission_mode: "" },
  { id: "a2", name: "builder", role: "builder", model: "claude-sonnet-5-5", effort: "medium", why: "clear plan", worktree, status: "running", permission_mode: "" },
  { id: "a3", name: "reviewer", role: "reviewer", model: "claude-sonnet-5-5", effort: "medium", why: "checks the work", worktree, status: "running", permission_mode: "" },
];

beforeEach(() => {
  mockIPC(
    (cmd) => {
      if (cmd === "list_agents") return agents;
      if (cmd === "agent_history") return [];
      if (cmd === "list_jobs") return [{ id: "j1", status: "done", permission_mode: "" }];
      if (cmd === "context_usage") return { categories: [], totalTokens: 50000, maxTokens: 200000 };
    },
    { shouldMockEvents: true },
  );
});

afterEach(async () => {
  cleanup();
  await act(async () => {});
  clearMocks();
});

test("switching the selected agent leaves exactly one context meter in the title bar", async () => {
  const { container } = render(
    <TitleActionsProvider>
      <TitleActionsSlot />
      <JobView jobId="j1" />
    </TitleActionsProvider>,
  );
  await screen.findByRole("button", { name: /Model/ });
  for (const name of [/builder/, /reviewer/, /Orchestrator/, /builder/]) {
    fireEvent.click(await screen.findByRole("tab", { name }));
    await waitFor(() => expect(screen.getByRole("tab", { name }).getAttribute("aria-selected")).toBe("true"));
  }
  expect(container.querySelectorAll("button[aria-label*='of context used']")).toHaveLength(1);
});
