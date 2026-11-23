import { afterEach, expect, test } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import type { Customize, CustomizeDraft, CustomizeItem } from "@/ipc";
import { Shell } from "@/shell/Shell";
import { CustomizePage } from "./CustomizePage";

const PROJECT = "~/code/app";
const SKILLS = "/home/user/.claude/skills";

const skill = (name: string, patch: Partial<CustomizeItem> = {}): CustomizeItem => ({
  id: `skill:user::${name}`,
  kind: "skill",
  name,
  description: "",
  source: "user",
  plugin: null,
  path: `${SKILLS}/${name}/SKILL.md`,
  invocation: `Claude or /${name}`,
  enabled: true,
  loaded_tokens: 10,
  use_tokens: 100,
  exact: false,
  uses: 0,
  last_used: null,
  ...patch,
});

const listed = (items: CustomizeItem[], project_path: string | null): Customize => ({ project_path, items, context_max: 200_000, measured: true });

type Request = { kind: string; scope: string; project: string | null; original_path: string | null; draft: CustomizeDraft };

let items: CustomizeItem[] = [];
let calls: [string, unknown][] = [];
let recent: { path: string; name: string; last_used: number }[] = [];

function serve(drafts: Record<string, CustomizeDraft> = {}) {
  calls = [];
  mockIPC(
    (cmd, args) => {
    calls.push([cmd, args]);
    const payload = args as Record<string, unknown>;
    if (cmd === "list_projects") return recent;
    if (cmd === "list_customize") return listed(items, payload.project_path as string | null);
    if (cmd === "read_customize_item") return drafts[payload.path as string];
    if (cmd === "save_customize_item") {
      const { draft, original_path } = payload.request as Request;
      const written = `${SKILLS}/${draft.name}/SKILL.md`;
      items = [...items.filter((entry) => entry.path !== original_path), skill(draft.name, { description: draft.description, path: written })];
      return written;
    }
    if (cmd === "measure_customize") return listed(items.map((entry) => ({ ...entry })), payload.project_path as string | null);
    if (cmd === "delete_customize_item") {
      if ((payload.path as string).includes("locked")) throw new Error("File is locked");
      items = items.filter((entry) => entry.path !== payload.path);
      return null;
    }
    return [];
    },
    { shouldMockEvents: true },
  );
}

const callsTo = (command: string) => calls.filter(([cmd]) => cmd === command).map(([, args]) => args);
const names = () => [...document.querySelectorAll("[data-item]")].map((button) => document.getElementById(button.getAttribute("aria-labelledby")!)?.textContent);
const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement | HTMLTextAreaElement;
const type = (name: string, value: string) => fireEvent.change(field(name), { target: { value } });

afterEach(async () => {
  cleanup();
  localStorage.clear();
  await act(async () => {});
  clearMocks();
});

async function open(project = PROJECT) {
  render(<CustomizePage section="skills" project={project} onProject={() => {}} onSection={() => {}} />);
  await act(async () => {});
}

test("a new user skill is created from the form with Cmd+S, then listed, selected and focused", async () => {
  items = [skill("tidy")];
  serve();
  await open();
  fireEvent.click(screen.getByRole("button", { name: "New skill" }));
  expect(document.activeElement).toBe(field("Name"));
  expect(screen.getByRole("button", { name: "This project" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "All your projects" }));
  const save = screen.getByRole("button", { name: "Save" });
  expect(save).toHaveProperty("disabled", true);
  type("Name", "-notes");
  expect(field("Name").getAttribute("aria-invalid")).toBe("true");
  expect(save).toHaveProperty("disabled", true);
  type("Name", "Release Notes");
  expect(field("Name").value).toBe("release-notes");
  type("Description", "Writes release notes");
  type("Body", "List the merged changes.");
  await act(async () => {
    fireEvent.keyDown(field("Body"), { key: "s", metaKey: true });
  });
  expect(callsTo("save_customize_item")).toEqual([
    { request: { kind: "skill", scope: "user", project: PROJECT, original_path: null, draft: { name: "release-notes", description: "Writes release notes", paths: [], body: "List the merged changes." } } },
  ]);
  await waitFor(() => expect(names()).toEqual(["release-notes", "tidy"]));
  const region = screen.getByRole("region", { name: "release-notes" });
  expect(within(region).getByRole("button", { name: "Edit" })).not.toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "release-notes" }));
});

test("This project is not offered as a place for a new item while the picker shows All", async () => {
  items = [];
  serve();
  await open("");
  fireEvent.click(screen.getByRole("button", { name: "New skill" }));
  expect(screen.getByRole("button", { name: "This project" })).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: "All your projects" }).getAttribute("aria-pressed")).toBe("true");
});

test("a new item cannot take the name of one that already exists in the same place", async () => {
  items = [skill("tidy")];
  serve();
  await open();
  fireEvent.click(screen.getByRole("button", { name: "New skill" }));
  fireEvent.click(screen.getByRole("button", { name: "All your projects" }));
  type("Name", "tidy");
  type("Body", "Something.");
  expect(field("Name").getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByText("A skill named tidy already exists there. Pick another name.")).not.toBeNull();
  expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
});

test("a row's own Delete button asks first and then moves the item to the Trash", async () => {
  const tidy = skill("tidy");
  items = [tidy, skill("notes")];
  serve();
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Delete tidy" }));
  const dialog = await screen.findByRole("alertdialog", { name: "Move tidy to the Trash?" });
  await act(async () => {
    fireEvent.click(within(dialog).getByRole("button", { name: "Move to Trash" }));
  });
  expect(callsTo("delete_customize_item")).toEqual([{ path: tidy.path }]);
  await waitFor(() => expect(names()).toEqual(["notes"]));
});

test("editing a user skill loads its draft, saves the change under its old path and returns focus to the row", async () => {
  const tidy = skill("tidy", { description: "Tidies a diff" });
  items = [tidy];
  serve({ [tidy.path]: { name: "tidy", description: "Tidies a diff", paths: [], body: "Remove dead code." } });
  await open();
  fireEvent.click(screen.getByRole("button", { name: "tidy" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  });
  expect(callsTo("read_customize_item")).toEqual([{ path: tidy.path }]);
  expect(document.activeElement).toBe(field("Name"));
  expect(field("Body").value).toBe("Remove dead code.");
  expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
  type("Description", "Tidies a diff before review");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
  });
  expect(callsTo("save_customize_item")).toEqual([
    { request: { kind: "skill", scope: "user", project: PROJECT, original_path: tidy.path, draft: { name: "tidy", description: "Tidies a diff before review", paths: [], body: "Remove dead code." } } },
  ]);
  await waitFor(() => expect(screen.queryByLabelText("Name")).toBeNull());
  expect(within(screen.getByRole("region", { name: "tidy" })).getByText("Tidies a diff before review")).not.toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "tidy" }));
});

test("Esc with unsaved changes asks to discard them, and without changes closes the form", async () => {
  const tidy = skill("tidy");
  items = [tidy];
  serve({ [tidy.path]: { name: "tidy", description: "", paths: [], body: "" } });
  await open();
  fireEvent.click(screen.getByRole("button", { name: "tidy" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  });
  type("Body", "Changed");
  fireEvent.keyDown(field("Body"), { key: "Escape" });
  expect(await screen.findByRole("dialog", { name: "Discard changes?" })).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  type("Body", "");
  fireEvent.keyDown(field("Body"), { key: "Escape" });
  expect(screen.queryByLabelText("Body")).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "tidy" }));
});

test("deleting a user skill asks first, moves it to the Trash and drops it from the list", async () => {
  const tidy = skill("tidy");
  items = [tidy, skill("notes")];
  serve();
  await open();
  fireEvent.click(screen.getByRole("button", { name: "tidy" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  const dialog = await screen.findByRole("alertdialog", { name: "Move tidy to the Trash?" });
  expect(callsTo("delete_customize_item")).toEqual([]);
  await act(async () => {
    fireEvent.click(within(dialog).getByRole("button", { name: "Move to Trash" }));
  });
  expect(callsTo("delete_customize_item")).toEqual([{ path: tidy.path }]);
  await waitFor(() => expect(names()).toEqual(["notes"]));
  expect(screen.queryByRole("region", { name: "tidy" })).toBeNull();
});

test("deleting one row keeps another row's open detail", async () => {
  items = [skill("tidy"), skill("notes")];
  serve();
  await open();
  fireEvent.click(screen.getByRole("button", { name: "notes" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete tidy" }));
  await act(async () => {
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Move to Trash" }));
  });
  await waitFor(() => expect(names()).toEqual(["notes"]));
  expect(screen.getByRole("region", { name: "notes" })).not.toBeNull();
});

test("a row's Delete that fails shows why", async () => {
  items = [skill("locked")];
  serve();
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Delete locked" }));
  await act(async () => {
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Move to Trash" }));
  });
  expect((await screen.findByRole("alert")).textContent).toContain("File is locked");
});

test("an item open for editing can still be saved after the list is measured again", async () => {
  const tidy = skill("tidy");
  items = [tidy];
  serve({ [tidy.path]: { name: "tidy", description: "", paths: [], body: "Old." } });
  await open();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Edit tidy" }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Measure again" }));
  });
  type("Body", "New.");
  expect(field("Name").getAttribute("aria-invalid")).toBeNull();
  expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", false);
});

test("a Factory or plugin item says where it comes from and offers no Edit or Delete", async () => {
  items = [skill("review", { id: "skill:factory::review", source: "factory" }), skill("lint", { id: "skill:plugin:kit:lint", source: "plugin", plugin: "kit" })];
  serve();
  await open();
  fireEvent.click(screen.getByRole("button", { name: "review" }));
  expect(within(screen.getByRole("region", { name: "review" })).getByText("Read-only, from Factory")).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "lint" }));
  const region = within(screen.getByRole("region", { name: "lint" }));
  expect(region.getByText("Read-only, from kit")).not.toBeNull();
  expect(region.queryByRole("button", { name: "Edit" })).toBeNull();
  expect(region.queryByRole("button", { name: "Delete" })).toBeNull();
});

test("Cmd+S twice while the first save is running sends one save", async () => {
  const tidy = skill("tidy");
  items = [tidy];
  serve({ [tidy.path]: { name: "tidy", description: "", paths: [], body: "Old." } });
  await open();
  fireEvent.click(screen.getByRole("button", { name: "tidy" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  });
  type("Body", "New.");
  await act(async () => {
    fireEvent.keyDown(field("Body"), { key: "s", metaKey: true });
    fireEvent.keyDown(field("Body"), { key: "s", metaKey: true });
  });
  expect(callsTo("save_customize_item")).toHaveLength(1);
});

test("switching the section or the project with unsaved changes asks to discard them", async () => {
  const tidy = skill("tidy");
  items = [tidy];
  recent = [{ path: "~/code/other", name: "other", last_used: 1 }];
  serve({ [tidy.path]: { name: "tidy", description: "", paths: [], body: "Old." } });
  render(<Shell projects={[]} />);
  fireEvent.click(screen.getByRole("button", { name: "Customize" }));
  await act(async () => {});
  fireEvent.click(within(screen.getByRole("navigation", { name: "Customize" })).getByRole("button", { name: "Skills" }));
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "tidy" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  });
  type("Body", "Changed");

  fireEvent.click(within(screen.getByRole("navigation", { name: "Customize" })).getByRole("button", { name: "Rules" }));
  expect(await screen.findByRole("dialog", { name: "Discard changes?" })).not.toBeNull();
  expect(field("Body").value).toBe("Changed");
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

  fireEvent.click(screen.getByRole("button", { name: "Project: all" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: /other/ }));
  expect(await screen.findByRole("dialog", { name: "Discard changes?" })).not.toBeNull();
  expect(field("Body").value).toBe("Changed");
  fireEvent.click(screen.getByRole("button", { name: "Discard" }));
  await waitFor(() => expect(screen.queryByLabelText("Body")).toBeNull());
  expect(screen.getByRole("button", { name: "Project: other" })).not.toBeNull();
});
