import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { ChatView } from "./ChatView";

let resolveHistory: (turns: unknown[]) => void;

beforeEach(() => {
  mockIPC(
    (cmd) => {
      if (cmd === "agent_history") return new Promise((resolve) => (resolveHistory = resolve));
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

test("a live row keeps its DOM node when history resolves after it", async () => {
  render(<ChatView agentId="a1" />);
  await act(async () => {});
  await act(async () => {
    await emit("agent-event", { agent_id: "a1", event: { TextDelta: { text: "live reply" } } });
  });
  const before = screen.getByText("live reply");

  await act(async () => {
    resolveHistory([{ User: { text: "earlier question" } }, { Event: { TextDelta: { text: "earlier answer" } } }]);
  });

  expect(screen.getByText("earlier question")).not.toBeNull();
  expect(screen.getByText("live reply")).toBe(before);
});
