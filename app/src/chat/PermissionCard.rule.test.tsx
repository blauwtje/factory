import { afterEach, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PermissionCard } from "./PermissionCard";
import { EMPTY_CHAT, reduce } from "./transcript";
import type { PermissionItem } from "./types";

afterEach(cleanup);

const card = (rules?: PermissionItem["rules"], answer?: PermissionItem["answer"]): PermissionItem => ({
  kind: "permission",
  request_id: "r1",
  tool_name: "Bash",
  input: { command: "npm test" },
  rules,
  answer,
});

test("the card names the rule Always allow adds", () => {
  render(<PermissionCard item={card([{ toolName: "Bash", ruleContent: "npm test:*" }])} onAnswer={() => {}} />);
  expect(screen.getByText("Always allow adds Bash(npm test:*) to this session.")).toBeTruthy();
});

test("several rules are joined and a rule without content is the bare tool", () => {
  render(<PermissionCard item={card([{ toolName: "Bash", ruleContent: "npm test:*" }, { toolName: "Read" }])} onAnswer={() => {}} />);
  expect(screen.getByText("Always allow adds Bash(npm test:*), Read to this session.")).toBeTruthy();
});

test("a card without rules has no such line and keeps Always allow", () => {
  render(<PermissionCard item={card([])} onAnswer={() => {}} />);
  expect(screen.queryByText(/Always allow adds/)).toBeNull();
  expect(screen.getByRole("button", { name: /Always allow/ })).toBeTruthy();
});

test("an answered card has no such line", () => {
  render(<PermissionCard item={card([{ toolName: "Bash", ruleContent: "npm test:*" }], "Allowed once")} onAnswer={() => {}} />);
  expect(screen.queryByText(/Always allow adds/)).toBeNull();
});

test("a control request carries its rules onto the permission item", () => {
  const rules = [{ toolName: "Bash", ruleContent: "npm test:*" }];
  const event = { ControlRequest: { request_id: "r1", tool_name: "Bash", input: { command: "npm test" }, rules } };
  const state = reduce(EMPTY_CHAT, { type: "event", event, at: 0 });
  expect(state.items[0]).toMatchObject({ kind: "permission", rules });
});
