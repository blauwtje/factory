import { StrictMode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { ChatView } from "./ChatView";
import type { StreamEvent } from "./types";

let calls: { cmd: string; args: unknown }[];

beforeEach(() => {
  calls = [];
  mockIPC(
    (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "agent_history") return [];
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function send(agent_id: string, event: StreamEvent) {
  await act(async () => {
    await emit("agent-event", { agent_id, event });
  });
}

async function mounted(agentId = "a1") {
  render(<ChatView agentId={agentId} />);
  await act(async () => {});
}

test("text deltas stream into one assistant message", async () => {
  await mounted();
  await send("a1", { TextDelta: { text: "Hello " } });
  await send("a1", { TextDelta: { text: "world" } });
  await waitFor(() => expect(screen.getByText("Hello world")).not.toBeNull());
});

test("events for another agent are ignored", async () => {
  await mounted();
  await send("a2", { TextDelta: { text: "secret" } });
  expect(screen.queryByText("secret")).toBeNull();
});

test("a tool card shows its result once the result arrives", async () => {
  await mounted();
  await send("a1", { ToolUse: { id: "t1", name: "Bash", input: { command: "ls -la" } } });
  const card = await screen.findByRole("group", { name: "Tool Bash" });
  expect(within(card).getByText("ls -la")).not.toBeNull();
  expect(within(card).getByRole("img", { name: "Running" })).not.toBeNull();
  await send("a1", { ToolResult: { id: "t1", output: "total 0", is_error: false } });
  expect(within(card).getByText("total 0")).not.toBeNull();
  expect(within(card).getByRole("img", { name: "Done" })).not.toBeNull();
});

test("a tool row with a copy button reserves room for it beside the chevron", async () => {
  await mounted();
  await send("a1", { ToolUse: { id: "t1", name: "Bash", input: { command: "ls -la" } } });
  const card = await screen.findByRole("group", { name: "Tool Bash" });
  expect(card.querySelector(".pr-7")).not.toBeNull();
});

test("an Edit tool card shows the removed and added lines as a diff", async () => {
  await mounted();
  await send("a1", {
    ToolUse: { id: "t2", name: "Edit", input: { file_path: "src/a.ts", old_string: "const a = 1;", new_string: "const a = 2;" } },
  });
  const card = await screen.findByRole("group", { name: "Tool Edit" });
  const line = (type: string) => card.querySelector("diffs-container")?.shadowRoot?.querySelector(`[data-content] [data-line-type="${type}"]`);
  await waitFor(() => expect(line("change-deletion")?.textContent).toBe("const a = 1;"));
  expect(line("change-addition")?.textContent).toBe("const a = 2;");
});

test("Allow once answers the permission request", async () => {
  await mounted();
  await send("a1", { ControlRequest: { request_id: "r1", tool_name: "Bash", input: { command: "rm x" } } });
  const card = await screen.findByRole("region", { name: "Permission Bash" });
  fireEvent.click(within(card).getByRole("button", { name: "Allow once" }));
  await waitFor(() => expect(calls.map((c) => c.cmd)).toContain("answer_permission"));
  expect(calls.find((c) => c.cmd === "answer_permission")!.args).toEqual({
    agent_id: "a1",
    request_id: "r1",
    decision: "AllowOnce",
  });
  expect(within(card).queryByRole("button", { name: "Deny" })).toBeNull();
});

test("Always allow and Deny send their decisions", async () => {
  await mounted();
  await send("a1", { ControlRequest: { request_id: "r1", tool_name: "Bash", input: {} } });
  await send("a1", { ControlRequest: { request_id: "r2", tool_name: "Write", input: {} } });
  fireEvent.click(within(await screen.findByRole("region", { name: "Permission Bash" })).getByRole("button", { name: "Always allow" }));
  fireEvent.click(within(await screen.findByRole("region", { name: "Permission Write" })).getByRole("button", { name: "Deny" }));
  await waitFor(() => expect(calls.filter((c) => c.cmd === "answer_permission")).toHaveLength(2));
  const decisions = calls.filter((c) => c.cmd === "answer_permission").map((c) => (c.args as { decision: unknown }).decision);
  expect(decisions).toEqual(["AllowAlways", { Deny: { reason: "Denied by the user" } }]);
});

test("Shift+Enter answers the focused request with Always allow", async () => {
  await mounted();
  await send("a1", { ControlRequest: { request_id: "r1", tool_name: "Bash", input: {} } });
  await send("a1", { ControlRequest: { request_id: "r2", tool_name: "Write", input: {} } });
  const card = await screen.findByRole("region", { name: "Permission Write" });
  card.focus();
  fireEvent.keyDown(card, { key: "Enter", shiftKey: true });
  await waitFor(() => expect(calls.map((c) => c.cmd)).toContain("answer_permission"));
  expect(calls.filter((c) => c.cmd === "answer_permission").map((c) => c.args)).toEqual([
    { agent_id: "a1", request_id: "r2", decision: "AllowAlways" },
  ]);
});

test("a key pressed with focus on the page body answers no request", async () => {
  await mounted();
  await send("a1", { ControlRequest: { request_id: "r1", tool_name: "Bash", input: {} } });
  const card = await screen.findByRole("region", { name: "Permission Bash" });
  fireEvent.keyDown(document.body, { key: "d" });
  await act(async () => {});
  expect(within(card).getByRole("button", { name: "Deny" })).not.toBeNull();
  expect(calls.map((c) => c.cmd)).not.toContain("answer_permission");
});

test("sending a message shows it and invokes send_message", async () => {
  await mounted();
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "make a README" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(calls.map((c) => c.cmd)).toContain("send_message"));
  expect(calls.find((c) => c.cmd === "send_message")!.args).toEqual({ agent_id: "a1", text: "make a README" });
  expect(screen.getByText("make a README")).not.toBeNull();
});

test("permission key hints stay dimmed until the card itself has focus", async () => {
  await mounted();
  await send("a1", { ControlRequest: { request_id: "r1", tool_name: "Bash", input: { command: "ls" } } });
  const card = await screen.findByRole("region", { name: "Permission Bash" });
  const dimmed = () => [...card.querySelectorAll("kbd")].every((kbd) => kbd.classList.contains("opacity-60"));
  expect(card.querySelectorAll("kbd")).toHaveLength(3);
  expect(dimmed()).toBe(true);
  act(() => card.focus());
  expect(dimmed()).toBe(false);
  act(() => card.blur());
  expect(dimmed()).toBe(true);
});

test("the composer asks for an answer to an open permission request first", async () => {
  await mounted();
  await send("a1", { ControlRequest: { request_id: "r1", tool_name: "Bash", input: { command: "ls" } } });
  expect(await screen.findByPlaceholderText("Allow or deny the request above first")).not.toBeNull();
  fireEvent.click(within(screen.getByRole("region", { name: "Permission Bash" })).getByRole("button", { name: "Allow once" }));
  expect(await screen.findByPlaceholderText("Message the agent")).not.toBeNull();
});

test("a reopened chat shows the earlier messages of its session", async () => {
  mockIPC(
    (cmd) =>
      cmd === "agent_history"
        ? [{ User: { text: "what agents do you have?" } }, { Event: { Assistant: { content: "None are running." } } }]
        : undefined,
    { shouldMockEvents: true },
  );
  await mounted();
  expect(screen.getByText("what agents do you have?")).not.toBeNull();
  expect(screen.getByText("None are running.")).not.toBeNull();
});

test("a reopened chat shows its history once in strict mode", async () => {
  mockIPC((cmd) => (cmd === "agent_history" ? [{ User: { text: "only once" } }] : undefined), { shouldMockEvents: true });
  render(
    <StrictMode>
      <ChatView agentId="a1" />
    </StrictMode>,
  );
  await act(async () => {});
  expect(screen.getAllByText("only once")).toHaveLength(1);
});

test("Stop interrupts the agent and denies the open permission requests", async () => {
  await mounted();
  await send("a1", { ControlRequest: { request_id: "r1", tool_name: "Bash", input: { command: "ls" } } });
  fireEvent.click(await screen.findByRole("button", { name: "Stop" }));
  await waitFor(() => expect(calls.map((c) => c.cmd)).toContain("interrupt_agent"));
  expect(calls.find((c) => c.cmd === "interrupt_agent")!.args).toEqual({ agent_id: "a1" });
  expect(within(screen.getByRole("region", { name: "Permission Bash" })).getByText("Denied")).not.toBeNull();
});

test("two messages sent mid-turn share the one turn that follows the result", async () => {
  await mounted();
  await send("a1", { Init: { session_id: "s", api_key_source: "none", model: "m" } });
  await send("a1", { TextDelta: { text: "first answer" } });
  for (const text of ["say banana", "say cherry"]) {
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: text } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
  }
  expect(screen.getAllByText("Queued")).toHaveLength(2);
  await send("a1", { Result: { session_id: "s", outcome: "Finished" } });
  expect(screen.queryByText("Queued")).toBeNull();
  await send("a1", { Init: { session_id: "s", api_key_source: "none", model: "m" } });
  await send("a1", { Assistant: { content: "banana\ncherry" } });
  await send("a1", { Result: { session_id: "s", outcome: "Finished" } });
  expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
});

test("a message sent mid-turn is queued until the turn's result, which keeps the agent working", async () => {
  await mounted();
  await send("a1", { Init: { session_id: "s", api_key_source: "none", model: "m" } });
  await send("a1", { TextDelta: { text: "first answer" } });
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "and then this" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(screen.getByText("Queued")).not.toBeNull();
  await send("a1", { Result: { session_id: "s", outcome: "Finished" } });
  expect(screen.queryByText("Queued")).toBeNull();
  expect(screen.getByText("and then this")).not.toBeNull();
  expect(screen.getByRole("button", { name: "Stop" })).not.toBeNull();
  await send("a1", { Init: { session_id: "s", api_key_source: "none", model: "m" } });
  await send("a1", { TextDelta: { text: "second answer" } });
  await send("a1", { Result: { session_id: "s", outcome: "Finished" } });
  expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
});

test("a finished turn ends without a files and copy line", async () => {
  await mounted();
  await send("a1", { Init: { session_id: "s", api_key_source: "none", model: "m" } });
  await send("a1", { TextDelta: { text: "working on it" } });
  await send("a1", { Result: { session_id: "s", outcome: "Finished" } });
  expect(screen.queryByRole("button", { name: "Copy as Markdown" })).toBeNull();
});

test("a background shell update does not turn an idle chat into a working one", async () => {
  await mounted();
  await send("a1", { TextDelta: { text: "done" } });
  await send("a1", { Result: { session_id: "s1", outcome: "Finished" } });
  await send("a1", { Tasks: { tasks: [{ task_id: "t1", task_type: "local_bash", description: "npm run dev" }] } });
  expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  expect(screen.getByRole("button", { name: "Send" })).not.toBeNull();
});
