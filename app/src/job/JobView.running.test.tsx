import { afterEach, beforeEach, expect, test } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { TitleActionsProvider, TitleActionsSlot } from "@/shell/title-actions";
import { JobView } from "./JobView";
import type { AgentRow } from "./types";

const worktree = "~/code/app/.worktrees/session";
const row = (id: string, name: string, kind: string, status: AgentRow["status"]): AgentRow => ({
  id,
  name,
  role: kind,
  kind,
  model: "claude-opus-5-5",
  effort: "high",
  why: "",
  worktree,
  status,
  permission_mode: "",
});
let agents: AgentRow[];

beforeEach(() => {
  agents = [row("a1", "lead", "lead", "running"), row("a2", "builder", "builder", "running"), row("a3", "reviewer", "reviewer", "done")];
  mockIPC(
    (cmd) => {
      if (cmd === "list_agents") return agents;
      if (cmd === "agent_history") return [];
      if (cmd === "list_jobs") return [{ id: "j1", status: "building" }];
      if (cmd === "session_tokens") return { total: { input: 0, cache_write: 0, cache_read: 0, output: 0, uncached: 0 }, agents: [{ agent_id: "a2", tokens: { input: 0, cache_write: 0, cache_read: 0, output: 0, uncached: 3500 } }] };
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

const openMenu = async (name: RegExp = /running/) => {
  fireEvent.click(await screen.findByRole("button", { name }));
  return screen.findByRole("dialog");
};

const emitEvent = (agent_id: string, event: object) => act(async () => void (await emit("agent-event", { job_id: "j1", agent_id, event })));

const tab = (name: string) => screen.findByRole("tab", { name: new RegExp(name) });

test("the strip shows Orchestrator and each unfinished subagent as a tab and the lead is selected", async () => {
  renderJob();
  expect((await tab("Orchestrator")).getAttribute("aria-selected")).toBe("true");
  expect((await tab("builder")).getAttribute("aria-selected")).toBe("false");
  expect(screen.queryByRole("tab", { name: /reviewer/ })).toBeNull();
});

test("a session with only the lead shows no strip and no status button", async () => {
  agents = [agents[0]];
  renderJob();
  await screen.findByRole("button", { name: /Model/ });
  expect(screen.queryByRole("tab")).toBeNull();
  expect(screen.queryByRole("button", { name: /running/ })).toBeNull();
});

test("the status button opens one popover with agents, context and MCP sections", async () => {
  renderJob();
  const dialog = await openMenu(/1 running/);
  expect(within(dialog).getByRole("region", { name: "Agents" })).not.toBeNull();
  expect(within(dialog).getByRole("region", { name: "Context" })).not.toBeNull();
  expect(within(dialog).getByRole("region", { name: "MCP" })).not.toBeNull();
});

test("the agents section counts the running agents and lists the others with status word and tokens", async () => {
  renderJob();
  const dialog = await openMenu(/1 running/);
  const builder = within(dialog).getByRole("button", { name: /builder/ });
  expect(builder.textContent).toContain("Running");
  await waitFor(() => expect(builder.textContent).toContain("3.5k"));
  expect(within(dialog).getByRole("button", { name: /reviewer/ }).textContent).toContain("Done");
  expect(within(dialog).queryByRole("button", { name: /lead/ })).toBeNull();
});

test("an agent asking for permission is listed as needing permission", async () => {
  renderJob();
  await screen.findByRole("button", { name: /running/ });
  await emitEvent("a2", { ControlRequest: { request_id: "r1", tool_name: "Bash", input: { command: "npm test" } } });
  const dialog = await openMenu();
  expect(within(dialog).getByRole("button", { name: /builder/ }).textContent).toContain("Needs permission");
});

test("clicking an agent in the strip switches the chat and Orchestrator switches back", async () => {
  renderJob();
  fireEvent.click(await tab("builder"));
  await waitFor(() => expect(screen.getByRole("tab", { name: /builder/ }).getAttribute("aria-selected")).toBe("true"));
  expect(screen.getByRole("tab", { name: /Orchestrator/ }).getAttribute("aria-selected")).toBe("false");
  fireEvent.click(screen.getByRole("tab", { name: /Orchestrator/ }));
  await waitFor(() => expect(screen.getByRole("tab", { name: /Orchestrator/ }).getAttribute("aria-selected")).toBe("true"));
});

test("picking an agent in the popover selects it in the strip and marks it", async () => {
  renderJob();
  fireEvent.click(within(await openMenu()).getByRole("button", { name: /builder/ }));
  await waitFor(() => expect(screen.getByRole("tab", { name: /builder/ }).getAttribute("aria-selected")).toBe("true"));
  const dialog = await openMenu(/1 running/);
  expect(within(dialog).getByRole("button", { name: /builder/ }).getAttribute("aria-current")).toBe("true");
  expect(within(dialog).queryByRole("button", { name: /lead/ })).toBeNull();
});

test("a background shell is listed with its description and owner, and opens the owner's chat", async () => {
  renderJob();
  await screen.findByRole("button", { name: /running/ });
  await emitEvent("a2", { Tasks: { tasks: [{ task_id: "t1", task_type: "local_bash", description: "npm run dev" }] } });
  const dialog = await openMenu(/2 running/);
  const shell = within(dialog).getByRole("button", { name: /npm run dev/ });
  expect(shell.textContent).toContain("builder");
  fireEvent.click(shell);
  await waitFor(() => expect(screen.getByRole("tab", { name: /builder/ }).getAttribute("aria-selected")).toBe("true"));
});

test("an empty shell list removes the shells", async () => {
  renderJob();
  await screen.findByRole("button", { name: /running/ });
  await emitEvent("a2", { Tasks: { tasks: [{ task_id: "t1", task_type: "local_bash", description: "npm run dev" }] } });
  await emitEvent("a2", { Tasks: { tasks: [] } });
  expect(within(await openMenu(/1 running/)).queryByText("npm run dev")).toBeNull();
});

test("a restart of the agent removes its shells", async () => {
  renderJob();
  await screen.findByRole("button", { name: /running/ });
  await emitEvent("a2", { Tasks: { tasks: [{ task_id: "t1", task_type: "local_bash", description: "npm run dev" }] } });
  await emitEvent("a2", { Init: { session_id: "s", api_key_source: "none", model: "claude-opus-5-5" } });
  expect(within(await openMenu(/1 running/)).queryByText("npm run dev")).toBeNull();
});

test("a lead from an older session is not counted as an agent", async () => {
  agents = [row("a1", "lead", "lead", "done"), row("a4", "lead", "lead", "running")];
  renderJob();
  await screen.findByRole("button", { name: /Model/ });
  expect(screen.queryByRole("button", { name: /agent|running/ })).toBeNull();
  expect(screen.queryByRole("tab")).toBeNull();
});

test("a newer lead replaces the one shown when the user had not opened another agent", async () => {
  agents = [row("a1", "lead", "lead", "done")];
  renderJob();
  await screen.findByRole("button", { name: /Model/ });
  agents = [row("a1", "lead", "lead", "done"), row("a4", "lead", "lead", "running")];
  await emitEvent("a1", { Result: { session_id: "s", outcome: "Finished" } });
  await act(async () => {});
  expect(screen.queryByRole("tab")).toBeNull();
});
