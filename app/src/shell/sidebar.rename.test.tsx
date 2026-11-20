import { afterEach, beforeEach, expect, test } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { Toaster } from "@/components/ui/sonner";
import { Shell } from "./Shell";
import type { ProjectSummary } from "./types";

const claude = { info: { path: "~/.local/bin/claude", version: "2.1.326" } };
const projects: ProjectSummary[] = [{ path: "~/code/app", name: "app", sessions: [{ id: "j1", title: "First", status: "waiting" }] }];

let calls: { cmd: string; args: unknown }[] = [];
let failRename = false;

beforeEach(() => {
  calls = [];
  failRename = false;
  mockIPC(
    (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "claude_stats") throw new Error("no stats in tests");
      if (cmd === "rename_job" && failRename) throw new Error("disk full");
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

async function openRename() {
  const row = screen.getByTitle("First").closest("div") as HTMLElement;
  fireEvent.click(within(row).getByRole("button", { name: "More options" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));
  return (await screen.findByLabelText("Title")) as HTMLInputElement;
}

const renameCalls = () => calls.filter((call) => call.cmd === "rename_job");

test("Rename opens a dialog with the current title", async () => {
  render(<Shell projects={projects} claude={claude} />);
  expect((await openRename()).value).toBe("First");
});

test("Save renames the session", async () => {
  render(<Shell projects={projects} claude={claude} />);
  const input = await openRename();
  fireEvent.change(input, { target: { value: "Second" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(renameCalls()[0]?.args).toEqual({ job_id: "j1", title: "Second" }));
});

test("Enter saves", async () => {
  render(<Shell projects={projects} claude={claude} />);
  const input = await openRename();
  fireEvent.change(input, { target: { value: "Second" } });
  fireEvent.submit(input.closest("form") as HTMLFormElement);
  await waitFor(() => expect(renameCalls()).toHaveLength(1));
});

test("Save is disabled while the title is blank", async () => {
  render(<Shell projects={projects} claude={claude} />);
  const input = await openRename();
  fireEvent.change(input, { target: { value: "   " } });
  expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.submit(input.closest("form") as HTMLFormElement);
  expect(renameCalls()).toHaveLength(0);
});

test("a failed rename toasts", async () => {
  failRename = true;
  render(
    <>
      <Shell projects={projects} claude={claude} />
      <Toaster />
    </>,
  );
  const input = await openRename();
  fireEvent.change(input, { target: { value: "Second" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("Could not rename the session")).not.toBeNull();
});
