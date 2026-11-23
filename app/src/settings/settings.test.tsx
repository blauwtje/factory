import { afterEach, beforeEach, expect, test } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { CustomizePage } from "@/customize/CustomizePage";
import type { SettingsSection } from "@/shell/types";

const builder = { name: "builder", description: "Writes the code", model: "claude-sonnet-5-5", effort: "medium", tools: ["Read", "Edit", "Bash"], prompt: "# builder", origin: "edited" };
const reviewer = { name: "reviewer", description: "Reads the diff", model: "claude-opus-5-5", effort: "high", tools: ["Read", "Grep"], prompt: "# reviewer", origin: "builtin" };
const entry = { plugin: null, invocation: "", enabled: true, loaded_tokens: 10, use_tokens: 100, exact: false, uses: 0, last_used: null };
const items = [
  { ...entry, id: "agent:factory::builder", kind: "agent", name: "builder", description: "Writes the code", source: "factory", path: "~/kit/agents/builder.md", invocation: "Claude starts it" },
  { ...entry, id: "agent:factory::reviewer", kind: "agent", name: "reviewer", description: "Reads the diff", source: "factory", path: "~/kit/agents/reviewer.md", invocation: "Claude starts it" },
  { ...entry, id: "agent:user::scout", kind: "agent", name: "scout", description: "Looks around", source: "user", path: "~/.claude/agents/scout.md", invocation: "Claude starts it" },
  { ...entry, id: "skill:factory::document", kind: "skill", name: "document", description: "Writes prose read later", source: "factory", path: "~/kit/skills/document/SKILL.md", enabled: false, loaded_tokens: 0 },
  { ...entry, id: "skill:user::notes", kind: "skill", name: "notes", description: "Keeps notes", source: "user", path: "~/.claude/skills/notes/SKILL.md" },
];
const answers: Record<string, unknown> = {
  list_projects: [{ path: "~/code/app", name: "app", last_used: 1 }],
  list_customize: { project_path: "~/code/app", items, context_max: 200_000, measured: true },
  list_roles: [builder, reviewer],
  list_tools: ["Read", "Edit", "Bash", "Grep"],
  list_kinds: [{ id: "build", role: "builder", model: "claude-sonnet-5-5", effort: "medium", edited: false }],
};
let calls: [string, unknown][] = [];
const callsTo = (command: string) => calls.filter(([cmd]) => cmd === command).map(([, args]) => args);

beforeEach(() => {
  calls = [];
  mockIPC((cmd, args) => {
    calls.push([cmd, args]);
    return answers[cmd];
  });
});

afterEach(async () => {
  cleanup();
  await act(async () => {});
  clearMocks();
});

async function openSection(section: SettingsSection) {
  render(<CustomizePage section={section} project="" onProject={() => {}} onSection={() => {}} />);
  await act(async () => {});
}

async function openAgent(name: string) {
  await openSection("agents");
  fireEvent.click(await screen.findByRole("button", { name }));
  await act(async () => {});
}

test("turning a tool off and saving sends the role without that tool", async () => {
  await openAgent("builder");
  fireEvent.click(screen.getByRole("button", { name: "Bash", pressed: true }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(callsTo("save_role")).toEqual([{ role: { name: "builder", description: "Writes the code", model: "claude-sonnet-5-5", effort: "medium", tools: ["Read", "Edit"], prompt: "# builder" } }]));
});

test("Reset to default asks first, then resets the role", async () => {
  await openAgent("builder");
  fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));
  expect(callsTo("reset_role")).toEqual([]);
  fireEvent.click(await screen.findByRole("button", { name: "Reset" }));
  await waitFor(() => expect(callsTo("reset_role")).toEqual([{ name: "builder" }]));
});

test("a Factory agent opens in the editor and an agent from elsewhere opens read-only", async () => {
  await openAgent("reviewer");
  expect(within(screen.getByRole("region", { name: "reviewer" })).getByRole("textbox", { name: "Description" })).toHaveProperty("value", "Reads the diff");
  fireEvent.click(screen.getByRole("button", { name: "scout" }));
  const detail = screen.getByRole("region", { name: "scout" });
  expect(within(detail).getByText("~/.claude/agents/scout.md")).not.toBeNull();
  expect(within(detail).queryByRole("textbox")).toBeNull();
});

test("only a Factory skill has a switch, and it turns the skill on", async () => {
  await openSection("skills");
  expect(within((await screen.findByRole("button", { name: "notes" })).closest("li")!).queryByRole("switch")).toBeNull();
  fireEvent.click(screen.getByRole("switch", { name: "document" }));
  await waitFor(() => expect(callsTo("set_skill_enabled")).toEqual([{ name: "document", enabled: true }]));
});

test("picking another agent for a kind of work saves the team default", async () => {
  await openSection("agents");
  fireEvent.click(await screen.findByRole("button", { name: "Team defaults", pressed: false }));
  fireEvent.click(await screen.findByRole("combobox", { name: "Agent for build" }));
  const option = await screen.findByRole("option", { name: "reviewer" });
  fireEvent.pointerMove(option);
  fireEvent.pointerDown(option);
  fireEvent.mouseDown(option);
  fireEvent.pointerUp(option);
  fireEvent.mouseUp(option);
  fireEvent.click(option);
  await waitFor(() => expect(callsTo("save_kind")).toEqual([{ kind: { id: "build", role: "reviewer", model: "claude-sonnet-5-5", effort: "medium" } }]));
});
