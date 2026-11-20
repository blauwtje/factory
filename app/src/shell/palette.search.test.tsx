import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { CommandPalette } from "./CommandPalette";
import type { ProjectSummary } from "./types";

const projects: ProjectSummary[] = [{ path: "~/code/app", name: "app", sessions: [{ id: "j1", title: "What agents do", status: "waiting" }] }];

const hit = { job_id: "j9", agent_id: "a9", title: "Old experiment", role: "user", text: "the zebra plan", snippet: "the zebra plan", seq: 3 };

let queries: string[] = [];

beforeEach(() => {
  queries = [];
  mockIPC((cmd, args) => {
    if (cmd !== "search_sessions") return undefined;
    queries.push((args as { query: string }).query);
    return [hit];
  });
});

afterEach(async () => {
  cleanup();
  await act(async () => {});
  clearMocks();
});

function setup(onOpenHit = vi.fn(), onOpenChange = vi.fn()) {
  const props = { projects, onSelect: vi.fn(), onHome: vi.fn(), onStatistics: vi.fn(), onCustomize: vi.fn(), onSettings: vi.fn(), onToggleSidebar: vi.fn() };
  const view = render(<CommandPalette open onOpenChange={onOpenChange} onOpenHit={onOpenHit} {...props} />);
  return { view, props, onOpenHit, onOpenChange };
}

const type = (value: string) => fireEvent.change(screen.getByPlaceholderText("Search sessions and actions"), { target: { value } });

test("a query of two characters lists message hits under Messages", async () => {
  setup();
  type("ze");
  const option = await screen.findByRole("option", { name: /the zebra plan/ });
  expect(option.querySelector("mark")?.textContent).toBe("ze");
  expect(screen.getByText("Messages")).toBeTruthy();
  expect(screen.getByText("You in Old experiment")).toBeTruthy();
  expect(queries).toEqual(["ze"]);
});

test("a longer term marks the whole word even when a shorter term matches its start", async () => {
  setup();
  type("ze zebra");
  const option = await screen.findByRole("option", { name: /the zebra plan/ });
  expect(option.querySelector("mark")?.textContent).toBe("zebra");
});

test("a single character does not search", async () => {
  setup();
  type("z");
  await act(async () => {});
  expect(queries).toEqual([]);
  expect(screen.queryByText("Messages")).toBeNull();
});

test("choosing a hit closes the palette and opens the hit", async () => {
  const { onOpenHit, onOpenChange } = setup();
  type("ze");
  fireEvent.click(await screen.findByRole("option", { name: /the zebra plan/ }));
  expect(onOpenChange).toHaveBeenCalledWith(false);
  expect(onOpenHit).toHaveBeenCalledWith(hit);
});

test("hits clear when the palette closes", async () => {
  const { view, props, onOpenHit, onOpenChange } = setup();
  type("ze");
  await screen.findByRole("option", { name: /the zebra plan/ });
  view.rerender(<CommandPalette open={false} onOpenChange={onOpenChange} onOpenHit={onOpenHit} {...props} />);
  view.rerender(<CommandPalette open onOpenChange={onOpenChange} onOpenHit={onOpenHit} {...props} />);
  await waitFor(() => expect(screen.queryByRole("option", { name: /the zebra plan/ })).toBeNull());
});
