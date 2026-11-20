import { afterEach, beforeEach, expect, test } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { TitleActionsProvider, TitleActionsSlot } from "@/shell/title-actions";
import { JobView } from "./JobView";
import type { AgentRow } from "./types";

const worktree = "~/code/app/.worktrees/session";
const lead: AgentRow = { id: "a1", name: "lead", role: "lead", kind: "lead", model: "claude-opus-5-5", effort: "high", why: "", worktree, status: "waiting", permission_mode: "acceptEdits" };
const builder: AgentRow = { ...lead, id: "a2", name: "builder", role: "builder", kind: "builder" };
let calls: { cmd: string; args: unknown }[];
let agents: AgentRow[];

beforeEach(() => {
  calls = [];
  agents = [lead];
  mockIPC(
    (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "list_agents") return agents;
      if (cmd === "agent_history") return [];
      if (cmd === "list_jobs") return [{ id: "j1", status: "building" }];
      if (cmd === "permission_modes") return ["acceptEdits", "auto", "bypassPermissions", "manual", "dontAsk", "plan", "fancyNewMode"];
    },
    { shouldMockEvents: true },
  );
});

afterEach(async () => {
  cleanup();
  await act(async () => {});
  clearMocks();
});

const renderJob = () =>
  render(
    <TitleActionsProvider>
      <TitleActionsSlot />
      <JobView jobId="j1" />
    </TitleActionsProvider>,
  );

test("the lead's permission menu lists the reported modes with labels and descriptions and marks the current one", async () => {
  renderJob();
  fireEvent.click(await screen.findByRole("button", { name: /Permissions/ }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("Permissions · this session")).not.toBeNull();
  for (const label of ["Accept edits", "Auto", "Bypass permissions", "Manual", "Don't ask", "Plan", "Fancy New Mode"]) {
    expect(within(dialog).getByRole("radio", { name: label })).not.toBeNull();
  }
  expect(within(dialog).getByRole("radio", { name: /Accept edits/ }).getAttribute("aria-checked")).toBe("true");
  expect(within(dialog).getByRole("radio", { name: /Manual/ }).textContent).not.toBe("Manual");
  expect(within(dialog).getByRole("radio", { name: /Fancy New Mode/ }).textContent).toBe("Fancy New Mode");
  expect(calls.filter((c) => c.cmd === "permission_modes")).toHaveLength(1);
});

test("an empty permission mode shows Manual as the current one", async () => {
  agents = [{ ...lead, permission_mode: "" }];
  renderJob();
  fireEvent.click(await screen.findByRole("button", { name: /Permissions/ }));
  expect((await screen.findByRole("radio", { name: /Manual/ })).getAttribute("aria-checked")).toBe("true");
});

test("an empty permission mode shows the default mode from Claude's settings", async () => {
  agents = [{ ...lead, permission_mode: "" }];
  mockIPC(
    (cmd) => {
      if (cmd === "list_agents") return agents;
      if (cmd === "agent_history") return [];
      if (cmd === "list_jobs") return [{ id: "j1", status: "building" }];
      if (cmd === "permission_modes") return ["acceptEdits", "bypassPermissions", "manual"];
      if (cmd === "claude_permission_mode") return "bypassPermissions";
    },
    { shouldMockEvents: true },
  );
  renderJob();
  expect(await screen.findByRole("button", { name: "Permissions, Bypass permissions" })).not.toBeNull();
});

test("choosing a mode calls set_permission_mode for the lead", async () => {
  renderJob();
  fireEvent.click(await screen.findByRole("button", { name: /Permissions/ }));
  fireEvent.click(await screen.findByRole("radio", { name: /Plan/ }));
  await act(async () => {});
  expect(calls.find((c) => c.cmd === "set_permission_mode")!.args).toEqual({ agent_id: "a1", mode: "plan" });
});

test("a member has no permission menu", async () => {
  agents = [lead, builder];
  renderJob();
  fireEvent.click(await screen.findByRole("tab", { name: /builder/ }));
  await waitFor(() => expect(screen.getByRole("tab", { name: /builder/ }).getAttribute("aria-selected")).toBe("true"));
  await act(async () => {});
  expect(screen.queryByRole("button", { name: /Permissions/ })).toBeNull();
  expect(screen.getByRole("button", { name: /Model/ })).not.toBeNull();
});
