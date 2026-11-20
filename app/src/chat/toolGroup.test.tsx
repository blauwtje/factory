import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { openPath } from "@tauri-apps/plugin-opener";
import { ChatView } from "./ChatView";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(() => Promise.resolve()), openPath: vi.fn(() => Promise.resolve()) }));

beforeEach(() => {
  mockIPC((cmd) => (cmd === "agent_history" ? [] : undefined), { shouldMockEvents: true });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(async () => {
  cleanup();
  await act(async () => {});
  clearMocks();
  vi.unstubAllGlobals();
});

async function emitEvent(event: object) {
  await act(async () => {
    await emit("agent-event", { agent_id: "a1", event });
  });
}

async function call(id: string, name: string, input: Record<string, unknown>, result?: { output: string; is_error?: boolean }) {
  await emitEvent({ ToolUse: { id, name, input } });
  if (result) await emitEvent({ ToolResult: { id, output: result.output, is_error: result.is_error ?? false } });
}

async function mounted() {
  render(<ChatView agentId="a1" />);
  await act(async () => {});
}

test("three reads and two commands make one summary with the right counts", async () => {
  await mounted();
  for (const [id, file] of [["r1", "a.ts"], ["r2", "b.ts"], ["r3", "c.ts"]]) await call(id, "Read", { file_path: `~/code/app/${file}` }, { output: "x" });
  await call("b1", "Bash", { command: "ls" }, { output: "ok" });
  await call("b2", "Bash", { command: "pwd" }, { output: "ok" });
  expect(screen.getAllByRole("group", { name: "Tool group" })).toHaveLength(1);
  expect(screen.getByText("Read 3 files, ran 2 commands")).not.toBeNull();
});

test("a running group summarizes in the present tense", async () => {
  await mounted();
  await call("r1", "Read", { file_path: "~/code/app/a.ts" });
  await call("b1", "Bash", { command: "ls" });
  const group = screen.getByRole("group", { name: "Tool group" });
  expect(group.querySelector("button")?.textContent).toContain("Reading 1 file, running 1 command…");
});

test("a failed call opens the group and shows the error line", async () => {
  await mounted();
  await call("r1", "Read", { file_path: "~/code/app/a.ts" }, { output: "fine" });
  await call("b1", "Bash", { command: "npm test" }, { output: "\nboom: tests failed\nmore", is_error: true });
  const group = screen.getByRole("group", { name: "Tool group" });
  expect(group.querySelector("[data-panel-open]")).not.toBeNull();
  expect(screen.getAllByText("boom: tests failed").length).toBeGreaterThan(0);
});

test("a clean group stays closed until clicked", async () => {
  await mounted();
  await call("r1", "Read", { file_path: "~/code/app/a.ts" }, { output: "fine" });
  await call("r2", "Read", { file_path: "~/code/app/b.ts" }, { output: "fine" });
  const trigger = screen.getByRole("button", { name: /Read 2 files/ });
  expect(trigger.hasAttribute("data-panel-open")).toBe(false);
  fireEvent.click(trigger);
  expect(trigger.hasAttribute("data-panel-open")).toBe(true);
});

test("a file path in a tool row opens the file", async () => {
  await mounted();
  await call("r1", "Read", { file_path: "~/code/app/a.ts" }, { output: "fine" });
  fireEvent.click(screen.getByRole("button", { name: "~/code/app/a.ts" }));
  expect(openPath).toHaveBeenCalledWith("~/code/app/a.ts");
});
