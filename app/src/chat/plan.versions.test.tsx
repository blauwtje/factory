import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { ChatView } from "./ChatView";

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

async function emitEvent(event: unknown) {
  await act(async () => {
    await emit("agent-event", { agent_id: "a1", event });
  });
}

async function plan(id: string, text: string) {
  await emitEvent({ ToolUse: { id, name: "mcp__factory__plan_ready", input: { path: "plan.md" } } });
  await emitEvent({ ToolResult: { id, output: "ok", is_error: false } });
  await emitEvent({ Assistant: { content: text } });
}

test("a revised plan card marks new and changed steps and lists removed ones; the first card has none", async () => {
  render(<ChatView agentId="a1" planPhase="review" />);
  await act(async () => {});
  await plan("p1", "Intro\n1. **Alpha**: first\n2. **Beta**: second\n3. **Gamma**: third\n");
  expect(screen.queryByText("New")).toBeNull();
  expect(screen.queryByText("Changed")).toBeNull();
  expect(screen.queryByText("Removed since the last version")).toBeNull();

  await plan("p2", "Intro\n1. **Alpha**: first\n2. **Beta**: second, reworded\n3. **Delta**: fourth\n");
  expect(screen.getAllByText("New")).toHaveLength(1);
  expect(screen.getAllByText("Changed")).toHaveLength(1);
  expect(screen.getByText("Removed since the last version")).toBeTruthy();
});

test("the removed list renders inline code instead of raw backticks", async () => {
  render(<ChatView agentId="a1" planPhase="review" />);
  await act(async () => {});
  await plan("p1", "Intro\n1. Alpha first\n2. Edit `math.js` now\n");
  await plan("p2", "Intro\n1. Alpha first\n");
  const removed = screen.getByText("Removed since the last version").parentElement as HTMLElement;
  expect(removed.textContent).not.toContain("`");
  expect(within(removed).getByText("math.js").tagName).toBe("CODE");
});
