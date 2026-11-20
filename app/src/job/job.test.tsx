import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { TitleActionsProvider, TitleActionsSlot } from "@/shell/title-actions";
import { BusTimeline } from "./BusTimeline";
import { JobView } from "./JobView";
import type { AgentRow, JobState, MergeForecast, MergeOutcome } from "./types";

function renderJob() {
  return render(
    <TitleActionsProvider>
      <TitleActionsSlot />
      <JobView jobId="j1" />
    </TitleActionsProvider>,
  );
}

const agents: AgentRow[] = [
  { id: "a1", name: "lead", role: "lead", model: "claude-opus-5-5", effort: "high", why: "plans the work", worktree: "~/code/app/.worktrees/session", status: "running", permission_mode: "" },
  { id: "a2", name: "builder", role: "builder", model: "claude-sonnet-5-5", effort: "medium", why: "clear plan", worktree: "~/code/app/.worktrees/session", status: "waiting", permission_mode: "" },
];

let calls: { cmd: string; args: unknown }[];
let job: JobState;
let roster: AgentRow[];
let usage: unknown;
let outcome: MergeOutcome;
let forecast: MergeForecast;
let cleanedUp: boolean;
let sessionTotal: { input: number; cache_write: number; cache_read: number; output: number; uncached: number };

beforeEach(() => {
  calls = [];
  job = { id: "j1", status: "building" };
  roster = agents;
  usage = undefined;
  outcome = { Merged: { commit: "abc1234" } };
  forecast = "Clean";
  cleanedUp = false;
  sessionTotal = { input: 900, cache_write: 2000, cache_read: 500000, output: 100, uncached: 3000 };
  mockIPC((cmd, args) => {
    calls.push({ cmd, args });
    if (cmd === "list_agents") return job.status === "done" ? roster.map((agent) => ({ ...agent, status: "waiting", permission_mode: "" })) : roster;
    if (cmd === "agent_history") return [];
    if (cmd === "list_jobs") return [{ ...job, branch: "factory/add-search", cleaned_up: cleanedUp }];
    if (cmd === "context_usage") return usage;
    if (cmd === "merge_job") return outcome;
    if (cmd === "merge_forecast") return forecast;
    if (cmd === "session_tokens") return { total: sessionTotal, agents: [{ agent_id: "a2", tokens: { ...sessionTotal, uncached: sessionTotal.uncached - 1000 } }] };
  }, { shouldMockEvents: true });
});

afterEach(async () => {
  cleanup();
  localStorage.clear();
  await act(async () => {});
  clearMocks();
});

test("the lead's model and effort show in the composer", async () => {
  renderJob();
  await screen.findByRole("button", { name: /Model/ });
  expect(calls.find((c) => c.cmd === "list_agents")!.args).toEqual({ job_id: "j1" });
  expect(screen.getByRole("button", { name: /Model/ }).textContent).toContain("Opus 5.5 · High");
});

test("changing the model sends set_agent_model with the current effort", async () => {
  renderJob();
  fireEvent.click(await screen.findByRole("button", { name: /Model/ }));
  fireEvent.click(await screen.findByRole("radio", { name: "Sonnet 5.5" }));
  await waitFor(() => expect(calls.map((c) => c.cmd)).toContain("set_agent_model"));
  expect(calls.find((c) => c.cmd === "set_agent_model")!.args).toEqual({
    agent_id: "a1",
    model: "claude-sonnet-5-5",
    effort: "high",
  });
});

test("changing the effort sends set_agent_model with the current model", async () => {
  renderJob();
  fireEvent.click(await screen.findByRole("button", { name: /Model/ }));
  fireEvent.click(await screen.findByRole("radio", { name: "Max" }));
  await waitFor(() => expect(calls.map((c) => c.cmd)).toContain("set_agent_model"));
  expect(calls.find((c) => c.cmd === "set_agent_model")!.args).toEqual({
    agent_id: "a1",
    model: "claude-opus-5-5",
    effort: "max",
  });
});

test("an awaiting job puts Approve above the lead's composer, not in the title bar, and it calls approve_plan", async () => {
  job = { id: "j1", status: "awaiting_approval" };
  roster = [{ ...agents[0], kind: "lead" }, agents[1]];
  const { container } = renderJob();
  const approve = await screen.findByRole("button", { name: /^Approve/ });
  expect(container.firstElementChild?.contains(approve)).toBe(false);
  const bar = approve.closest("[aria-label='Plan approval']") as HTMLElement;
  expect(bar.textContent).toContain("Plan ready for approval");
  expect(bar.textContent).toContain("typing a message asks for changes");
  expect(bar.compareDocumentPosition(await screen.findByRole("combobox", { name: "Message" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(approve);
  await waitFor(() => expect(calls.map((c) => c.cmd)).toContain("approve_plan"));
  expect(calls.find((c) => c.cmd === "approve_plan")!.args).toEqual({ job_id: "j1" });
  expect(screen.queryByRole("button", { name: "Merge" })).toBeNull();
});

test("a building job shows neither Approve nor Merge", async () => {
  renderJob();
  await screen.findByRole("button", { name: /Model/ });
  expect(screen.queryByRole("button", { name: /^Approve/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "Merge" })).toBeNull();
});

test("a done job shows Merge, asks to confirm and shows the merged commit", async () => {
  job = { id: "j1", status: "done" };
  renderJob();
  fireEvent.click(await screen.findByRole("button", { name: "Merge" }));
  expect(calls.map((c) => c.cmd)).not.toContain("merge_job");
  fireEvent.click(await screen.findByRole("button", { name: "Confirm merge" }));
  expect(await screen.findByText("Merged abc1234")).not.toBeNull();
  expect(calls.find((c) => c.cmd === "merge_job")!.args).toEqual({ job_id: "j1" });
});

test("a conflicting merge lists the files", async () => {
  job = { id: "j1", status: "done" };
  outcome = { Conflict: { files: ["a.ts", "b.ts"] } };
  renderJob();
  fireEvent.click(await screen.findByRole("button", { name: "Merge" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm merge" }));
  expect(await screen.findByText("Conflict in a.ts, b.ts")).not.toBeNull();
});

test("a done job tells before the merge that it merges cleanly", async () => {
  job = { id: "j1", status: "done" };
  renderJob();
  expect(await screen.findByText("Merges cleanly")).not.toBeNull();
  expect(calls.find((c) => c.cmd === "merge_forecast")!.args).toEqual({ job_id: "j1" });
  expect(calls.map((c) => c.cmd)).not.toContain("merge_job");
});

test("a done job names the files that would conflict before the merge", async () => {
  job = { id: "j1", status: "done" };
  forecast = { Conflict: { files: ["a.ts", "b.ts"] } };
  renderJob();
  expect(await screen.findByText("2 files would conflict: a.ts, b.ts")).not.toBeNull();
  expect(calls.map((c) => c.cmd)).not.toContain("merge_job");
});

test("a building job asks for no forecast", async () => {
  renderJob();
  await screen.findByRole("button", { name: /Model/ });
  expect(calls.map((c) => c.cmd)).not.toContain("merge_forecast");
});

test("a merged job offers no Clean up", async () => {
  job = { id: "j1", status: "merged" };
  renderJob();
  expect(await screen.findByRole("button", { name: "Branch factory/add-search" })).not.toBeNull();
  expect(screen.queryByRole("button", { name: "Clean up" })).toBeNull();
});

test("the merge forecast is fetched again when the job refreshes while it stays done", async () => {
  job = { id: "j1", status: "done" };
  renderJob();
  expect(await screen.findByText("Merges cleanly")).not.toBeNull();
  forecast = { Conflict: { files: ["a.ts"] } };
  await emit("agent-event", { job_id: "j1", agent_id: "a1", event: { Result: { is_error: false } } });
  expect(await screen.findByText("1 file would conflict: a.ts")).not.toBeNull();
});

test("a merged job that was cleaned up offers no Clean up and no branch chip", async () => {
  job = { id: "j1", status: "merged" };
  cleanedUp = true;
  renderJob();
  await screen.findByRole("button", { name: /Model/ });
  expect(screen.queryByRole("button", { name: "Clean up" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Branch factory/add-search" })).toBeNull();
});

test("with merge confirmation turned off, Merge merges at once", async () => {
  localStorage.setItem("factory.confirmMerge", "false");
  job = { id: "j1", status: "done" };
  renderJob();
  fireEvent.click(await screen.findByRole("button", { name: "Merge" }));
  expect(await screen.findByText("Merged abc1234")).not.toBeNull();
  expect(screen.queryByRole("button", { name: "Confirm merge" })).toBeNull();
});

test("the session header names the agent that asks for permission until it moves on", async () => {
  renderJob();
  await screen.findByRole("button", { name: /Model/ });
  await emit("agent-event", {
    agent_id: "a1",
    event: { ControlRequest: { request_id: "r1", tool_name: "Bash", input: { command: "npm test" } } },
  });
  expect(await screen.findByText("lead needs your permission")).not.toBeNull();
  await emit("agent-event", { agent_id: "a1", event: { TextDelta: { text: "ok" } } });
  await waitFor(() => expect(screen.queryByText("lead needs your permission")).toBeNull());
});

test("the session header says the agent has a question when it asks one", async () => {
  renderJob();
  await screen.findByRole("button", { name: /Model/ });
  await emit("agent-event", {
    agent_id: "a1",
    event: { ControlRequest: { request_id: "r1", tool_name: "AskUserQuestion", input: { questions: [] } } },
  });
  expect(await screen.findByText("lead has a question")).not.toBeNull();
});

test("the session header shows the agent working from the Init event of a new turn", async () => {
  job = { id: "j1", status: "planning" };
  roster = agents.map((agent) => ({ ...agent, status: "waiting", permission_mode: "" }));
  renderJob();
  await screen.findByRole("button", { name: /Model/ });
  expect(screen.queryByText("Writing the plan")).toBeNull();
  roster = agents;
  await emit("agent-event", { job_id: "j1", agent_id: "a1", event: { Init: { session_id: "s1", api_key_source: "none", model: "claude-opus-5-5" } } });
  expect(await screen.findByText("Writing the plan")).not.toBeNull();
});

test("bus messages show as system lines", async () => {
  renderJob();
  await screen.findByRole("button", { name: /Model/ });
  await emit("agent-event", {
    agent_id: "a1",
    event: { ToolUse: { id: "m1", name: "mcp__factory__spawn_agent", input: { name: "builder" } } },
  });
  expect(await screen.findByRole("status")).toHaveProperty("textContent", "lead started builder");
});

test("the popover shows session token totals under Session tokens and refreshes on the tokens event", async () => {
  usage = { categories: [], totalTokens: 50000, maxTokens: 200000 };
  renderJob();
  fireEvent.click(await screen.findByRole("button", { name: /25% of context used/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Details" }));
  expect(calls.find((c) => c.cmd === "session_tokens")!.args).toEqual({ job_id: "j1" });
  expect(await screen.findByText("Session tokens")).not.toBeNull();
  const part = (label: string) => screen.getAllByText(label).map((node) => node.nextElementSibling?.textContent);
  await screen.findAllByText("Cache read");
  expect(part("Cache read")).toContain("500,000");
  expect(part("Input")).toContain("900");
  expect(part("Cache write")).toContain("2,000");
  expect(part("Output")).toContain("100");
  expect(screen.getByText("Session tokens").nextElementSibling?.textContent).toBe("3k");

  sessionTotal = { ...sessionTotal, uncached: 4500 };
  await act(async () => {
    await emit("tokens", { job_id: "other" });
  });
  expect(screen.getByText("Session tokens").nextElementSibling?.textContent).toBe("3k");
  await act(async () => {
    await emit("tokens", { job_id: "j1" });
  });
  await waitFor(() => expect(screen.getByText("Session tokens").nextElementSibling?.textContent).toBe("4.5k"));
});

test("the status button shows the context share, the popover holds the heading, breakdown and session tokens", async () => {
  usage = { categories: [{ name: "Messages", kind: "used", tokens: 9000 }], totalTokens: 50000, maxTokens: 200000 };
  renderJob();
  const trigger = await screen.findByRole("button", { name: /25% of context used/ });
  expect(trigger.textContent).toContain("25%");
  expect(screen.queryByText("50k of 200k · 25%")).toBeNull();
  fireEvent.click(trigger);
  const context = within(await screen.findByRole("region", { name: "Context" }));
  expect(context.getByText("Messages").nextElementSibling?.textContent).toBe("9k");
  expect(screen.getByText("50k of 200k · 25%")).not.toBeNull();
  expect(screen.queryByText("Session tokens")).toBeNull();
  fireEvent.click(context.getByRole("button", { name: "Details" }));
  expect(context.getByText("Cache read").nextElementSibling?.textContent).toBe("500,000");
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
});

test("without a context window the status button shows the context tokens alone", async () => {
  usage = { categories: [], totalTokens: 42000, maxTokens: 0 };
  renderJob();
  const trigger = await screen.findByRole("button", { name: /42k tokens of context/ });
  expect(trigger.textContent).toContain("42k");
});

test("the context share reloads on Compacted", async () => {
  usage = { categories: [], totalTokens: 50000, maxTokens: 200000 };
  renderJob();
  await screen.findByRole("button", { name: /25% of context used/ });
  usage = { categories: [], totalTokens: 20000, maxTokens: 200000 };
  await act(async () => {
    await emit("agent-event", { job_id: "j1", agent_id: "a1", event: { Compacted: { trigger: "auto", pre_tokens: 50000 } } });
  });
  expect(await screen.findByRole("button", { name: /10% of context used/ })).not.toBeNull();
});

test("the context meter shows a fixed-size skeleton while the usage loads", async () => {
  usage = new Promise(() => {});
  const { container } = renderJob();
  await screen.findByRole("button", { name: /Model/ });
  expect(container.querySelector("[data-slot='skeleton']")).not.toBeNull();
});

test("with only the lead there is no reason line", async () => {
  roster = [agents[0]];
  renderJob();
  await screen.findByRole("button", { name: /Model/ });
  expect(screen.queryByText("plans the work")).toBeNull();
});

test("an idle session shows no status line", async () => {
  roster = agents.map((agent) => ({ ...agent, status: "waiting", permission_mode: "" }));
  renderJob();
  await screen.findByRole("button", { name: /Model/ });
  expect(screen.queryByText("Agents are idle")).toBeNull();
  expect(screen.queryByText(/needs your/)).toBeNull();
  expect(screen.queryByRole("region", { name: "Session status" })).toBeNull();
});

test("the branch chip shows the session branch and its popover the worktree path", async () => {
  renderJob();
  const chip = await screen.findByRole("button", { name: "Branch factory/add-search" });
  expect(chip.textContent).toBe("factory/add-search");
  fireEvent.click(chip);
  expect((await screen.findByRole("button", { name: /~\/code\/app\/\.worktrees\/session/ })).textContent).toBe("~/code/app/.worktrees/session");
  expect(screen.getByRole("button", { name: "Copy worktree path" })).not.toBeNull();
});

test("the activity list follows new messages to the bottom", () => {
  const scrollHeight = vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(500);
  const message = (id: string) => ({ id, agentId: "a1", target: "", label: id, text: id, at: 0 });
  const { rerender } = render(<BusTimeline messages={[message("m1")]} agents={agents} onSelect={() => {}} />);
  const list = screen.getByRole("list", { name: "Agent activity" });
  list.scrollTop = 0;
  rerender(<BusTimeline messages={[message("m1"), message("m2")]} agents={agents} onSelect={() => {}} />);
  expect(list.scrollTop).toBe(500);
  scrollHeight.mockRestore();
});

test("a session with no agents says so instead of staying blank", async () => {
  mockIPC((cmd) => (cmd === "list_agents" || cmd === "list_jobs" ? [] : undefined), { shouldMockEvents: true });
  renderJob();
  expect(await screen.findByText(/No agents yet/)).toBeTruthy();
});
