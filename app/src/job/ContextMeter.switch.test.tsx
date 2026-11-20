import { afterEach, beforeEach, expect, test } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { TitleActionsProvider, TitleActionsSlot } from "@/shell/title-actions";
import { JobView } from "./JobView";
import type { AgentRow } from "./types";

const agents: AgentRow[] = [
  { id: "a1", name: "lead", role: "lead", kind: "lead", model: "claude-opus-5-5", effort: "high", why: "plans the work", worktree: "~/code/app/.worktrees/session", status: "running", permission_mode: "" },
  { id: "a2", name: "builder", role: "builder", kind: "builder", model: "claude-sonnet-5-5", effort: "medium", why: "clear plan", worktree: "~/code/app/.worktrees/session", status: "waiting", permission_mode: "" },
];

beforeEach(() => {
  mockIPC((cmd, args) => {
    if (cmd === "list_agents") return agents;
    if (cmd === "agent_history") return [];
    if (cmd === "list_jobs") return [{ id: "j1", status: "building" }];
    if (cmd === "context_usage") {
      const { agent_id } = args as { agent_id: string };
      if (agent_id === "a1") return { categories: [], totalTokens: 50000, maxTokens: 200000 };
      return new Promise(() => {});
    }
  }, { shouldMockEvents: true });
});

afterEach(async () => {
  cleanup();
  await act(async () => {});
  clearMocks();
});

test("switching agents shows one fixed-size context skeleton in the title bar while the new usage loads", async () => {
  const { container } = render(
    <TitleActionsProvider>
      <TitleActionsSlot />
      <JobView jobId="j1" />
    </TitleActionsProvider>,
  );
  await waitFor(() => expect(container.querySelector("button[aria-label*='of context used']")).not.toBeNull());
  expect(container.querySelector("[data-slot='skeleton']")).toBeNull();
  fireEvent.click(await screen.findByRole("tab", { name: /builder/ }));
  await waitFor(() => expect(container.querySelectorAll("[data-slot='skeleton']")).toHaveLength(1));
  expect(container.querySelector("button[aria-label*='of context used']")).toBeNull();
});

test("a restart of the agent reloads its context window", async () => {
  let max = 200000;
  mockIPC((cmd) => {
    if (cmd === "list_agents") return agents;
    if (cmd === "agent_history") return [];
    if (cmd === "list_jobs") return [{ id: "j1", status: "building" }];
    if (cmd === "context_usage") return { categories: [], totalTokens: 50000, maxTokens: max };
  }, { shouldMockEvents: true });
  const { container } = render(
    <TitleActionsProvider>
      <TitleActionsSlot />
      <JobView jobId="j1" />
    </TitleActionsProvider>,
  );
  await waitFor(() => expect(container.querySelector("button[aria-label*='of context used']")?.textContent).toContain("25%"));
  max = 1000000;
  await act(async () => void (await emit("agent-event", { job_id: "j1", agent_id: "a1", event: { Init: { session_id: "s", api_key_source: "none", model: "m" } } })));
  await waitFor(() => expect(container.querySelector("button[aria-label*='of context used']")?.textContent).toMatch(/\b5%/));
});
