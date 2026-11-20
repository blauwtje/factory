import { afterEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ContextUsage } from "@/ipc";
import { ContextSection } from "./ContextMeter";

afterEach(cleanup);

const report: ContextUsage = {
  categories: [
    { id: "system_prompt", name: "System prompt", tokens: 2800, kind: "used" },
    { id: "memory_files", name: "Memory files", tokens: 1600, kind: "used" },
    { id: "free_space", name: "Free space", tokens: 190000, kind: "free" },
  ],
  totalTokens: 12000,
  maxTokens: 200000,
  memoryFiles: [
    { path: "~/.claude/CLAUDE.md", type: "User", tokens: 1434 },
    { path: "~/.claude/rules/lessons.md", type: "User", tokens: 149 },
    { path: "~/code/app/CLAUDE.md", type: "Project", tokens: 50 },
  ],
  skills: { skillFrontmatter: [{ name: "agent-ui", source: "projectSettings", tokens: 162 }, { name: "debug", source: "built-in", tokens: 40 }] },
  agents: [{ agentType: "exo:builder", source: "plugin", tokens: 64 }],
  mcpTools: [
    { serverName: "notes", tokens: 40, isLoaded: true },
    { serverName: "web", tokens: 55, isLoaded: false },
  ],
};

test("the context details list what is loaded, grouped by memory, rules, skills, agents and MCP servers, with tokens", () => {
  const { container } = render(<ContextSection usage={report} />);
  fireEvent.click(screen.getByRole("button", { name: "Details" }));
  const group = (name: string) => within(container).getByRole("button", { name: new RegExp(`^${name}`) });
  expect(group("Memory").textContent).toContain("2");
  expect(group("Rules").textContent).toContain("149");
  fireEvent.click(group("Skills"));
  expect(within(container).getByText("agent-ui").closest("li")?.textContent).toContain("162");
  fireEvent.click(group("Agents"));
  expect(within(container).getByText("exo:builder").closest("li")?.textContent).toContain("Plugin");
  fireEvent.click(group("MCP"));
  expect(within(container).getByText("web").closest("li")?.textContent).toContain("Deferred");
  expect(within(container).getByText("notes").closest("li")?.textContent).toContain("40");
});
