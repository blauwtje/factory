import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { ChatView } from "./ChatView";

beforeEach(() => {
  mockIPC((cmd) => (cmd === "agent_history" ? [] : undefined),{ shouldMockEvents: true });
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

async function call(id: string, name: string, input: Record<string, unknown>) {
  await act(async () => {
    await emit("agent-event", { agent_id: "a1", event: { ToolUse: { id, name, input } } });
  });
}

test("three equal tool calls in a row show one warning row", async () => {
  render(<ChatView agentId="a1" />);
  await act(async () => {});
  await call("t1", "Bash", { command: "npm test" });
  await call("t2", "Bash", { command: "npm test" });
  expect(screen.queryAllByRole("status")).toHaveLength(0);
  await call("t3", "Bash", { command: "npm test" });
  expect(screen.getAllByRole("status").map((node) => node.textContent)).toEqual(["Same Bash call 3 times in a row"]);
});

test("a different call in between breaks the run", async () => {
  render(<ChatView agentId="a1" />);
  await act(async () => {});
  await call("t1", "Bash", { command: "npm test" });
  await call("t2", "Bash", { command: "npm test" });
  await call("t3", "Bash", { command: "ls" });
  await call("t4", "Bash", { command: "npm test" });
  expect(screen.queryAllByRole("status")).toHaveLength(0);
});
