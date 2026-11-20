import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { SettingsBanner } from "./SettingsBanner";
import type { AgentRow } from "./types";

const agent: AgentRow = { id: "a1", name: "lead", role: "lead", model: "claude-opus-5-5", effort: "high", why: "plans", worktree: "~/code/app", status: "waiting", permission_mode: "" };

let calls: { cmd: string; args: unknown }[];
let changed: boolean;

beforeEach(() => {
  calls = [];
  changed = false;
  mockIPC(
    (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "settings_changed") return changed;
    },
    { shouldMockEvents: true },
  );
});

afterEach(async () => {
  cleanup();
  await act(async () => {});
  clearMocks();
});

const checks = () => calls.filter((c) => c.cmd === "settings_changed").length;

test("shows nothing while the settings are unchanged", async () => {
  render(<SettingsBanner agent={agent} onRestart={() => {}} />);
  await waitFor(() => expect(checks()).toBe(1));
  expect(screen.queryByText(/Settings changed/)).toBeNull();
});

test("shows the banner and restarts the agent with its model and effort", async () => {
  changed = true;
  const onRestart = vi.fn();
  render(<SettingsBanner agent={agent} onRestart={onRestart} />);
  expect(await screen.findByText(/Settings changed since this agent started/)).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Restart" }));
  await waitFor(() => expect(onRestart).toHaveBeenCalled());
  expect(calls.find((c) => c.cmd === "set_agent_model")!.args).toEqual({ agent_id: "a1", model: "claude-opus-5-5", effort: "high" });
});

test("hides the banner after Restart once the settings are loaded", async () => {
  changed = true;
  mockIPC(
    (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "set_agent_model") changed = false;
      if (cmd === "settings_changed") return changed;
    },
    { shouldMockEvents: true },
  );
  render(<SettingsBanner agent={agent} onRestart={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "Restart" }));
  await waitFor(() => expect(screen.queryByText(/Settings changed/)).toBeNull());
});

test("disables Restart while the agent is running", async () => {
  changed = true;
  render(<SettingsBanner agent={{ ...agent, status: "running", permission_mode: "" }} onRestart={() => {}} />);
  const button = await screen.findByRole("button", { name: "Restart" });
  expect((button as HTMLButtonElement).disabled).toBe(true);
});

test("checks again on this agent's Result event and on window focus", async () => {
  render(<SettingsBanner agent={agent} onRestart={() => {}} />);
  await waitFor(() => expect(checks()).toBe(1));
  changed = true;
  await act(async () => {
    await emit("agent-event", { agent_id: "other", event: { Result: {} } });
  });
  expect(checks()).toBe(1);
  await act(async () => {
    await emit("agent-event", { agent_id: "a1", event: { Result: {} } });
  });
  await screen.findByText(/Settings changed/);
  const afterResult = checks();
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  await waitFor(() => expect(checks()).toBe(afterResult + 1));
});
