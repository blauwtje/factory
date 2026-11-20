import { afterEach, beforeEach, expect, test } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { TitleActionsProvider, TitleActionsSlot } from "@/shell/title-actions";
import { JobView } from "./JobView";
import type { AgentRow } from "./types";

const agents: AgentRow[] = [
  { id: "a1", name: "lead", role: "lead", model: "claude-opus-5-5", effort: "high", why: "plans the work", worktree: "~/code/app/.worktrees/session", status: "waiting", permission_mode: "" },
];

let forecast: unknown = { Conflict: { files: ["src/auth.ts"] } };
let status = "done";
let resolved: unknown[] = [];
let leadStatus = "waiting";

beforeEach(() => {
  resolved = [];
  leadStatus = "waiting";
  mockIPC((cmd, args) => {
    if (cmd === "list_agents") return agents.map((agent) => ({ ...agent, status: leadStatus }));
    if (cmd === "agent_history") return [];
    if (cmd === "merge_forecast") return forecast;
    if (cmd === "job_overlaps") return [];
    if (cmd === "resolve_conflicts") {
      resolved.push(args);
      forecast = "Clean";
      return;
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

test("a done session that would conflict offers the agent to resolve it, once", async () => {
  forecast = { Conflict: { files: ["src/auth.ts"] } };
  status = "done";
  view();
  fireEvent.click(await screen.findByRole("button", { name: "Let the agent resolve" }));
  await screen.findByText("Merges cleanly");
  expect(resolved).toEqual([{ job_id: "j1" }]);
  expect(screen.queryByRole("button", { name: "Let the agent resolve" })).toBeNull();
});

test("a clean forecast or a session not done offers no resolve button", async () => {
  forecast = "Clean";
  status = "done";
  view();
  await screen.findByText("Merges cleanly");
  expect(screen.queryByRole("button", { name: "Let the agent resolve" })).toBeNull();
  cleanup();
  forecast = { Conflict: { files: ["a"] } };
  status = "running";
  view();
  await act(async () => {});
  expect(screen.queryByRole("button", { name: "Let the agent resolve" })).toBeNull();
});

test("after the click the status shows the lead working and the button is gone while the forecast still conflicts", async () => {
  forecast = { Conflict: { files: ["src/auth.ts"] } };
  status = "done";
  mockIPC((cmd) => {
    if (cmd === "list_agents") return agents.map((agent) => ({ ...agent, status: leadStatus }));
    if (cmd === "agent_history") return [];
    if (cmd === "merge_forecast") return forecast;
    if (cmd === "job_overlaps") return [];
    if (cmd === "resolve_conflicts") leadStatus = "running";
    if (cmd === "list_jobs") return [{ id: "j1", status }];
  }, { shouldMockEvents: true });
  view();
  fireEvent.click(await screen.findByRole("button", { name: "Let the agent resolve" }));
  expect(await screen.findByText("lead is working")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Let the agent resolve" })).toBeNull();
});
