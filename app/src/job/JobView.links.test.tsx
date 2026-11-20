import { afterEach, beforeEach, expect, test } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { TitleActionsProvider, TitleActionsSlot } from "@/shell/title-actions";
import { JobView } from "./JobView";

const lead = { id: "a1", name: "lead", role: "lead", kind: "lead", model: "claude-opus-5-5", effort: "high", why: "", worktree: "~/code/app/.worktrees/session", status: "done", permission_mode: "" };
const pullRequest = {
  number: 12,
  title: "Add login",
  url: "https://github.com/acme/app/pull/12",
  state: "draft",
  checks: "passing",
  issues: [{ number: 4, url: "https://github.com/acme/app/issues/4" }],
};
let links: object;
let calls: { cmd: string; args: unknown }[];

beforeEach(() => {
  calls = [];
  links = { repo_url: "https://github.com/acme/app", branch_url: "https://github.com/acme/app/tree/factory/login", pull_request: pullRequest };
  mockIPC((cmd, args) => {
    calls.push({ cmd, args });
    if (cmd === "list_agents") return [lead];
    if (cmd === "agent_history") return [];
    if (cmd === "list_jobs") return [{ id: "j1", status: "done", branch: "factory/login", cleaned_up: false }];
    if (cmd === "job_links") return links;
  });
});

afterEach(async () => {
  cleanup();
  await act(async () => {});
  clearMocks();
});

const renderJob = () =>
  render(
    <TitleActionsProvider>
      <TitleActionsSlot />
      <JobView jobId="j1" />
    </TitleActionsProvider>,
  );

const opened = (cmd: string) => calls.filter((call) => call.cmd === cmd).map((call) => call.args);

test("the title bar shows the session's pull request with its state and checks, and opens it on GitHub", async () => {
  renderJob();
  const chip = await screen.findByRole("button", { name: /Pull request #12/ });
  expect(chip.getAttribute("aria-label")).toMatch(/draft.*checks passing/i);
  fireEvent.click(chip);
  await waitFor(() => expect(opened("plugin:opener|open_url")).toContainEqual(expect.objectContaining({ url: pullRequest.url })));
});

test("an issue the pull request closes is shown and opens on GitHub", async () => {
  renderJob();
  fireEvent.click(await screen.findByRole("button", { name: /Linked issue #4/ }));
  await waitFor(() => expect(opened("plugin:opener|open_url")).toContainEqual(expect.objectContaining({ url: pullRequest.issues[0].url })));
});

test("the branch opens on GitHub and its worktree folder opens from the branch popover", async () => {
  renderJob();
  fireEvent.click(await screen.findByRole("button", { name: /Branch factory\/login/ }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: /Open on GitHub/ }));
  await waitFor(() => expect(opened("plugin:opener|open_url")).toContainEqual(expect.objectContaining({ url: "https://github.com/acme/app/tree/factory/login" })));
  fireEvent.click(within(dialog).getByRole("button", { name: /Open folder/ }));
  await waitFor(() => expect(opened("open_worktree")).toContainEqual({ agent_id: "a1" }));
});

test("the branch name links to GitHub and the worktree path opens its folder", async () => {
  renderJob();
  fireEvent.click(await screen.findByRole("button", { name: /Branch factory\/login/ }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "factory/login" }));
  await waitFor(() => expect(opened("plugin:opener|open_url")).toContainEqual(expect.objectContaining({ url: "https://github.com/acme/app/tree/factory/login" })));
  fireEvent.click(within(dialog).getByRole("button", { name: "~/code/app/.worktrees/session" }));
  await waitFor(() => expect(opened("open_worktree")).toContainEqual({ agent_id: "a1" }));
});

test("a session without a pull request shows no pull request chip", async () => {
  links = { repo_url: null, branch_url: null, pull_request: null };
  renderJob();
  await screen.findByRole("button", { name: /Branch factory\/login/ });
  await act(async () => {});
  expect(screen.queryByRole("button", { name: /Pull request/ })).toBeNull();
});
