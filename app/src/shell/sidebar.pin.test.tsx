import { afterEach, beforeEach, expect, test } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { Toaster } from "@/components/ui/sonner";
import { Shell } from "./Shell";
import type { ProjectSummary } from "./types";

const claude = { info: { path: "~/.local/bin/claude", version: "2.1.326" } };
const projects: ProjectSummary[] = [
  {
    path: "~/code/app",
    name: "app",
    sessions: [
      { id: "j1", title: "First", status: "waiting" },
      { id: "j2", title: "Second", status: "waiting", pinned: true },
      { id: "j3", title: "Third", status: "waiting" },
      { id: "j4", title: "Fourth", status: "waiting", pinned: true },
    ],
  },
];

let calls: { cmd: string; args: unknown }[] = [];
let failPin = false;

beforeEach(() => {
  calls = [];
  failPin = false;
  mockIPC(
    (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "claude_stats") throw new Error("no stats in tests");
      if (cmd === "pin_job" && failPin) throw new Error("disk full");
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

const rowOf = (title: string) => screen.getByTitle(title).closest("div") as HTMLElement;

async function openRowMenu(title: string, item: string) {
  fireEvent.click(within(rowOf(title)).getByRole("button", { name: "More options" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: item }));
}

test("pinned sessions sort above the others and keep their order", () => {
  render(<Shell projects={projects} claude={claude} />);
  const titles = within(screen.getByRole("navigation", { name: "Sessions" }))
    .getAllByTitle(/.+/)
    .map((row) => row.getAttribute("title"));
  expect(titles).toEqual(["Second", "Fourth", "First", "Third"]);
});

test("a pinned row says Pinned and an unpinned one does not", () => {
  render(<Shell projects={projects} claude={claude} />);
  expect(within(rowOf("Second")).getByText("Pinned")).not.toBeNull();
  expect(within(rowOf("First")).queryByText("Pinned")).toBeNull();
});

test("Pin pins an unpinned session", async () => {
  render(<Shell projects={projects} claude={claude} />);
  await openRowMenu("First", "Pin");
  await waitFor(() => expect(calls.find((call) => call.cmd === "pin_job")?.args).toEqual({ job_id: "j1", pinned: true }));
});

test("Unpin unpins a pinned session", async () => {
  render(<Shell projects={projects} claude={claude} />);
  await openRowMenu("Second", "Unpin");
  await waitFor(() => expect(calls.find((call) => call.cmd === "pin_job")?.args).toEqual({ job_id: "j2", pinned: false }));
});

test("a failed pin toasts", async () => {
  failPin = true;
  render(
    <>
      <Shell projects={projects} claude={claude} />
      <Toaster />
    </>,
  );
  await openRowMenu("First", "Pin");
  expect(await screen.findByText("Could not pin the session")).not.toBeNull();
});
