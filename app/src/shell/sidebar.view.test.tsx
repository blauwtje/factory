import { afterEach, beforeEach, expect, test } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { Sidebar } from "./Sidebar";
import type { ProjectSummary } from "./types";

const NOW = Date.now() / 1000;
const DAY = 86_400;

const projects: ProjectSummary[] = [
  {
    path: "~/code/app",
    name: "app",
    sessions: [
      { id: "a", title: "Alpha", status: "waiting", createdAt: NOW - 5 * DAY, lastActiveAt: NOW - 5 * DAY },
      { id: "b", title: "Beta", status: "building", createdAt: NOW - 60, lastActiveAt: NOW - 30, branch: "factory/fix-login", contextTokens: 42_300 },
      { id: "c", title: "Gamma", status: "waiting", createdAt: NOW - 3600, lastActiveAt: NOW - 3600, needsReply: true },
      { id: "d", title: "Delta", status: "merged", createdAt: NOW - 2 * 3600, lastActiveAt: NOW - 2 * 3600, archived: true },
    ],
  },
];

beforeEach(() => {
  mockIPC(() => undefined, { shouldMockEvents: true });
});

afterEach(async () => {
  cleanup();
  localStorage.clear();
  await act(async () => {});
  clearMocks();
});

const noop = () => {};

function renderSidebar() {
  render(
    <Sidebar projects={projects} page="home" selectedId={null} onSelect={noop} onHome={noop} onUsage={noop} onNewSession={noop} onSearch={noop} onCustomize={noop} onSettings={noop} onCollapse={noop} onChanged={noop} />,
  );
}

const titles = () => screen.getAllByTitle(/^(Alpha|Beta|Gamma|Delta)$/).map((node) => node.getAttribute("title"));

async function choose(item: string) {
  fireEvent.click(screen.getByRole("button", { name: "View options" }));
  fireEvent.click(await screen.findByRole("menuitemradio", { name: item }));
  await act(async () => {});
}

test("grouping by status orders the groups and puts needs reply first", async () => {
  renderSidebar();
  await choose("Status");
  const headings = screen.getAllByRole("heading", { level: 2 }).map((node) => node.textContent);
  expect(headings.filter((text) => /^(Needs reply|Running|Idle|Done|Failed)/.test(text ?? "")).map((text) => text?.split("·")[0]?.trim())).toEqual(["Needs reply", "Running", "Idle"]);
});

test("sorting by recently started puts the newest main session first", async () => {
  renderSidebar();
  await choose("Recently started");
  expect(titles()).toEqual(["Beta", "Gamma", "Alpha"]);
});

test("a one day window hides older sessions", async () => {
  renderSidebar();
  await choose("Last day");
  expect(titles()).not.toContain("Alpha");
  expect(titles()).toContain("Beta");
});

test("archived sessions show in their project group only when asked", async () => {
  renderSidebar();
  expect(titles()).not.toContain("Delta");
  fireEvent.click(screen.getByRole("button", { name: "View options" }));
  fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: "Show archived" }));
  await act(async () => {});
  expect(titles()).toContain("Delta");
  expect(screen.queryByRole("heading", { name: /Archived/ })).toBeNull();
});

test("a row shows the branch without its prefix and the total context", () => {
  renderSidebar();
  const row = screen.getByTitle("Beta").closest("div") as HTMLElement;
  expect(within(row).getByText("fix-login")).not.toBeNull();
  expect(within(row).getByText("42k")).not.toBeNull();
});
