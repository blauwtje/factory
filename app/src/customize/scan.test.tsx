import { afterEach, expect, test } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { CustomizeItem } from "@/ipc";
import { ItemBrowser, ItemDetail } from "./ItemBrowser";

const item = (name: string, scan?: CustomizeItem["scan"]): CustomizeItem => ({
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
  scan,
});

const risky = item("fetcher", { verdict: "risk", findings: [{ level: "risk", reason: "Downloads and runs code" }] });
const reviewed = item("notes", { verdict: "review", findings: [{ level: "review", reason: "Hidden HTML comment" }] });
const clean = item("tidy", { verdict: "pass", findings: [] });
const unscanned = item("legacy");

afterEach(cleanup);

const rowOf = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`) }).closest("tr")!;

test("a row shows a Risk or Review badge and none for a passing or unscanned item", () => {
  render(<ItemBrowser items={[risky, reviewed, clean, unscanned]} selected={null} onSelect={() => {}} detail={null} empty="" />);
  expect(within(rowOf("fetcher")).getByText("Risk")).toBeTruthy();
  expect(within(rowOf("notes")).getByText("Review")).toBeTruthy();
  expect(within(rowOf("tidy")).queryByText(/^(Risk|Review)$/)).toBeNull();
  expect(within(rowOf("legacy")).queryByText(/^(Risk|Review)$/)).toBeNull();
});

test("the detail lists the findings and the heuristic note for a flagged item", () => {
  render(<ItemDetail item={risky} />);
  expect(screen.getByText("Scan")).toBeTruthy();
  expect(screen.getByText("Downloads and runs code")).toBeTruthy();
  expect(screen.getByText("Heuristic check; it can flag safe files.")).toBeTruthy();
});

test("the detail has no Scan section without findings", () => {
  render(<ItemDetail item={clean} />);
  expect(screen.queryByText("Scan")).toBeNull();
});
