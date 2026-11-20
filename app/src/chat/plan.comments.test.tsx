import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { ChatView } from "./ChatView";

const sent: unknown[] = [];

beforeEach(() => {
  sent.length = 0;
  mockIPC(
    (cmd, args) => {
      if (cmd === "send_message") sent.push(args);
      return cmd === "agent_history" ? [] : undefined;
    },
    { shouldMockEvents: true },
  );
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

const PLAN = "Intro\n1. **Alpha**: first\n2. **Beta**: second\n3. **Gamma**: third\n";

test("comments on the last plan card in review go to the lead as one message", async () => {
  render(<ChatView agentId="a1" planPhase="review" />);
  await act(async () => {});
  await plan("p1", PLAN);
  const send = screen.getByRole("button", { name: "Send comments" }) as HTMLButtonElement;
  expect(send.disabled).toBe(true);

  fireEvent.change(screen.getByLabelText("Comment on step 3"), { target: { value: " drop this " } });
  fireEvent.change(screen.getByLabelText("Comment on step 1"), { target: { value: "keep short" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Send comments" }));
  });

  expect(sent).toEqual([{ agent_id: "a1", text: "Comments on the plan:\n- Step 1 (Alpha): keep short\n- Step 3 (Gamma): drop this" }]);
  expect((screen.getByLabelText("Comment on step 1") as HTMLInputElement).value).toBe("");
});

test("only the last plan card takes comments, and only in review", async () => {
  const view = render(<ChatView agentId="a1" planPhase="review" />);
  await act(async () => {});
  await plan("p1", PLAN);
  await plan("p2", PLAN);
  expect(screen.getAllByLabelText("Comment on step 1")).toHaveLength(1);

  view.rerender(<ChatView agentId="a1" planPhase="building" />);
  expect(screen.queryByLabelText("Comment on step 1")).toBeNull();
});
