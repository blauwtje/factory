import { afterEach, beforeEach, expect, test } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { Shell } from "./Shell";
import type { ProjectSummary } from "./types";

const claude = { info: { path: "~/.local/bin/claude", version: "2.1.326" } };
const projects: ProjectSummary[] = [
  {
    path: "~/code/app",
    name: "app",
    sessions: [
      { id: "j1", title: "What agents do", status: "waiting" },
      { id: "j2", title: "Old experiment", status: "merged", archived: true },
    ],
  },
];

let calls: { cmd: string; args: unknown }[] = [];

beforeEach(() => {
  calls = [];
  mockIPC(
    (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "claude_stats") throw new Error("no stats in tests");
      return ["list_roles", "list_projects", "list_jobs", "list_agents"].includes(cmd) ? [] : undefined;
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

test("an idle session says Idle and never Your turn", () => {
  render(<Shell projects={projects} claude={claude} />);
  expect(screen.queryByText("Your turn")).toBeNull();
  expect(within(rowOf("What agents do")).getByText("Idle")).not.toBeNull();
});

test("the sidebar has one New row and no New session row", () => {
  render(<Shell projects={projects} claude={claude} />);
  expect(screen.getAllByRole("button", { name: "New" })).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "New session" })).toBeNull();
});

test("the top navigation is New, Search and Customize, and Settings is the last row of the sidebar", () => {
  render(<Shell projects={projects} claude={claude} />);
  const buttons = within(screen.getByRole("complementary")).getAllByRole("button");
  expect(buttons.slice(1, 4).map((button) => button.getAttribute("aria-label"))).toEqual(["New", "Search", "Customize"]);
  expect(screen.queryByRole("button", { name: "Statistics" })).toBeNull();
  expect(buttons.at(-1)?.textContent).toBe("Settings");
});

test("Settings replaces the sidebar and New brings it back on a new session", async () => {
  render(<Shell projects={projects} claude={claude} />);
  fireEvent.click(screen.getByTitle("What agents do"));
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await act(async () => {});
  expect(screen.getAllByRole("complementary")).toHaveLength(1);
  expect(within(screen.getByRole("complementary")).queryByRole("button", { name: "Settings" })).toBeNull();
  expect(screen.queryByTitle("What agents do")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "New" }));
  expect(screen.getByTitle("What agents do")).not.toBeNull();
  expect(screen.getByRole("button", { name: "Settings" })).not.toBeNull();
  expect(screen.getByRole("button", { name: "New" }).getAttribute("aria-current")).toBe("page");
});

test("Settings opens on General even after another section was visited", async () => {
  render(<Shell projects={projects} claude={claude} />);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Usage" }));
  fireEvent.click(screen.getByRole("button", { name: "New" }));
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await act(async () => {});
  expect(screen.getByRole("button", { name: "General" }).getAttribute("aria-current")).toBe("page");
});

test("Archive archives the session through the backend", async () => {
  render(<Shell projects={projects} claude={claude} />);
  await openRowMenu("What agents do", "Archive");
  await waitFor(() => expect(calls).toContainEqual({ cmd: "archive_job", args: { job_id: "j1", archived: true } }));
});

test("an archived session shows in its project when Show archived is on and can be unarchived", async () => {
  localStorage.setItem("factory.showArchived", "true");
  render(<Shell projects={projects} claude={claude} />);
  await openRowMenu("Old experiment", "Unarchive");
  await waitFor(() => expect(calls).toContainEqual({ cmd: "archive_job", args: { job_id: "j2", archived: false } }));
});

test("Delete asks first and only deletes after Delete is confirmed", async () => {
  render(<Shell projects={projects} claude={claude} />);
  await openRowMenu("What agents do", "Delete");
  const dialog = await screen.findByRole("alertdialog");
  expect(dialog.textContent).toContain("cannot be undone");
  await act(async () => {});
  expect(calls.map((call) => call.cmd)).not.toContain("delete_job");
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(calls).toContainEqual({ cmd: "delete_job", args: { job_id: "j1" } }));
});

test("a session's age is lowercase minutes with its creation date and time in a tooltip", () => {
  const created = Math.floor(Date.now() / 1000) - 4 * 60;
  const aged: ProjectSummary[] = [{ path: "~/code/app", name: "app", sessions: [{ id: "j3", title: "Aged", status: "merged", createdAt: created }] }];
  render(<Shell projects={aged} claude={claude} />);
  const age = within(rowOf("Aged")).getByText("4m");
  expect(age.className).not.toContain("ui-label");
  expect(age.getAttribute("title")).toBe(new Date(created * 1000).toLocaleString());
});
