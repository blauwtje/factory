import { afterEach, expect, test } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import type { Customize, CustomizeItem } from "@/ipc";
import { readPersisted, writePersisted } from "@/lib/persisted";
import type { SettingsSection } from "@/shell/types";
import { CustomizePage } from "./CustomizePage";

const item = (patch: Partial<CustomizeItem> & Pick<CustomizeItem, "kind" | "name">): CustomizeItem => ({
  id: `${patch.kind}:${patch.source ?? "user"}::${patch.name}`,
  description: "",
  source: "user",
  plugin: null,
  path: `~/.claude/${patch.name}`,
  invocation: "",
  enabled: true,
  loaded_tokens: 0,
  use_tokens: 0,
  exact: false,
  uses: 0,
  last_used: null,
  ...patch,
});

const review = item({ kind: "skill", name: "review", source: "factory", description: "Reviews a diff", invocation: "Claude or /review", loaded_tokens: 40, exact: true, use_tokens: 900, uses: 12 });
const deploy = item({ kind: "skill", name: "deploy", source: "factory", invocation: "Only /deploy", loaded_tokens: 25, use_tokens: 300, uses: 30, path: "~/kit/skills/deploy/SKILL.md" });
const scout = item({ kind: "agent", name: "scout", loaded_tokens: 60, uses: 2 });
const listed = (items: CustomizeItem[], measured = true): Customize => ({ project_path: "~/code/app", items, context_max: 200_000, measured });

let calls: [string, unknown][] = [];

function serve(answers: Record<string, unknown>) {
  calls = [];
  mockIPC((cmd, args) => {
    calls.push([cmd, args]);
    return { list_projects: [], ...answers }[cmd];
  });
}

const callsTo = (command: string) => calls.filter(([cmd]) => cmd === command).map(([, args]) => args);
const itemRows = () => screen.getAllByRole("row").filter((row) => within(row).queryAllByRole("cell").length > 0);
const names = () => itemRows().map((row) => within(row).getAllByRole("cell")[0].querySelector("button")?.textContent);
const tableLines = () => screen.getAllByRole("row").slice(1).map((row) => (within(row).queryAllByRole("cell").length > 0 ? row.querySelector("td button")?.textContent : `# ${row.textContent}`));

afterEach(async () => {
  cleanup();
  localStorage.clear();
  await act(async () => {});
  clearMocks();
});

async function open(section: SettingsSection) {
  render(<CustomizePage section={section} project="~/code/app" onProject={() => {}} onSection={() => {}} />);
  await act(async () => {});
}

test("a kind page lists only its kind with source, invocation and tokens, marks estimates with ~ and opens a row's details", async () => {
  serve({ list_customize: listed([deploy, scout, review]) });
  await open("skills");
  expect(names()).toEqual(["review", "deploy"]);
  const row = screen.getByRole("row", { name: /deploy/ });
  expect(within(row).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["deploy", "Factory", "Only /deploy", "~25", "~300", "30", "Never", ""]);
  expect(within(screen.getByRole("row", { name: /review/ })).getAllByRole("cell")[3].textContent).toBe("40");
  fireEvent.click(within(row).getByRole("button", { name: /deploy/ }));
  expect(within(screen.getByRole("region", { name: "deploy" })).getByText("~/kit/skills/deploy/SKILL.md")).not.toBeNull();
  expect(callsTo("measure_customize")).toEqual([]);
});

test("sorting by uses puts the most used item first", async () => {
  serve({ list_customize: listed([review, deploy]) });
  await open("skills");
  fireEvent.click(screen.getByRole("button", { name: "Uses (30d)" }));
  expect(names()).toEqual(["deploy", "review"]);
});

test("an estimated list is measured once and then shows the measured tokens", async () => {
  serve({ list_customize: listed([deploy], false), measure_customize: listed([{ ...deploy, loaded_tokens: 31, exact: true }]) });
  await open("skills");
  await waitFor(() => expect(within(screen.getByRole("row", { name: /deploy/ })).getAllByRole("cell")[3].textContent).toBe("31"));
  expect(callsTo("measure_customize")).toEqual([{ project_path: "~/code/app" }]);
});

test("the overview counts loaded tokens without plugin rows and lists what loads but went unused", async () => {
  const memory = item({ kind: "memory", name: "CLAUDE.md", loaded_tokens: 2_000, exact: true });
  const plugin = item({ kind: "plugin", name: "exo", source: "plugin", loaded_tokens: 5_000, exact: true, uses: 99 });
  serve({ list_customize: listed([memory, plugin, review]) });
  await open("overview");
  expect(screen.getByRole("img", { name: /2k of 200k tokens/ })).not.toBeNull();
  expect(within(screen.getByRole("list", { name: "Most used" })).getAllByRole("listitem").map((entry) => entry.textContent)).toEqual(["reviewSkill12"]);
  expect(within(screen.getByRole("list", { name: "Loaded but unused in 30 days" })).getAllByRole("listitem").map((entry) => entry.textContent)).toEqual(["CLAUDE.mdMemory2k"]);
});

test("leaving a page while its measurement runs and coming back does not start claude again", async () => {
  serve({ list_customize: listed([deploy], false) });
  mockIPC((cmd, args) => {
    calls.push([cmd, args]);
    if (cmd === "measure_customize") return new Promise(() => {});
    return { list_projects: [], list_customize: listed([deploy], false) }[cmd];
  });
  await open("skills");
  cleanup();
  await open("skills");
  expect(callsTo("measure_customize")).toHaveLength(1);
});

test("the overview total is exact once every reported item is exact, even when a server went unreported", async () => {
  const memory = item({ kind: "memory", name: "CLAUDE.md", loaded_tokens: 2_000, exact: true });
  const offline = item({ kind: "mcp", name: "offline", loaded_tokens: null, exact: false });
  serve({ list_customize: listed([memory, offline]) });
  await open("overview");
  expect(screen.getByRole("img", { name: /^2k of 200k tokens/ })).not.toBeNull();
});

test("a page shows the persisted result at once, marked as updating, and stores the fresh result", async () => {
  writePersisted("customize:~/code/app", listed([deploy]));
  let answer: (value: Customize) => void = () => {};
  mockIPC((cmd) => (cmd === "list_customize" ? new Promise((resolve) => (answer = resolve)) : []));
  await open("skills");
  expect(names()).toEqual(["deploy"]);
  expect(screen.getByText("Updating…")).not.toBeNull();
  expect(document.querySelector('[data-slot="skeleton"]')).toBeNull();
  await act(async () => answer(listed([deploy, review])));
  expect(screen.queryByText("Updating…")).toBeNull();
  expect(readPersisted<Customize>("customize:~/code/app")?.items.map((entry) => entry.name)).toEqual(["deploy", "review"]);
});

test("the All picker reads and writes its own persisted result", async () => {
  writePersisted("customize:all", listed([scout]));
  mockIPC((cmd) => (cmd === "list_customize" ? new Promise(() => {}) : []));
  render(<CustomizePage section="agents" project="" onProject={() => {}} onSection={() => {}} />);
  await act(async () => {});
  expect(names()).toEqual(["scout"]);
});

test("a persisted but unmeasured result stays on screen while claude measures in the background", async () => {
  const path = "~/code/unmeasured";
  writePersisted(`customize:${path}`, listed([deploy], false));
  serve({ list_customize: listed([deploy], false), measure_customize: new Promise(() => {}) });
  render(<CustomizePage section="skills" project={path} onProject={() => {}} onSection={() => {}} />);
  expect(names()).toEqual(["deploy"]);
  await act(async () => {});
  expect(names()).toEqual(["deploy"]);
  expect(callsTo("measure_customize")).toEqual([{ project_path: path }]);
});

const measured = (patch: Partial<Customize>): Customize => ({
  ...listed([item({ kind: "memory", name: "CLAUDE.md", loaded_tokens: 2_000, exact: true })]),
  measured_at: new Date(Date.now() - 5 * 60_000).toISOString(),
  context: {
    total: 41_000,
    max: 400_000,
    categories: [
      { name: "System prompt", tokens: 3_000, kind: "used" },
      { name: "Memory files", tokens: 2_000, kind: "used" },
      { name: "Messages", tokens: 8, kind: "used" },
      { name: "MCP tools", tokens: 500, kind: "deferred" },
      { name: "Autocompact buffer", tokens: 33_000, kind: "buffer" },
      { name: "Free space", tokens: 360_000, kind: "free" },
    ],
  },
  ...patch,
});

test("a measured overview shows claude's loaded categories without messages, a legend with shares and what loads on use", async () => {
  serve({ list_customize: measured({}) });
  await open("overview");
  expect(screen.getByRole("img", { name: /^5k of 400k tokens/ })).not.toBeNull();
  expect(within(screen.getByRole("list", { name: "Loaded at session start" })).getAllByRole("listitem").map((entry) => entry.textContent)).toEqual(["System prompt3k60%", "Memory files2k40%"]);
  expect(within(screen.getByRole("list", { name: "Loads on use" })).getAllByRole("listitem").map((entry) => entry.textContent)).toEqual(["MCP tools500"]);
  expect(screen.getByText("Measured 5m")).not.toBeNull();
  expect(screen.queryByText("Estimate")).toBeNull();
});

test("the bar and the legend give each category the same colour", async () => {
  serve({ list_customize: measured({}) });
  await open("overview");
  const segments = [...screen.getByRole("img", { name: /tokens load/ }).children].map((segment) => (segment as HTMLElement).style.background);
  const swatches = within(screen.getByRole("list", { name: "Loaded at session start" })).getAllByRole("listitem").map((entry) => (entry.querySelector("[data-swatch]") as HTMLElement).style.background);
  expect(swatches).toEqual(segments);
  expect(new Set(segments).size).toBe(2);
});

test("an unmeasured overview says its total is an estimate", async () => {
  serve({ list_customize: { ...measured({ context: null, measured_at: null }), measured: true } });
  await open("overview");
  expect(screen.getByText("Estimate")).not.toBeNull();
  expect(screen.queryByText(/^Measured/)).toBeNull();
});

test("most used lists skills, commands, agents and MCP servers but not hooks, rules or memory", async () => {
  const standup = item({ kind: "command", name: "standup", uses: 4 });
  const hook = item({ kind: "hook", name: "PostToolUse · format.sh", uses: 200 });
  const rule = item({ kind: "rule", name: "testing", uses: 50 });
  const memory = item({ kind: "memory", name: "CLAUDE.md", uses: 40 });
  const postgres = item({ kind: "mcp", name: "postgres", uses: 3 });
  serve({ list_customize: listed([review, standup, hook, rule, memory, postgres, scout]) });
  await open("overview");
  expect(within(screen.getByRole("list", { name: "Most used" })).getAllByRole("listitem").map((entry) => entry.textContent)).toEqual(["reviewSkill12", "standupCommand4", "postgresMCP server3", "scoutAgent2"]);
});

test("commands sit on the Skills page with a Command badge and count on the Skills card", async () => {
  const standup = item({ kind: "command", name: "standup", source: "factory", loaded_tokens: 18, exact: true });
  serve({ list_customize: listed([review, standup]) });
  await open("skills");
  expect(names()).toEqual(["review", "standup"]);
  expect(within(screen.getByRole("row", { name: /standup/ })).getByText("Command")).not.toBeNull();
  expect(within(screen.getByRole("row", { name: /review/ })).queryByText("Command")).toBeNull();
  cleanup();
  await open("overview");
  const card = screen.getByRole("button", { name: /^Skills/ });
  expect(card.textContent).toMatch(/^Skills2/);
  expect(screen.queryByRole("button", { name: /^Commands/ })).toBeNull();
});

const plugged = (name: string, plugin: string, patch: Partial<CustomizeItem> = {}) => item({ kind: "skill", name, source: "plugin", plugin, ...patch });

test("a table groups its rows by source, project first and plugins by name with their origin, and sorts inside each group", async () => {
  const mine = item({ kind: "skill", name: "mine", source: "user", uses: 1 });
  const local = item({ kind: "skill", name: "local", source: "project", uses: 2 });
  const shipped = plugged("shipped", "workflow", { origin: "github.com/acme/workflow", uses: 9 });
  const linted = plugged("linted", "lint-kit", { origin: "~/code/lint-kit", uses: 1 });
  serve({ list_customize: listed([shipped, mine, review, linted, local, deploy]) });
  await open("skills");
  fireEvent.click(screen.getByRole("button", { name: "Uses (30d)" }));
  expect(tableLines()).toEqual([
    "# Project",
    "local",
    "# User",
    "mine",
    "# Factory",
    "deploy",
    "review",
    "# Plugin · lint-kit~/code/lint-kit",
    "linted",
    "# Plugin · workflowgithub.com/acme/workflow",
    "shipped",
  ]);
});

test("search keeps the rows whose name or description matches, ignoring case", async () => {
  serve({ list_customize: listed([review, deploy, item({ kind: "skill", name: "notes", source: "factory", description: "Writes Release notes" })]) });
  await open("skills");
  fireEvent.change(screen.getByRole("searchbox", { name: "Search skills" }), { target: { value: "RE" } });
  expect(names()).toEqual(["review", "notes"]);
  fireEvent.change(screen.getByRole("searchbox", { name: "Search skills" }), { target: { value: "release" } });
  expect(names()).toEqual(["notes"]);
});

test("the plugins table shows where a plugin comes from and its scope, and the detail its version and install path", async () => {
  const workflow = item({ kind: "plugin", name: "workflow", source: "plugin", plugin: "workflow", origin: "github.com/acme/workflow", scope: "user", version: "1.4.0", path: "~/.claude/plugins/cache/workflow" });
  const kit = item({ kind: "plugin", name: "kit", source: "plugin", plugin: "kit", origin: "~/code/kit", scope: "project", version: null, path: "~/code/kit" });
  serve({ list_customize: listed([workflow, kit]) });
  await open("plugins");
  const headers = screen.getAllByRole("columnheader").map((header) => header.textContent);
  expect(headers.slice(0, 3)).toEqual(["Name", "From", "Scope"]);
  expect(within(screen.getByRole("row", { name: /workflow/ })).getAllByRole("cell").slice(1, 3).map((cell) => cell.textContent)).toEqual(["github.com/acme/workflow", "User"]);
  const scope = within(screen.getByRole("row", { name: /^kit/ })).getAllByRole("cell")[2];
  expect(scope.textContent).toBe("Project · app");
  expect(scope.querySelector("[title]")?.getAttribute("title")).toBe("~/code/app");
  fireEvent.click(screen.getByRole("button", { name: /^workflow/ }));
  const detail = within(screen.getByRole("region", { name: "workflow" }));
  expect(detail.getByText("github.com/acme/workflow")).not.toBeNull();
  expect(detail.getByText("1.4.0")).not.toBeNull();
  expect(detail.getByText("Install path")).not.toBeNull();
  expect(detail.getByText("~/.claude/plugins/cache/workflow")).not.toBeNull();
});
