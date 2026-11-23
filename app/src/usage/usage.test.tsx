import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import type { Account } from "@/ipc";

let UsageMeter: typeof import("./UsageMeter").UsageMeter;
let UsagePage: typeof import("./UsagePage").UsagePage;

const SOON = Math.round(Date.now() / 1000) + 3_600;
const limit = (kind: string, label: string, percent: number) => ({ kind, label, percent, resets_at: SOON, severity: "normal", active: true });

const ultra: Account = {
  id: "default",
  label: "Jane Doe",
  email: "user@example.com",
  plan: "Ultra",
  config_dir: null,
  is_default: true,
  limits: [limit("weekly_all", "Weekly", 42), limit("weekly_scoped", "Fable weekly", 18)],
  updated_at: Math.round(Date.now() / 1000) - 120,
  error: null,
  refreshing: false,
};
const max: Account = { ...ultra, id: "~/code/work", label: "Work", email: "work@example.com", plan: "Max", is_default: false, limits: [limit("session", "5-hour", 60), limit("weekly_all", "Weekly", 30)] };

let accounts: Account[];
let calls: { cmd: string; args: unknown }[];

beforeEach(async () => {
  accounts = [ultra, max];
  calls = [];
  mockIPC(
    (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "list_accounts") return accounts;
      if (cmd === "project_accounts") return { "~/code/app": "~/code/work" };
      if (cmd === "list_projects") return [{ path: "~/code/app", name: "app", last_used: 1 }];
    },
    { shouldMockEvents: true },
  );
  vi.resetModules();
  ({ UsageMeter } = await import("./UsageMeter"));
  ({ UsagePage } = await import("./UsagePage"));
});

afterEach(async () => {
  cleanup();
  localStorage.clear();
  await act(async () => {});
  clearMocks();
});

async function settled() {
  await act(async () => {});
}

test("the meter renders the cached account without a 5-hour line or unknown when the account has no session limit", async () => {
  render(<UsageMeter />);
  await settled();
  expect(screen.getByText("Weekly")).toBeTruthy();
  expect(screen.getByText("Fable weekly")).toBeTruthy();
  expect(screen.queryByText("5-hour")).toBeNull();
  expect(screen.queryByText(/unknown/i)).toBeNull();
  expect(screen.getByText("Weekly").parentElement!.querySelector("number-flow-react")?.textContent).toContain("42%");
});

test("the meter shows the account of the selected session", async () => {
  render(<UsageMeter accountId="~/code/work" />);
  await settled();
  expect(screen.getByText("5-hour")).toBeTruthy();
  expect(screen.getByText("Work · Max")).toBeTruthy();
  expect(screen.getByText("5-hour").parentElement!.querySelector("number-flow-react")?.textContent).toContain("60%");
});

test("the meter is hidden when limits are switched off", async () => {
  localStorage.setItem("factory.showUsage", JSON.stringify(false));
  render(<UsageMeter />);
  await settled();
  expect(screen.queryByText("Weekly")).toBeNull();
});

test("the usage page shows both accounts with their projects", async () => {
  render(<UsagePage />);
  await settled();
  expect(screen.getByRole("region", { name: "Jane Doe" })).toBeTruthy();
  const work = screen.getByRole("region", { name: "Work" });
  expect(work.textContent).toContain("work@example.com");
  expect(work.textContent).toContain("5-hour");
  await waitFor(() => expect(work.textContent).toContain("app"));
});

test("setting a default account and removing a project call the backend", async () => {
  render(<UsagePage />);
  await settled();
  fireEvent.click(screen.getByRole("button", { name: "Set as default, Work" }));
  expect(calls.find((c) => c.cmd === "set_default_account")?.args).toEqual({ id: "~/code/work" });
  await waitFor(() => screen.getByRole("button", { name: "Remove app from Work" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove app from Work" }));
  expect(calls.find((c) => c.cmd === "set_project_account")?.args).toEqual({ project_path: "~/code/app", account_id: null });
});

test("the meter shows the account name and plan above the limits", async () => {
  render(<UsageMeter />);
  await settled();
  expect(screen.getByText("Jane Doe · Ultra")).toBeTruthy();
  expect(screen.getByText("Weekly")).toBeTruthy();
});

test("the meter counts down to each reset", async () => {
  const later = Math.floor(Date.now() / 1000) + 2 * 86_400 + 3.5 * 3_600;
  accounts = [{ ...ultra, limits: [{ ...limit("weekly_all", "Weekly", 42), resets_at: later }] }];
  render(<UsageMeter />);
  await settled();
  expect(screen.getByText("Resets in 2d 3h")).toBeTruthy();
});

test("the meter shows the accounts of the last run before the backend answers", async () => {
  render(<UsageMeter />);
  await settled();
  cleanup();
  mockIPC((cmd) => (cmd === "list_accounts" ? new Promise(() => {}) : undefined), { shouldMockEvents: true });
  vi.resetModules();
  ({ UsageMeter } = await import("./UsageMeter"));
  render(<UsageMeter />);
  expect(screen.getByText("Jane Doe · Ultra")).toBeTruthy();
});

test("a folder rule covers subfolders and the longest rule wins", async () => {
  const { folderAccountId } = await import("./folderRules");
  const rules = { "~/code": "a", "~/code/app": "b" };
  expect(folderAccountId(rules, "~/code/app/web")).toBe("b");
  expect(folderAccountId(rules, "~/code/other")).toBe("a");
  expect(folderAccountId(rules, "~/codex")).toBeNull();
});
