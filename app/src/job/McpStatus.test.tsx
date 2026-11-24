import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { McpSection, useMcpServers } from "./McpStatus";
import type { McpServer } from "@/ipc";

let calls: { cmd: string; args: unknown }[];
let servers: McpServer[];
let failStatus: boolean;

beforeEach(() => {
  calls = [];
  failStatus = false;
  servers = [
    { name: "github", status: "connected" },
    { name: "docs", status: "failed", error: "spawn ENOENT" },
  ];
  mockIPC(
    (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "mcp_status") {
        if (failStatus) throw new Error("no status");
        return servers;
      }
    },
    { shouldMockEvents: true },
  );
});

afterEach(async () => {
  cleanup();
  await act(async () => {});
  clearMocks();
});

function Harness() {
  const { servers, reconnect } = useMcpServers("a1");
  return <McpSection servers={servers} onReconnect={reconnect} />;
}

const statusCalls = () => calls.filter((c) => c.cmd === "mcp_status").length;

test("explains that there are no servers when the status call fails or lists none", async () => {
  failStatus = true;
  render(<Harness />);
  await waitFor(() => expect(statusCalls()).toBe(1));
  expect(screen.getByText(/No MCP servers are connected/)).not.toBeNull();
});

test("lists each server with its status and error and offers Reconnect on failed rows only", async () => {
  render(<Harness />);
  expect(await screen.findByText("github")).not.toBeNull();
  expect(screen.getByText("Connected")).not.toBeNull();
  expect(screen.getByText("Failed")).not.toBeNull();
  expect(screen.getByText("spawn ENOENT")).not.toBeNull();
  expect(screen.getAllByRole("button", { name: "Reconnect" })).toHaveLength(1);
});

test("marks the servers Factory adds itself as built in", async () => {
  servers = [
    { name: "factory", status: "connected" },
    { name: "browser", status: "connected" },
    { name: "github", status: "connected" },
  ];
  render(<Harness />);
  expect(await screen.findByText("github")).not.toBeNull();
  expect(screen.getAllByText("Built in")).toHaveLength(2);
});

test("reconnects the failed server and loads the status again", async () => {
  render(<Harness />);
  const before = statusCalls();
  fireEvent.click(await screen.findByRole("button", { name: "Reconnect" }));
  await waitFor(() => expect(statusCalls()).toBe(before + 1));
  expect(calls.find((c) => c.cmd === "mcp_reconnect")!.args).toEqual({ agent_id: "a1", server: "docs" });
});

test("loads again on this agent's Result event only", async () => {
  render(<Harness />);
  await waitFor(() => expect(statusCalls()).toBe(1));
  await act(async () => {
    await emit("agent-event", { agent_id: "other", event: { Result: {} } });
  });
  expect(statusCalls()).toBe(1);
  await act(async () => {
    await emit("agent-event", { agent_id: "a1", event: { Result: {} } });
  });
  await waitFor(() => expect(statusCalls()).toBe(2));
});

test("offers a link to Customize when the caller provides one", async () => {
  const onCustomize = vi.fn();
  render(<McpSection servers={[]} onReconnect={() => {}} onCustomize={onCustomize} />);
  fireEvent.click(screen.getByRole("button", { name: "Manage in Customize" }));
  expect(onCustomize).toHaveBeenCalled();
});
