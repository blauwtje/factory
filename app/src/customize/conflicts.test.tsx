import { afterEach, expect, test } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { CustomizeItem } from "@/ipc";
import { ItemBrowser, ItemDetail } from "./ItemBrowser";

const item = (name: string, conflicts?: string[]): CustomizeItem => ({
  id: `skill:user::${name}`,
  kind: "skill",
  name,
  description: "",
  source: "user",
  plugin: null,
  path: `~/.claude/skills/${name}/SKILL.md`,
  invocation: "",
  enabled: true,
  loaded_tokens: 0,
  use_tokens: 0,
  exact: false,
  uses: 0,
  last_used: null,
  conflicts,
});

const duplicated = item("review", ["./.claude/skills/review/SKILL.md", "~/.claude/plugins/kit/skills/review/SKILL.md"]);
const unique = item("tidy", []);
const unchecked = item("legacy");

afterEach(cleanup);

const rowOf = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`) }).closest("tr")!;

test("a row shows a Duplicate badge only for an item with other places", () => {
  render(<ItemBrowser items={[duplicated, unique, unchecked]} selected={null} onSelect={() => {}} detail={null} empty="" />);
  expect(within(rowOf("review")).getByText("Duplicate")).toBeTruthy();
  expect(within(rowOf("tidy")).queryByText("Duplicate")).toBeNull();
  expect(within(rowOf("legacy")).queryByText("Duplicate")).toBeNull();
});

test("the detail lists the other paths under Same name in", () => {
  render(<ItemDetail item={duplicated} />);
  expect(screen.getByText("Same name in")).toBeTruthy();
  expect(screen.getByText("./.claude/skills/review/SKILL.md")).toBeTruthy();
  expect(screen.getByText("~/.claude/plugins/kit/skills/review/SKILL.md")).toBeTruthy();
});

test("the detail has no Same name in section without other places", () => {
  render(<ItemDetail item={unique} />);
  expect(screen.queryByText("Same name in")).toBeNull();
});
