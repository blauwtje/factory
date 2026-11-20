import { afterEach, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AgentsSection } from "./AgentsSection";
import { AgentGlyph } from "./look";
import type { AgentRow } from "./types";

afterEach(cleanup);

const agent = (id: string, name: string): AgentRow => ({ id, name, role: name, model: "claude-opus-5-5", effort: "high", why: "", worktree: "~/code/app/.worktrees/session", status: "running", permission_mode: "" });

function listTint(position: number) {
  const agents = [agent("l", "lead"), ...Array.from({ length: position }, (_, n) => agent(`f${n}`, `filler${n}`)), agent("b", "builder")];
  render(<AgentsSection subagents={agents.slice(1)} shellRows={[]} current={agents[0]} asking={new Set()} tokens={new Map()} onSelect={() => {}} />);
  const tint = screen.getByRole("button", { name: /builder/ }).firstElementChild!.getAttribute("style");
  cleanup();
  return tint;
}

test("an agent keeps the tint Settings gives its role at any list position", () => {
  const { container } = render(<AgentGlyph name="builder" role="builder" />);
  const settingsTint = (container.firstChild as HTMLElement).getAttribute("style");
  cleanup();
  expect([0, 1, 2, 3, 4].map(listTint)).toEqual(Array(5).fill(settingsTint));
});
