import { useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { clearMocks, mockIPC as mockTauri } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import type { Stats, Tokens } from "@/ipc";
import { writePersisted } from "@/lib/persisted";
import { StatsTab } from "./StatsTab";
import { cacheHitRatio, formatTokens, groupByDay, groupByWeekHour, MS_PER_HOUR } from "./format";

vi.mock("@number-flow/react", () => ({
  default: ({ value, suffix = "", format, locales }: { value: number; suffix?: string; format?: Intl.NumberFormatOptions; locales?: string }) => (
    <span>{`${new Intl.NumberFormat(locales, format).format(value)}${suffix}`}</span>
  ),
}));

const mockIPC = (handler: (cmd: string, payload?: unknown) => unknown, options?: { shouldMockEvents?: boolean }) =>
  mockTauri((cmd, payload) => handler(cmd, payload) ?? (cmd === "list_projects" ? [] : undefined), options);

const tokens = (uncached: number, extra: Partial<Tokens> = {}): Tokens => ({
  input: uncached,
  cache_write: 0,
  cache_read: 0,
  output: 0,
  uncached,
  ...extra,
});

const HOUR_2026_03_01_23_UTC = Date.UTC(2026, 2, 1, 23) / 3_600_000;
const plus2 = () => 120;

function pinnedNowHour() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 18, 12));
  return Math.floor(Date.now() / MS_PER_HOUR);
}

let stats: Stats;

beforeEach(() => {
  stats = {
    total: tokens(12_345),
    by_model: [["claude-opus-5-5", tokens(12_345)]],
    by_project: [
      ["~/code/app", tokens(4000)],
      ["", tokens(3000)],
      ["~/code/api", tokens(2000)],
      ["~/code/web", tokens(1500)],
      ["~/code/docs", tokens(1000)],
      ["~/code/tools", tokens(500)],
      ["~/code/misc", tokens(345)],
    ],
    by_hour: [
      [HOUR_2026_03_01_23_UTC, tokens(1000)],
      [HOUR_2026_03_01_23_UTC + 1, tokens(500)],
    ],
    sessions: 3,
    messages: 40,
    tool_calls: 7,
    first_session: "2026-01-02",
    progress: { files_done: 1, files_total: 4 },
  };
  mockIPC((cmd) => (cmd === "claude_stats" || cmd === "claude_stats_snapshot" ? stats : undefined), { shouldMockEvents: true });
});

function Picked({ initial = "" }: { initial?: string }) {
  const [project, setProject] = useState(initial);
  return <StatsTab key={project} project={project} onProject={setProject} />;
}

afterEach(async () => {
  cleanup();
  localStorage.clear();
  await act(async () => {});
  clearMocks();
  vi.useRealTimers();
});

test("formatTokens shortens thousands and millions", () => {
  expect(formatTokens(950)).toBe("950");
  expect(formatTokens(12_345)).toBe("12.3k");
  expect(formatTokens(1_234_567)).toBe("1.2M");
});

test("formatTokens shortens billions", () => {
  expect(formatTokens(999_950_000)).toBe("1B");
  expect(formatTokens(1_008_000_000)).toBe("1B");
  expect(formatTokens(12_345_678_901)).toBe("12.3B");
});

test("hours are grouped into local days and weekday hours for a given offset", () => {
  const byHour = stats.by_hour;
  expect(groupByDay(byHour, plus2).map(({ day, tokens: t }) => [day, t.uncached])).toEqual([
    ["2026-03-02", 1500],
  ]);
  expect(groupByDay(byHour, () => 0).map(({ day, tokens: t }) => [day, t.uncached])).toEqual([
    ["2026-03-01", 1000],
    ["2026-03-02", 500],
  ]);
  const grid = groupByWeekHour(byHour, plus2);
  expect(grid).toHaveLength(7);
  expect(grid[0][1]).toBe(1000);
  expect(grid[0][2]).toBe(500);
  expect(grid.flat().reduce((sum, value) => sum + value)).toBe(1500);
});

test("shows totals, per model and a progress bar that follows the progress event", async () => {
  render(<StatsTab project="" onProject={() => {}} />);
  expect(await screen.findByText("claude-opus-5-5")).not.toBeNull();
  expect(screen.getAllByText("12.3k")).toHaveLength(2);
  expect(screen.getByTitle("12,345").textContent).toBe("12.3k");
  expect(screen.getByText("Sessions").nextSibling?.textContent).toBe("3");
  const bar = screen.getByRole("progressbar");
  expect(bar.getAttribute("aria-valuenow")).toBe("1");
  await act(async () => {
    await emit("stats-progress", { files_done: 3, files_total: 4 });
  });
  await waitFor(() => expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("3"));
  stats = { ...stats, sessions: 4, progress: { files_done: 4, files_total: 4 } };
  await act(async () => {
    await emit("stats-progress", { files_done: 4, files_total: 4 });
  });
  await waitFor(() => expect(screen.queryByRole("progressbar")).toBeNull());
  await waitFor(() => expect(screen.getByText("Sessions").nextSibling?.textContent).toBe("4"));
});

test("ranks the top five projects by new tokens and groups the rest", async () => {
  render(<StatsTab project="" onProject={() => {}} />);
  const panel = (await screen.findByRole("heading", { name: "Projects" })).closest("section") as HTMLElement;
  const names = Array.from(panel.querySelectorAll("li")).map((row) => row.textContent);
  expect(names).toEqual(["app4k32%", "Unknown3k24%", "api2k16%", "web1.5k12%", "docs1k8%", "Other (2)8457%"]);
  expect(panel.querySelector('[title="~/code/app"]')?.textContent).toBe("app");
});

test("opening the tab does not re-index endlessly once indexing finished", async () => {
  let calls = 0;
  const indexed: Stats = {
    total: tokens(1),
    by_model: [["claude-opus-5-5", tokens(1)]],
    by_project: [],
    by_hour: [],
    sessions: 1,
    messages: 1,
    tool_calls: 0,
    first_session: null,
    progress: { files_done: 2, files_total: 2 },
  };
  mockIPC(
    (cmd) => {
      if (cmd !== "claude_stats") return undefined;
      calls += 1;
      setTimeout(() => void emit("stats-progress", { files_done: 2, files_total: 2 }), 0);
      return indexed;
    },
    { shouldMockEvents: true },
  );
  render(<StatsTab project="" onProject={() => {}} />);
  await screen.findByText("claude-opus-5-5");
  for (let tick = 0; tick < 20; tick++) await act(async () => await new Promise((r) => setTimeout(r, 10)));
  expect(calls).toBeLessThanOrEqual(2);
});

test("a finished refresh reloads the stats without starting another refresh", async () => {
  let refreshes = 0;
  const finished: Stats = { ...stats, progress: { files_done: 2, files_total: 2 } };
  mockIPC(
    (cmd) => {
      if (cmd === "claude_stats") {
        refreshes += 1;
        setTimeout(() => void emit("stats-progress", { files_done: 1, files_total: 2 }), 0);
        setTimeout(() => void emit("stats-progress", { files_done: 2, files_total: 2 }), 5);
      }
      return cmd === "claude_stats" || cmd === "claude_stats_snapshot" ? finished : undefined;
    },
    { shouldMockEvents: true },
  );
  render(<StatsTab project="" onProject={() => {}} />);
  await screen.findByText("claude-opus-5-5");
  for (let tick = 0; tick < 20; tick++) await act(async () => await new Promise((r) => setTimeout(r, 10)));
  expect(refreshes).toBe(1);
});

test("the range control filters the tokens to the chosen period", async () => {
  const now = pinnedNowHour();
  stats = {
    ...stats,
    by_hour: [
      [now - 24 * 60, tokens(4000)],
      [now - 24 * 10, tokens(2000)],
      [now, tokens(1000)],
    ],
    progress: { files_done: 4, files_total: 4 },
  };
  render(<StatsTab project="" onProject={() => {}} />);
  const summary = async () => (await screen.findByText(/^New tokens per day/)).textContent;
  expect(await summary()).toContain(": 3,000 in total");
  fireEvent.click(screen.getByRole("button", { name: "7 days" }));
  expect(await summary()).toContain(": 1,000 in total");
  fireEvent.click(screen.getByRole("button", { name: "All" }));
  expect(await summary()).toContain(": 7,000 in total");
});

test("the cache hit rate card shows the ratio and its change in points against the previous period", async () => {
  const now = pinnedNowHour();
  stats = {
    ...stats,
    by_hour: [
      [now - 24 * 60, tokens(100)],
      [now - 24 * 45, tokens(100, { cache_read: 100 })],
      [now, tokens(100, { cache_read: 300 })],
    ],
    progress: { files_done: 4, files_total: 4 },
  };
  render(<StatsTab project="" onProject={() => {}} />);
  const card = (await screen.findByText("Cache hit rate")).parentElement?.parentElement;
  expect(card?.textContent).toContain("75%");
  expect(card?.textContent).toContain("Up25%");
  expect(cacheHitRatio(tokens(0))).toBe(0);
});

test("the projects panel refreshes while the reread is still in progress", async () => {
  stats = { ...stats, by_project: [["", tokens(100)]] };
  render(<StatsTab project="" onProject={() => {}} />);
  const panel = (await screen.findByRole("heading", { name: "Projects" })).closest("section") as HTMLElement;
  expect(panel.textContent).toContain("Unknown");
  stats = { ...stats, by_project: [["~/code/app", tokens(100)]], progress: { files_done: 2, files_total: 4 } };
  await act(async () => {
    await emit("stats-progress", { files_done: 2, files_total: 4 });
  });
  await waitFor(() => expect(panel.textContent).toContain("app"));
  expect(panel.textContent).not.toContain("Unknown");
});

test("a cache hit rate change that rounds to zero shows no up or down arrow", async () => {
  const now = pinnedNowHour();
  stats = {
    ...stats,
    by_hour: [
      [now - 24 * 60, tokens(100)],
      [now - 24 * 45, tokens(1000, { cache_read: 1000 })],
      [now, tokens(1000, { cache_read: 1001 })],
    ],
    progress: { files_done: 4, files_total: 4 },
  };
  render(<StatsTab project="" onProject={() => {}} />);
  const card = (await screen.findByText("Cache hit rate")).parentElement?.parentElement;
  expect(card?.textContent).toContain("Unchanged");
  expect(card?.textContent).not.toMatch(/Up|Down/);
});

test("the all time panel shows a readable first session date from a full timestamp", async () => {
  stats = { ...stats, first_session: "2026-10-18T12:40:51.052Z", progress: { files_done: 4, files_total: 4 } };
  render(<StatsTab project="" onProject={() => {}} />);
  expect(await screen.findByText("Since Oct 18")).not.toBeNull();
});

test("the last statistics show at once with an updating label until the fresh result arrives", async () => {
  writePersisted("stats:all", { ...stats, sessions: 9, progress: { files_done: 4, files_total: 4 } });
  let resolve: (value: Stats) => void = () => {};
  mockIPC((cmd) => (cmd === "claude_stats" ? new Promise<Stats>((done) => (resolve = done)) : undefined), { shouldMockEvents: true });
  render(<StatsTab project="" onProject={() => {}} />);
  expect(screen.getByText("Sessions").nextSibling?.textContent).toBe("9");
  expect(screen.getByText("Updating…")).not.toBeNull();
  await act(async () => resolve({ ...stats, sessions: 4, progress: { files_done: 4, files_total: 4 } }));
  await waitFor(() => expect(screen.getByText("Sessions").nextSibling?.textContent).toBe("4"));
  expect(screen.queryByText("Updating…")).toBeNull();
});

test("a fresh result is kept for the next visit", async () => {
  const view = render(<StatsTab project="" onProject={() => {}} />);
  await screen.findByText("claude-opus-5-5");
  view.unmount();
  mockIPC((cmd) => (cmd === "claude_stats" ? new Promise<Stats>(() => {}) : undefined), { shouldMockEvents: true });
  render(<StatsTab project="" onProject={() => {}} />);
  expect(screen.getByText("Sessions").nextSibling?.textContent).toBe("3");
});

test("the picked project is asked for and keeps its own numbers", async () => {
  const asked: unknown[] = [];
  const forProject = (path: string | null): Stats => (path === "~/code/app" ? { ...stats, sessions: 11, progress: { files_done: 4, files_total: 4 } } : { ...stats, progress: { files_done: 4, files_total: 4 } });
  mockIPC(
    (cmd, payload) => {
      if (cmd === "list_projects") return [{ name: "app", path: "~/code/app" }];
      if (cmd !== "claude_stats") return undefined;
      const path = (payload as { project_path: string | null }).project_path;
      asked.push(path);
      return path === "~/code/app" ? new Promise<Stats>(() => {}) : forProject(path);
    },
    { shouldMockEvents: true },
  );
  writePersisted("stats:~/code/app", forProject("~/code/app"));
  render(<Picked />);
  await waitFor(() => expect(screen.getByText("Sessions").nextSibling?.textContent).toBe("3"));
  fireEvent.click(screen.getByRole("button", { name: "Project: all" }));
  fireEvent.click(await screen.findByText("~/code/app"));
  await waitFor(() => expect(screen.getByText("Sessions").nextSibling?.textContent).toBe("11"));
  expect(screen.getByText("Updating…")).not.toBeNull();
  expect(asked).toEqual([null, "~/code/app"]);
});

test("switching to a project with nothing stored shows no numbers from the previous one", async () => {
  mockIPC(
    (cmd, payload) => {
      if (cmd === "list_projects") return [{ name: "app", path: "~/code/app" }];
      if (cmd !== "claude_stats") return undefined;
      return (payload as { project_path: string | null }).project_path ? new Promise<Stats>(() => {}) : stats;
    },
    { shouldMockEvents: true },
  );
  render(<Picked />);
  await screen.findByText("claude-opus-5-5");
  fireEvent.click(screen.getByRole("button", { name: "Project: all" }));
  fireEvent.click(await screen.findByText("~/code/app"));
  await waitFor(() => expect(screen.queryByText("claude-opus-5-5")).toBeNull());
  expect(screen.queryByText("Sessions")).toBeNull();
});
