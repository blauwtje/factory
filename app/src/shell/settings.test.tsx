import { afterEach, beforeEach, expect, test } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { SettingsPage } from "./SettingsPage";
import { Shell } from "./Shell";
import type { SettingsSection } from "./types";

const claude = { info: { path: "~/.local/bin/claude", version: "2.1.326" } };
const roles = [
  { name: "builder", description: "Writes the code", model: "claude-sonnet-5-5", effort: "medium", tools: ["Read", "Edit", "Bash"], prompt: "", origin: "builtin" },
  { name: "orchestrator", description: "Leads a session", model: "claude-opus-5-5", effort: "high", tools: ["Read"], prompt: "", origin: "builtin" },
  { name: "reviewer", description: "Reads the diff", model: "claude-opus-5-5", effort: "xhigh", tools: ["Read", "Grep"], prompt: "", origin: "builtin" },
];
const agentItem = ({ name, description }: (typeof roles)[number]) => ({
  id: `agent:factory::${name}`,
  kind: "agent",
  name,
  description,
  source: "factory",
  plugin: null,
  path: `~/kit/agents/${name}.md`,
  invocation: "Claude starts it",
  enabled: true,
  loaded_tokens: 20,
  use_tokens: 400,
  exact: true,
  uses: 0,
  last_used: null,
});
const customize = { project_path: null, items: roles.map(agentItem), context_max: 200_000, measured: true };

beforeEach(() => {
  mockIPC(
    (cmd) => {
      if (cmd === "claude_stats") throw new Error("no stats in tests");
      if (cmd === "list_customize") return customize;
      return cmd === "list_roles" ? roles : cmd === "list_projects" || cmd === "permission_log" || cmd === "list_tools" || cmd === "list_kinds" ? [] : undefined;
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

async function renderSettings(section: SettingsSection = "general", result: Parameters<typeof SettingsPage>[0]["claude"] = claude) {
  render(<SettingsPage claude={result} section={section} />);
  await act(async () => {});
}

async function openCustomize() {
  render(<Shell projects={[]} claude={claude} />);
  fireEvent.click(screen.getByRole("button", { name: "Customize" }));
  await act(async () => {});
}

async function openSettings() {
  render(<Shell projects={[]} claude={claude} />);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await act(async () => {});
}

const composer = () => screen.queryByRole("combobox", { name: "What should we build?" });
const settingsNav = () => screen.queryByRole("navigation", { name: "Settings" });
const customizeNav = () => screen.queryByRole("navigation", { name: "Customize" });
const statisticsHeading = () => screen.queryByRole("heading", { name: "Statistics" });

test("settings takes over the sidebar column with its own navigation and no second rail", async () => {
  await openSettings();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryAllByRole("tab")).toHaveLength(0);
  expect(screen.getAllByRole("complementary")).toHaveLength(1);
  expect(screen.queryByRole("navigation", { name: "Sessions" })).toBeNull();
  const nav = within(settingsNav()!);
  expect(nav.getAllByRole("button").map((button) => button.textContent)).toEqual([
    "New",
    "General",
    "Sessions",
    "Permission log",
    "Usage",
    "Statistics",
    "Claude CLI",
    "About",
  ]);
  expect(nav.getByRole("button", { name: "General" }).getAttribute("aria-current")).toBe("page");
});

test("Customize is its own page with its own navigation and breadcrumb, ", async () => {
  await openCustomize();
  expect(settingsNav()).toBeNull();
  expect(within(customizeNav()!).getAllByRole("button").map((button) => button.textContent)).toEqual([
    "New",
    "Overview",
    "Plugins",
    "Skills",
    "Agents",
    "MCP servers",
    "Hooks",
    "Rules",
    "Memory",
  ]);
  fireEvent.click(within(customizeNav()!).getByRole("button", { name: "Agents" }));
  const breadcrumb = within(screen.getByRole("navigation", { name: "Breadcrumb" }));
  expect(breadcrumb.getByRole("button", { name: "Customize" })).toBeTruthy();
  expect(breadcrumb.getByText("Agents").getAttribute("aria-current")).toBe("page");
  fireEvent.keyDown(document, { key: "Escape" });
  expect(customizeNav()).toBeNull();
  expect(composer()).not.toBeNull();
});

test("Statistics is a section of Settings", async () => {
  await openSettings();
  fireEvent.click(within(settingsNav()!).getByRole("button", { name: "Statistics" }));
  expect(statisticsHeading()).not.toBeNull();
});

test("choosing a section shows its page and names it in the breadcrumb", async () => {
  await openSettings();
  fireEvent.click(within(settingsNav()!).getByRole("button", { name: "Claude CLI" }));
  expect(screen.getByText("~/.local/bin/claude")).toBeTruthy();
  const breadcrumb = within(screen.getByRole("navigation", { name: "Breadcrumb" }));
  expect(breadcrumb.getByText("Claude CLI").getAttribute("aria-current")).toBe("page");
  expect(within(settingsNav()!).getByRole("button", { name: "General" }).getAttribute("aria-current")).toBeNull();
  fireEvent.click(breadcrumb.getByRole("button", { name: "Settings" }));
  expect(within(settingsNav()!).getByRole("button", { name: "General" }).getAttribute("aria-current")).toBe("page");
});

test("the Permission log section shows the log page", async () => {
  await renderSettings("permissions");
  expect(screen.getByRole("heading", { name: "Permission log" })).toBeTruthy();
  expect(screen.getByText("Every permission you answered, per project. Kept on this computer only.")).toBeTruthy();
});

test("New leaves settings for a new session in the app sidebar", async () => {
  await openSettings();
  const rows = within(settingsNav()!).getAllByRole("button").map((button) => button.getAttribute("aria-label"));
  expect(rows.slice(0, 2)).toEqual(["New", "General"]);
  fireEvent.click(screen.getByRole("button", { name: "New" }));
  expect(settingsNav()).toBeNull();
  expect(composer()).not.toBeNull();
  expect(screen.getByRole("button", { name: "New" }).getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
});

test("the sidebar swap slides only for a mouse click, never for the keyboard or the palette", async () => {
  render(<Shell projects={[]} claude={claude} />);
  const column = () => screen.getByRole("complementary").parentElement!;
  fireEvent.click(screen.getByRole("button", { name: "Settings" }), { detail: 1 });
  expect(column().dataset.slide).toBe("in-right");
  fireEvent.click(screen.getByRole("button", { name: "New" }), { detail: 1 });
  expect(column().dataset.slide).toBe("in-left");
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(column().dataset.slide).toBeUndefined();
  fireEvent.click(screen.getByRole("button", { name: "New" }));
  expect(column().dataset.slide).toBeUndefined();
  fireEvent.keyDown(document, { key: "k", metaKey: true });
  fireEvent.click(within(await screen.findByRole("dialog", { name: "Command palette" })).getByText("Settings"));
  await act(async () => {});
  expect(settingsNav()).not.toBeNull();
  expect(column().dataset.slide).toBeUndefined();
});

test("leaving settings through the palette does not replay the slide on the app sidebar", async () => {
  render(<Shell projects={[]} claude={claude} />);
  const column = () => screen.getByRole("complementary").parentElement!;
  fireEvent.click(screen.getByRole("button", { name: "Settings" }), { detail: 1 });
  expect(column().dataset.slide).toBe("in-right");
  fireEvent.keyDown(document, { key: "k", metaKey: true });
  fireEvent.click(within(await screen.findByRole("dialog", { name: "Command palette" })).getByText("Go home"));
  await act(async () => {});
  expect(settingsNav()).toBeNull();
  expect(column().dataset.slide).toBeUndefined();
});

test("Escape does not close settings while focus is in an input", async () => {
  await openSettings();
  const input = document.body.appendChild(document.createElement("input"));
  input.focus();
  fireEvent.keyDown(input, { key: "Escape" });
  expect(settingsNav()).not.toBeNull();
  input.remove();
});

test("the palette offers Home, Customize, Statistics and Settings, and Statistics opens Settings on that section", async () => {
  render(<Shell projects={[]} claude={claude} />);
  fireEvent.keyDown(document, { key: "k", metaKey: true });
  const palette = await screen.findByRole("dialog", { name: "Command palette" });
  expect(within(palette).getByText("Go home")).toBeTruthy();
  expect(within(palette).getByText("Settings")).toBeTruthy();
  expect(within(palette).getByText("Customize")).toBeTruthy();
  fireEvent.click(within(palette).getByText("Statistics"));
  await act(async () => {});
  expect(statisticsHeading()).not.toBeNull();
  expect(within(settingsNav()!).getByRole("button", { name: "Statistics" }).getAttribute("aria-current")).toBe("page");
});

test("the Claude CLI page shows the path and version without loading", async () => {
  await renderSettings("cli");
  expect(screen.getByText("~/.local/bin/claude")).toBeTruthy();
  expect(screen.getByText("2.1.326")).toBeTruthy();
});

test("a failed claude lookup shows an error line", async () => {
  await renderSettings("cli", { error: "claude not found" });
  expect(screen.getByText("claude not found")).toBeTruthy();
});

test("the Agents page lists each agent, opens one in the editor, and hides other pages", async () => {
  await openCustomize();
  fireEvent.click(within(customizeNav()!).getByRole("button", { name: "Agents" }));
  await act(async () => {});
  const rows = screen.getAllByRole("row").filter((row) => within(row).queryAllByRole("cell").length > 0);
  expect(screen.getByRole("columnheader", { name: "Factory" })).toBeTruthy();
  expect(rows.map((row) => within(row).getAllByRole("cell")[0].querySelector("button")?.textContent)).toEqual(["builder", "orchestrator", "reviewer"]);
  fireEvent.click(screen.getByRole("button", { name: "reviewer" }));
  expect(within(screen.getByRole("region", { name: "reviewer" })).getByRole("textbox", { name: "Description" })).toHaveProperty("value", "Reads the diff");
  expect(screen.queryByText("~/.local/bin/claude")).toBeNull();
});

test("Escape leaves settings for the previous screen", async () => {
  await openSettings();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(settingsNav()).toBeNull();
  expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
});

test("the default model and effort show their real names and the list marks the default", async () => {
  await renderSettings("sessions");
  await waitFor(() => expect(screen.getByRole("button", { name: /Model/ }).textContent).toContain("Opus 5.5 · High"));
  fireEvent.click(screen.getByRole("button", { name: /Model/ }));
  const opus = await screen.findByRole("radio", { name: "Opus 5.5" });
  expect(within(opus).getByText("Default")).not.toBeNull();
  expect(screen.getByRole("radio", { name: "Sonnet 5.5" })).not.toBeNull();
});

test("changing the default model and effort writes the prefs", async () => {
  await renderSettings("sessions");
  fireEvent.click(screen.getByRole("button", { name: /Model/ }));
  fireEvent.click(await screen.findByRole("radio", { name: "Sonnet 5.5" }));
  fireEvent.click(screen.getByRole("radio", { name: "Max" }));
  await waitFor(() => expect(localStorage.getItem("factory.leadModel")).toBe(JSON.stringify("claude-sonnet-5-5")));
  expect(localStorage.getItem("factory.leadEffort")).toBe(JSON.stringify("max"));
});

test("the limits switch names the sidebar", async () => {
  await renderSettings("usage");
  expect(screen.getByRole("switch", { name: "Show limits in the sidebar" })).toBeTruthy();
});

test("a keyboard page switch shows the new page at once", async () => {
  render(<Shell projects={[]} claude={claude} />);
  fireEvent.keyDown(document, { key: ",", metaKey: true });
  const page = document.querySelector("main")!.firstElementChild as HTMLElement;
  expect(page.style.opacity).not.toBe("0");
  expect(page.style.transform).toBe("");
});
