import { afterEach, beforeEach, expect, test } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { App } from "./App";

beforeEach(() => {
  mockIPC((cmd) => (cmd === "list_jobs" || cmd === "list_projects" ? [] : undefined), { shouldMockEvents: true });
  mockWindows("main");
});

afterEach(async () => {
  cleanup();
  localStorage.clear();
  await act(async () => {});
  clearMocks();
});

test("shows the app title and the Home button", async () => {
  render(<App />);
  await act(async () => {});
  expect(screen.queryByRole("heading", { name: "Factory" })).not.toBeNull();
  expect(screen.queryByRole("button", { name: "New" })).not.toBeNull();
});

test("lists the sessions of list_jobs under their project", async () => {
  mockIPC(
    (cmd) =>
      cmd === "list_jobs"
        ? [{ id: "j1", title: "Fix login", status: "building", project_path: "~/code/app", project_name: "app" }]
        : cmd === "list_projects"
          ? []
          : undefined,
    { shouldMockEvents: true },
  );
  mockWindows("main");
  render(<App />);
  expect(await within(await screen.findByRole("navigation", { name: "Sessions" })).findByText("Fix login")).not.toBeNull();
  expect(screen.getByRole("heading", { name: "app" })).not.toBeNull();
});

test("Home and the sidebar render while claude_info is still pending", async () => {
  mockIPC(
    (cmd) => {
      if (cmd === "claude_info") return new Promise(() => {});
      if (cmd === "list_jobs" || cmd === "list_projects" || cmd === "list_agents") return [];
    },
    { shouldMockEvents: true },
  );
  mockWindows("main");
  render(<App />);
  await act(async () => {});
  expect(screen.queryByRole("combobox", { name: "What should we build?" })).not.toBeNull();
});

test("a planning session with no agent at work is idle and asks for nothing", async () => {
  mockIPC(
    (cmd) =>
      cmd === "list_jobs"
        ? [{ id: "j1", title: "What agents", status: "planning", active: false, project_path: "~/code/app", project_name: "app" }]
        : cmd === "list_projects"
          ? []
          : undefined,
    { shouldMockEvents: true },
  );
  mockWindows("main");
  render(<App />);
  expect(await within(await screen.findByRole("navigation", { name: "Sessions" })).findByText("Idle")).not.toBeNull();
  expect(screen.queryByText("Your turn")).toBeNull();
  expect(screen.queryByRole("region", { name: "Needs attention" })).toBeNull();
  expect(screen.queryByRole("region", { name: "Running" })).toBeNull();
});

test("a second turn leaves Idle at its Init event and returns to Idle at its Result", async () => {
  let active = false;
  mockIPC(
    (cmd) =>
      cmd === "list_jobs"
        ? [{ id: "j1", title: "What agents", status: "planning", active, project_path: "~/code/app", project_name: "app" }]
        : cmd === "list_projects"
          ? []
          : undefined,
    { shouldMockEvents: true },
  );
  mockWindows("main");
  render(<App />);
  const sidebar = within(await screen.findByRole("navigation", { name: "Sessions" }));
  await sidebar.findByText("Idle");
  active = true;
  await act(() => emit("agent-event", { job_id: "j1", agent_id: "a1", event: { Init: { session_id: "s1", api_key_source: "none", model: "claude-opus-5-5" } } }));
  expect(sidebar.queryByText("Idle")).toBeNull();
  expect(sidebar.getByText("Planning")).not.toBeNull();
  active = false;
  await act(() => emit("agent-event", { job_id: "j1", agent_id: "a1", event: { Result: { session_id: "s1", outcome: "Finished" } } }));
  expect(sidebar.getByText("Idle")).not.toBeNull();
});

test("a session with an open permission request is listed under Needs attention", async () => {
  mockIPC(
    (cmd) =>
      cmd === "list_jobs"
        ? [{ id: "j1", title: "Fix login", status: "building", active: true, project_path: "~/code/app", project_name: "app" }]
        : cmd === "list_projects"
          ? []
          : undefined,
    { shouldMockEvents: true },
  );
  mockWindows("main");
  render(<App />);
  await within(await screen.findByRole("navigation", { name: "Sessions" })).findByText("Fix login");
  expect(screen.queryByRole("region", { name: "Needs attention" })).toBeNull();
  await act(() => emit("agent-event", { job_id: "j1", agent_id: "a1", event: { ControlRequest: { request_id: "r1", tool_name: "Bash", input: { command: "npm test" } } } }));
  expect(within(screen.getByRole("region", { name: "Needs attention" })).getByText("Fix login")).not.toBeNull();
});

test("picking a colour in Settings sets the palette on the root", async () => {
  render(<App />);
  await act(async () => {});
  expect(document.documentElement.dataset.palette).toBe("graphite");
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await act(async () => {});
  fireEvent.click(within(screen.getByRole("group", { name: "Color" })).getByRole("button", { name: "Red" }));
  expect(document.documentElement.dataset.palette).toBe("oxide");
});

test("dock badge shows the number of agents with an open permission request and clears at zero", async () => {
  const badges: unknown[] = [];
  mockIPC(
    (cmd, args) => {
      if (cmd === "plugin:window|set_badge_count") badges.push((args as { value?: number }).value);
      if (cmd === "list_jobs" || cmd === "list_projects") return [];
    },
    { shouldMockEvents: true },
  );
  mockWindows("main");
  render(<App />);
  await act(async () => {});
  const ask = (agent_id: string) => emit("agent-event", { job_id: `j-${agent_id}`, agent_id, event: { ControlRequest: { request_id: "r1", tool_name: "Bash", input: {} } } });
  await act(() => ask("a1"));
  expect(badges.at(-1)).toBe(1);
  await act(() => ask("a2"));
  expect(badges.at(-1)).toBe(2);
  await act(() => emit("agent-event", { job_id: "j-a1", agent_id: "a1", event: { Result: { session_id: "s1", outcome: "Finished" } } }));
  await act(() => emit("agent-event", { job_id: "j-a2", agent_id: "a2", event: { Result: { session_id: "s2", outcome: "Finished" } } }));
  expect(badges.at(-1)).toBeUndefined();
});
