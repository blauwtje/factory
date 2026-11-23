import { afterEach, expect, test } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { TitleActionsProvider } from "@/shell/title-actions";
import { JobView } from "./JobView";
import type { AgentRow } from "./types";

const lead: AgentRow = {
  id: "a1",
  name: "lead",
  role: "lead",
  kind: "lead",
  model: "claude-opus-5-5",
  effort: "high",
  why: "",
  worktree: "~/code/app/.worktrees/session",
  status: "done",
  permission_mode: "",
};

afterEach(async () => {
  cleanup();
  await act(async () => {});
  clearMocks();
});

const renderJob = () =>
  render(
    <TitleActionsProvider>
      <JobView jobId="j1" />
    </TitleActionsProvider>,
  );

test("reopening a session shows its conversation before the backend answers", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_agents") return [lead];
    if (cmd === "agent_history") return [{ User: { text: "Build me a calculator" } }];
    if (cmd === "list_jobs") return [{ id: "j1", status: "done" }];
  });
  renderJob();
  await screen.findByText("Build me a calculator");
  cleanup();
  clearMocks();

  mockIPC(() => new Promise(() => {}));
  renderJob();
  await act(async () => {});
  expect(screen.getByText("Build me a calculator")).not.toBeNull();
});

test("a newer history keeps what streamed in while it loaded", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_agents") return [lead];
    if (cmd === "agent_history") return [{ User: { text: "Old question" } }];
    if (cmd === "list_jobs") return [{ id: "j1", status: "done" }];
  });
  renderJob();
  await screen.findByText("Old question");
  cleanup();
  clearMocks();

  let answer: (turns: unknown) => void = () => {};
  mockIPC(
    (cmd) => {
      if (cmd === "list_agents") return [lead];
      if (cmd === "agent_history") return new Promise((resolve) => (answer = resolve));
      if (cmd === "list_jobs") return [{ id: "j1", status: "done" }];
    },
    { shouldMockEvents: true },
  );
  renderJob();
  await act(async () => void (await emit("agent-event", { job_id: "j1", agent_id: "a1", event: { Assistant: { content: "Live reply" } } })));
  await act(async () => answer([{ User: { text: "Old question" } }, { User: { text: "Newer question" } }]));
  expect(screen.getByText("Newer question")).not.toBeNull();
  expect(screen.getByText("Live reply")).not.toBeNull();
});
