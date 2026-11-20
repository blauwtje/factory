import { afterEach, beforeEach, expect, test } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import type { CustomizeItem } from "@/ipc";
import { ProjectNotice } from "./ProjectNotice";

const item = (over: Partial<CustomizeItem>): CustomizeItem => ({
  id: "x",
  kind: "hook",
  name: "x",
  description: "",
  source: "project",
  plugin: null,
  path: "",
  invocation: "",
  enabled: true,
  loaded_tokens: null,
  use_tokens: 0,
  exact: true,
  uses: 0,
  last_used: null,
  ...over,
});

let items: CustomizeItem[];
let known: string[];
let customizeCalls: number;

beforeEach(() => {
  customizeCalls = 0;
  known = ["~/code/web"];
  mockIPC((cmd) => {
    if (cmd === "list_projects") return known.map((path) => ({ path, name: "web", last_used: 1 }));
    if (cmd === "list_customize") {
      customizeCalls += 1;
      return { project_path: null, items, context_max: 0, measured: false };
    }
  });
});

afterEach(() => {
  cleanup();
  clearMocks();
});

async function show(path: string) {
  render(<ProjectNotice path={path} />);
  await act(async () => {});
}

test("names the project hooks and MCP servers of an unknown repo", async () => {
  items = [
    item({ kind: "hook", name: "npm run lint" }),
    item({ kind: "mcp", name: "github" }),
    item({ kind: "hook", name: "user hook", source: "user" }),
    item({ kind: "skill", name: "review" }),
  ];
  await show("~/code/new");
  expect(screen.getByText("This repo brings 1 hook and 1 MCP server: npm run lint, github.")).toBeTruthy();
});

test("pluralises and leaves out a kind that is missing", async () => {
  items = [item({ kind: "hook", name: "a" }), item({ kind: "hook", name: "b" })];
  await show("~/code/new");
  expect(screen.getByText("This repo brings 2 hooks: a, b.")).toBeTruthy();
});

test("shows nothing when the repo brings none", async () => {
  items = [item({ kind: "hook", name: "user hook", source: "user" })];
  await show("~/code/new");
  expect(screen.queryByText(/This repo brings/)).toBeNull();
});

test("shows nothing for a project Factory has seen", async () => {
  items = [item({ kind: "hook", name: "npm run lint" })];
  await show("~/code/web");
  expect(screen.queryByText(/This repo brings/)).toBeNull();
  expect(customizeCalls).toBe(0);
});
