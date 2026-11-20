import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { ChatView } from "./ChatView";

beforeEach(() => {
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

test("a live compaction shows a divider with trigger and tokens", async () => {
  mockIPC((cmd) => (cmd === "agent_history" ? [] : undefined), { shouldMockEvents: true });
  render(<ChatView agentId="a1" />);
  await act(async () => {});
  await act(async () => {
    await emit("agent-event", { agent_id: "a1", event: { Compacted: { trigger: "manual", pre_tokens: 3550 } } });
  });
  expect(screen.getByRole("separator").textContent).toBe("Context compacted · manual · 4k tokens before");
});

test("a compaction in the history shows a divider and keeps the turn idle", async () => {
  mockIPC(
    (cmd) => (cmd === "agent_history" ? [{ User: { text: "hi" } }, { Event: { Compacted: { trigger: "auto", pre_tokens: 168000 } } }] : undefined),
    { shouldMockEvents: true },
  );
  render(<ChatView agentId="a1" />);
  await act(async () => {});
  expect(screen.getByRole("separator").textContent).toBe("Context compacted · auto · 168k tokens before");
  expect(screen.queryByRole("status")).toBeNull();
});
