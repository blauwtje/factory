import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { Toaster } from "@/components/ui/sonner";
import { Shell } from "./Shell";
import type { ProjectSummary } from "./types";

const claude = { info: { path: "~/.local/bin/claude", version: "2.1.326" } };
const projects: ProjectSummary[] = [{ path: "~/code/app", name: "app", sessions: [{ id: "j1", title: "First", status: "waiting" }] }];
const command = "cd '~/code/app' && claude --resume s1";

let running = false;
let failResume = false;
const written: string[] = [];

beforeEach(() => {
  running = false;
  failResume = false;
  written.length = 0;
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn(async (text: string) => void written.push(text)) } });
  mockIPC(
    (cmd) => {
      if (cmd === "claude_stats") throw new Error("no stats in tests");
      if (cmd === "resume_command") {
        if (failResume) throw new Error("the worktree of this session was cleaned up, so it cannot be resumed");
        return { command, running };
      }
      return cmd === "list_roles" || cmd === "list_projects" ? [] : undefined;
    },
    { shouldMockEvents: true },
  );
});

afterEach(async () => {
  cleanup();
  localStorage.clear();
  await act(async () => {});
  clearMocks();
});

async function copyResume() {
  render(
    <>
      <Shell projects={projects} claude={claude} />
      <Toaster />
    </>,
  );
  const row = screen.getByTitle("First").closest("div") as HTMLElement;
  fireEvent.click(within(row).getByRole("button", { name: "More options" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Copy resume command" }));
}

test("copies the resume command and toasts it", async () => {
  await copyResume();
  expect(await screen.findByText("Copied resume command")).not.toBeNull();
  expect(written).toEqual([command]);
  expect(screen.getByText(command)).not.toBeNull();
});

test("warns while the session runs", async () => {
  running = true;
  await copyResume();
  expect(await screen.findByText(/This session still runs in Factory; resuming it in a terminal as well runs two agents in one worktree\./)).not.toBeNull();
  expect(written).toEqual([command]);
});

test("a refused command toasts the failure", async () => {
  failResume = true;
  await copyResume();
  expect(await screen.findByText("Could not copy the resume command")).not.toBeNull();
  expect(written).toEqual([]);
});
