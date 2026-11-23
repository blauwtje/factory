import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { open } from "@tauri-apps/plugin-dialog";
import { Shell } from "@/shell/Shell";
import type { ProjectSummary } from "@/shell/types";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const projects: ProjectSummary[] = [
  { path: "~/code/app", name: "app", sessions: [{ id: "j1", title: "Fix login", status: "building" }] },
  { path: "~/code/web", name: "web", sessions: [] },
];

const recent = [
  { path: "~/code/web", name: "web", last_used: 20 },
  { path: "~/code/app", name: "app", last_used: 10 },
];

const item = (kind: string, name: string, enabled: boolean) => ({ id: `${kind}:${name}`, kind, name, enabled, source: "user" });

let calls: { cmd: string; args: unknown }[];

beforeEach(() => {
  calls = [];
  mockIPC(
    (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "list_projects") return recent;
      if (cmd === "list_customize") return { project_path: null, context_max: 0, measured: false, items: [item("skill", "a", true), item("skill", "b", true), item("skill", "c", false), item("mcp", "x", true), item("plugin", "p", true)] };
      if (cmd === "create_job") return { id: "j9", initialized: false };
      if (cmd === "permission_modes") return ["acceptEdits", "bypassPermissions", "manual"];
      if (cmd === "claude_permission_mode") return "";
      if (cmd === "save_attachment") return { path: "/tmp/attachments/shot.png", name: "shot.png" };
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

const composer = () => screen.getByRole("combobox", { name: "What should we build?" });
const createJobArgs = () => (calls.find((c) => c.cmd === "create_job")!.args as { job: unknown }).job;

async function mountShell() {
  render(<Shell projects={projects} />);
  await act(async () => {});
}

test("the sidebar lists sessions with their status words", async () => {
  await mountShell();
  const sidebar = screen.getByRole("navigation", { name: "Sessions" });
  expect(within(sidebar).getByText("Fix login")).not.toBeNull();
  expect(within(sidebar).getByText("Working")).not.toBeNull();
});

test("Home opens on a line with the day and the chosen project, not a centered greeting, and lists no projects", async () => {
  await mountShell();
  const line = screen.getByRole("heading", { name: /is on the bench|to start/ });
  await waitFor(() => expect(within(line).getByRole("button", { name: "Start in web" })).not.toBeNull());
  expect(line.textContent).toMatch(/^(\w+ (morning|afternoon|evening)|Late at night),.* is on the bench\.$/);
  expect(screen.queryByRole("region", { name: "Projects" })).toBeNull();
});

test("Home shows no project panel beside the composer", async () => {
  await mountShell();
  await waitFor(() => expect(screen.getByRole("button", { name: "Start in web" })).not.toBeNull());
  expect(screen.queryByRole("complementary", { name: "web" })).toBeNull();
});

test("a pasted image becomes a chip and the prompt ends with its path under Attached files", async () => {
  await mountShell();
  const image = new File(["png-bytes"], "shot.png", { type: "image/png" });
  fireEvent.paste(composer(), { clipboardData: { files: [image], getData: () => "" } });
  expect(await screen.findByRole("button", { name: "Remove shot.png" })).not.toBeNull();
  expect(calls.find((c) => c.cmd === "save_attachment")!.args).toEqual({ name: "shot.png", base64: btoa("png-bytes") });
  fireEvent.change(composer(), { target: { value: "Fix this layout" } });
  fireEvent.keyDown(composer(), { key: "Enter" });
  await waitFor(() => expect(calls.map((c) => c.cmd)).toContain("create_job"));
  expect(createJobArgs()).toMatchObject({ prompt: "Fix this layout\n\nAttached files:\n/tmp/attachments/shot.png" });
});

test("Enter in the composer starts the session with the typed prompt in the last used project", async () => {
  await mountShell();
  fireEvent.change(composer(), { target: { value: "Add search to the header" } });
  fireEvent.keyDown(composer(), { key: "Enter" });
  await waitFor(() => expect(calls.map((c) => c.cmd)).toContain("create_job"));
  expect(createJobArgs()).toEqual({ project_path: "~/code/web", prompt: "Add search to the header" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("the permission mode picked on Home is kept and starts the next session", async () => {
  await mountShell();
  fireEvent.click(await screen.findByRole("button", { name: /^Permissions,/ }));
  fireEvent.click(await screen.findByRole("radio", { name: /Bypass permissions/ }));
  cleanup();
  await mountShell();
  expect((await screen.findByRole("button", { name: /^Permissions,/ })).getAttribute("aria-label")).toBe("Permissions, Bypass permissions");
  fireEvent.change(composer(), { target: { value: "Add search" } });
  fireEvent.keyDown(composer(), { key: "Enter" });
  await waitFor(() => expect(calls.map((c) => c.cmd)).toContain("create_job"));
  expect(createJobArgs()).toMatchObject({ permission_mode: "bypassPermissions" });
});

test("the composer sends the prompt as typed, keeping leading whitespace", async () => {
  await mountShell();
  const prompt = "    indented code line\nnext line\n";
  fireEvent.change(composer(), { target: { value: prompt } });
  fireEvent.keyDown(composer(), { key: "Enter" });
  await waitFor(() => expect(calls.map((c) => c.cmd)).toContain("create_job"));
  expect(createJobArgs()).toMatchObject({ prompt });
});

test("Shift+Enter adds a line and Enter on an empty prompt starts nothing", async () => {
  await mountShell();
  fireEvent.keyDown(composer(), { key: "Enter" });
  fireEvent.change(composer(), { target: { value: "one" } });
  fireEvent.keyDown(composer(), { key: "Enter", shiftKey: true });
  await act(async () => {});
  expect(calls.map((c) => c.cmd)).not.toContain("create_job");
});

test("Open folder chooses the folder from the system dialog as the project", async () => {
  vi.mocked(open).mockResolvedValue("~/code/new-folder");
  await mountShell();
  fireEvent.click(screen.getByRole("button", { name: /^Start in / }));
  fireEvent.click(await screen.findByRole("menuitem", { name: /Open folder/ }));
  await waitFor(() => expect(screen.getByRole("button", { name: /^Start in / }).textContent).toContain("new-folder"));
  fireEvent.change(composer(), { target: { value: "Start here" } });
  fireEvent.keyDown(composer(), { key: "Enter" });
  await waitFor(() => expect(calls.map((c) => c.cmd)).toContain("create_job"));
  expect(createJobArgs()).toEqual({ project_path: "~/code/new-folder", prompt: "Start here" });
  expect(open).toHaveBeenCalledWith({ directory: true });
});

test("New in the sidebar focuses the composer", async () => {
  await mountShell();
  fireEvent.click(screen.getByRole("button", { name: "New" }));
  await act(async () => {});
  expect(document.activeElement).toBe(composer());
});

test("the command palette Go home goes to Home without a dialog", async () => {
  await mountShell();
  fireEvent.keyDown(document, { key: "k", ctrlKey: true });
  const palette = await screen.findByRole("dialog", { name: "Command palette" });
  fireEvent.click(within(palette).getByText("Go home"));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "New session" })).toBeNull());
  expect(composer()).not.toBeNull();
});

test("the lead model and effort prefs seed the composer pickers", async () => {
  localStorage.setItem("factory.leadModel", JSON.stringify("claude-haiku-5-5"));
  localStorage.setItem("factory.leadEffort", JSON.stringify("low"));
  await mountShell();
  fireEvent.change(composer(), { target: { value: "Tidy the README" } });
  fireEvent.keyDown(composer(), { key: "Enter" });
  await waitFor(() => expect(calls.map((c) => c.cmd)).toContain("create_job"));
  expect(createJobArgs()).toEqual({ project_path: "~/code/web", prompt: "Tidy the README", model: "claude-haiku-5-5", effort: "low" });
});

test("a failed session is listed under Needs attention and shows a visible word in the sidebar", async () => {
  const failed: ProjectSummary[] = [{ path: "~/code/app", name: "app", sessions: [{ id: "j2", title: "Broken build", status: "failed" }] }];
  render(<Shell projects={failed} />);
  await act(async () => {});
  const needsYou = screen.getByRole("region", { name: "Needs attention" });
  expect(within(needsYou).getByText("Broken build")).not.toBeNull();
  const sidebar = screen.getByRole("navigation", { name: "Sessions" });
  expect(within(sidebar).getByText("Failed")).not.toBeNull();
});

test("Needs attention lists a finished session as ready to merge and leaves out merged and running ones", async () => {
  const mixed: ProjectSummary[] = [
    {
      path: "~/code/app",
      name: "app",
      sessions: [
        { id: "j3", title: "Finished search", status: "done" },
        { id: "j4", title: "Old header work", status: "merged" },
        { id: "j5", title: "Busy refactor", status: "building" },
      ],
    },
  ];
  render(<Shell projects={mixed} />);
  await act(async () => {});
  const needsYou = screen.getByRole("region", { name: "Needs attention" });
  expect(within(needsYou).getByText("Finished search")).not.toBeNull();
  expect(within(needsYou).getByText("Ready to merge")).not.toBeNull();
  expect(within(needsYou).queryByText("Old header work")).toBeNull();
  expect(within(needsYou).queryByText("Busy refactor")).toBeNull();
});

test("the session title bar shows the project path on hover", async () => {
  await mountShell();
  fireEvent.click(within(screen.getByRole("navigation", { name: "Sessions" })).getByText("Fix login"));
  await act(async () => {});
  const crumb = within(screen.getByRole("navigation", { name: "Breadcrumb" }));
  fireEvent.mouseEnter(crumb.getByText("app"));
  fireEvent.mouseMove(crumb.getByText("app"));
  expect(await screen.findByText("~/code/app")).not.toBeNull();
});

test("the sidebar title drags the window", async () => {
  await mountShell();
  expect(screen.getByRole("heading", { name: "Factory" }).hasAttribute("data-tauri-drag-region")).toBe(true);
});
