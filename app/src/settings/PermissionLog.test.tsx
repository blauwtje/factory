import { afterEach, beforeEach, expect, test } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { PermissionLog } from "./PermissionLog";

const projects = [
  { path: "~/code/app", name: "app", last_used: 2 },
  { path: "~/code/other", name: "other", last_used: 1 },
];
const entry = { job_id: "j1", agent_id: "lead" };
const log = [
  { ...entry, time: 200, tool_name: "Bash", input: { command: "git reset --hard" }, decision: "deny", reason: "Too risky" },
  { ...entry, time: 100, tool_name: "Read", input: { file_path: "/work/.env" }, decision: "allow_once" },
];
let calls: [string, unknown][] = [];
let answers: Record<string, unknown> = {};

beforeEach(() => {
  calls = [];
  answers = { list_projects: projects, permission_log: log };
  mockIPC((cmd, args) => {
    calls.push([cmd, args]);
    return answers[cmd];
  });
});

afterEach(async () => {
  cleanup();
  await act(async () => {});
  clearMocks();
});

async function open() {
  render(<PermissionLog />);
  await act(async () => {});
}

test("loads the log of all projects by default", async () => {
  await open();
  expect(calls.filter(([cmd]) => cmd === "permission_log").map(([, args]) => args)).toEqual([{ project_path: null }]);
});

test("lists the answers in the order received with tool, command or path, answer and reason", async () => {
  await open();
  const rows = screen.getAllByRole("listitem");
  expect(rows).toHaveLength(2);
  expect(within(rows[0]).getByText("Bash")).toBeTruthy();
  expect(within(rows[0]).getByText("git reset --hard")).toBeTruthy();
  expect(within(rows[0]).getByText("Denied")).toBeTruthy();
  expect(within(rows[0]).getByText("Too risky")).toBeTruthy();
  expect(within(rows[1]).getByText("/work/.env")).toBeTruthy();
  expect(within(rows[1]).getByText("Allowed once")).toBeTruthy();
});

test("says so when there are no answers", async () => {
  answers.permission_log = [];
  await open();
  expect(screen.getByText("No permission answers yet.")).toBeTruthy();
});
