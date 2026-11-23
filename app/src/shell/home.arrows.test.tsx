import { afterEach, beforeEach, expect, test } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { Shell } from "@/shell/Shell";
import type { ProjectSummary } from "@/shell/types";

const projects: ProjectSummary[] = [
  {
    path: "~/code/app",
    name: "app",
    sessions: [
      { id: "j1", title: "Fix login", status: "waiting", createdAt: 20 },
      { id: "j2", title: "Add search", status: "waiting", createdAt: 10 },
    ],
  },
];

beforeEach(() => {
  mockIPC(
    (cmd) => {
      if (cmd === "list_projects" || cmd === "list_agents" || cmd === "list_jobs") return [];
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

test("ArrowDown and ArrowUp move focus between Recent sessions on Home", async () => {
  render(<Shell projects={projects} />);
  await act(async () => {});
  const [first, second] = within(screen.getByRole("region", { name: "Recent" })).getAllByRole("link");
  first.focus();
  fireEvent.keyDown(first, { key: "ArrowDown" });
  expect(document.activeElement).toBe(second);
  fireEvent.keyDown(second, { key: "ArrowUp" });
  expect(document.activeElement).toBe(first);
});
