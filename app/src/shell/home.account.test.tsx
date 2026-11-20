import { afterEach, beforeEach, expect, test } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { Home } from "@/shell/Home";
import type { Account } from "@/ipc";

const account = (id: string, label: string, isDefault: boolean): Account => ({
  id,
  label,
  email: null,
  plan: null,
  config_dir: null,
  is_default: isDefault,
  limits: [{ kind: "weekly_all", label: "Weekly", percent: 40, resets_at: null, severity: "normal", active: true }],
  updated_at: 1,
  error: null,
  refreshing: false,
});

let calls: { cmd: string; args: unknown }[];

beforeEach(() => {
  calls = [];
  mockIPC(
    (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "list_projects") return [{ path: "~/code/web", name: "web", last_used: 20 }];
      if (cmd === "list_accounts") return [account("default", "Personal", true), account("~/code/work", "Work", false)];
      if (cmd === "project_accounts") return { "~/code/web": "~/code/work" };
      if (cmd === "create_job") return { id: "j9", initialized: false };
      if (cmd === "permission_modes") return ["manual"];
      if (cmd === "claude_permission_mode") return "";
      if (cmd === "list_agents" || cmd === "list_jobs") return [];
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

test("Home starts the session on the project's account and on a picked account", async () => {
  render(<Home projects={[]} compose={{ key: 1 }} onOpen={() => {}} onCreated={() => {}} />);
  const chip = await screen.findByRole("button", { name: "Account Work, 40% used" });
  const prompt = screen.getByRole("combobox", { name: "What should we build?" });
  fireEvent.change(prompt, { target: { value: "Add search" } });
  fireEvent.click(chip);
  fireEvent.click(await screen.findByRole("menuitem", { name: /Personal/ }));
  fireEvent.click(screen.getByRole("button", { name: "Use for this project" }));
  await waitFor(() => expect(calls.find((c) => c.cmd === "set_project_account")?.args).toEqual({ project_path: "~/code/web", account_id: "default" }));
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(calls.find((c) => c.cmd === "create_job")).toBeTruthy());
  expect(calls.find((c) => c.cmd === "create_job")!.args).toMatchObject({ job: { account_id: "default", project_path: "~/code/web" } });
});

test("Home leaves the account to the backend while the project's account is still loading", async () => {
  mockIPC(
    (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "list_projects") return [{ path: "~/code/web", name: "web", last_used: 20 }];
      if (cmd === "list_accounts") return [account("default", "Personal", true), account("~/code/work", "Work", false)];
      if (cmd === "project_accounts") return new Promise(() => {});
      if (cmd === "create_job") return { id: "j9", initialized: false };
      if (cmd === "permission_modes") return ["manual"];
      if (cmd === "claude_permission_mode") return "";
      if (cmd === "list_agents" || cmd === "list_jobs") return [];
    },
    { shouldMockEvents: true },
  );
  render(<Home projects={[]} compose={{ key: 1 }} onOpen={() => {}} onCreated={() => {}} />);
  const prompt = await screen.findByRole("combobox", { name: "What should we build?" });
  fireEvent.change(prompt, { target: { value: "Add search" } });
  fireEvent.click(await screen.findByRole("button", { name: "Send" }));
  await waitFor(() => expect(calls.find((c) => c.cmd === "create_job")).toBeTruthy());
  expect(calls.find((c) => c.cmd === "create_job")!.args).toEqual({ job: { project_path: "~/code/web", prompt: "Add search" } });
});
