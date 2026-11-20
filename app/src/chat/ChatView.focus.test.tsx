import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { ChatView, type Focus } from "./ChatView";

const scrolled: Element[] = [];

const history = [
  { User: { text: "repeat" } },
  { Event: { Assistant: { content: "first answer" } } },
  { User: { text: "first question" } },
  { Event: { Assistant: { content: "repeat" } } },
];

beforeEach(() => {
  scrolled.length = 0;
  mockIPC((cmd) => (cmd === "agent_history" ? history : undefined), { shouldMockEvents: true });
  Element.prototype.scrollIntoView = function () {
    scrolled.push(this);
  };
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

const focus = (over: Partial<Focus>): Focus => ({ agentId: "a1", text: "first question", seq: 0, key: 1, ...over });

test("a hit scrolls to and marks its message once the history is loaded", async () => {
  render(<ChatView agentId="a1" focus={focus({ text: "first answer", seq: 1 })} />);
  await act(async () => {});

  const row = screen.getByText("first answer").closest("[data-focused]");
  expect(row).not.toBeNull();
  expect(scrolled).toContain(row);
});

test("equal texts resolve to the one nearest the hit's position", async () => {
  render(<ChatView agentId="a1" focus={focus({ text: "repeat", seq: 3 })} />);
  await act(async () => {});

  const [user, assistant] = screen.getAllByText("repeat");
  expect(user.closest("[data-focused]")).toBeNull();
  expect(assistant.closest("[data-focused]")).not.toBeNull();
});

test("a hit that matches no message leaves the chat unmarked", async () => {
  render(<ChatView agentId="a1" focus={focus({ text: "never said", seq: 1 })} />);
  await act(async () => {});

  expect(document.querySelector("[data-focused]")).toBeNull();
  expect(scrolled).toHaveLength(0);
});
