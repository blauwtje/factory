import { expect, test, type Page } from "@playwright/test";

const out = process.env.SHOTS ?? ".exo/design/current";
const api = `/@fs${process.cwd()}/node_modules/@tauri-apps/api`;

const JOB_ROWS = [
  { id: "solo-job", title: "Add dark mode to settings", status: "building", active: true, project_path: "~/code/web", project_name: "web", branch: "factory/session", archived: false },
  { id: "team-job", title: "Design and build search", status: "awaiting_approval", project_path: "~/code/web", project_name: "web", branch: "factory/session", archived: false },
  { id: "old-job", title: "Fix flaky login test", status: "merged", project_path: "~/code/web", project_name: "web", branch: "factory/session", archived: false },
  { id: "api-job", title: "Rate limit the public API", status: "planning", active: true, project_path: "~/code/api", project_name: "api", branch: "factory/session", archived: false },
  { id: "cli-job", title: "Port config loader to TOML", status: "failed", project_path: "~/code/cli", project_name: "cli", branch: "factory/session", archived: false },
];

const NOW = Math.floor(Date.now() / 1000);
const JOB_EXTRAS: Record<string, object> = {
  "solo-job": { account_id: "default", created_at: NOW - 5_400, last_active_at: NOW - 20, worktree: "~/code/web/.factory/worktrees/session", needs_reply: false, context_tokens: 62_000 },
  "team-job": { account_id: "default", created_at: NOW - 3_600, last_active_at: NOW - 600, worktree: "~/code/web/.factory/worktrees/session", needs_reply: true, context_tokens: 118_000 },
  "old-job": { account_id: "~/profiles/work/home", created_at: NOW - 172_800, last_active_at: NOW - 86_400, worktree: null, needs_reply: false, context_tokens: null },
  "api-job": { account_id: "~/profiles/work/home", created_at: NOW - 900, last_active_at: NOW - 30, worktree: "~/code/api/.factory/worktrees/session", needs_reply: false, context_tokens: 24_000 },
  "cli-job": { account_id: "default", created_at: NOW - 7_200, last_active_at: NOW - 3_000, worktree: "~/code/cli/.factory/worktrees/session", needs_reply: false, context_tokens: 9_000 },
};

const JOBS = JOB_ROWS.map((job) => ({ pinned: false, failed: job.status === "failed", cleaned_up: false, ...job, ...JOB_EXTRAS[job.id] }));

const resets = NOW + 7_200;
const ACCOUNTS = [
  {
    id: "default",
    label: "Personal",
    email: "user@example.com",
    plan: "max",
    config_dir: null,
    is_default: true,
    limits: [
      { kind: "weekly_all", label: "Weekly", percent: 48, resets_at: resets + 200_000, severity: "normal", active: false },
      { kind: "weekly_scoped", label: "Fable weekly", percent: 71, resets_at: resets + 200_000, severity: "warning", active: true },
    ],
    updated_at: NOW - 120,
    error: null,
    refreshing: false,
  },
  {
    id: "~/profiles/work/home",
    label: "Work",
    email: "jane@example.com",
    plan: "team",
    config_dir: "~/profiles/work/home",
    is_default: false,
    limits: [
      { kind: "session", label: "5-hour", percent: 36, resets_at: resets, severity: "normal", active: false },
      { kind: "weekly_all", label: "Weekly", percent: 22, resets_at: resets + 200_000, severity: "normal", active: false },
    ],
    updated_at: NOW - 300,
    error: null,
    refreshing: false,
  },
];

const AGENTS: Record<string, unknown[]> = {
  "solo-job": [
    { id: "solo-1", kind: "lead", permission_mode: "default", name: "solo", role: "solo-agent", model: "claude-sonnet-5-5", effort: "medium", why: "a clear, small change", status: "running", worktree: "~/code/web/.factory/worktrees/session" },
  ],
  "team-job": [
    { id: "orch-1", kind: "lead", permission_mode: "default", name: "orchestrator", role: "orchestrator", model: "claude-opus-5-5", effort: "high", why: "splits the work", status: "waiting", worktree: "~/code/web/.factory/worktrees/session" },
    { id: "design-1", kind: "worker", permission_mode: "default", name: "designer", role: "designer", model: "claude-opus-5-5", effort: "xhigh", why: "the ranking design needs depth", status: "done", worktree: "~/code/web/.factory/worktrees/session" },
    { id: "build-1", kind: "worker", permission_mode: "default", name: "builder", role: "builder", model: "claude-sonnet-5-5", effort: "medium", why: "the build follows the plan", status: "running", worktree: "~/code/web/.factory/worktrees/session" },
  ],
  "api-job": [
    { id: "solo-2", name: "solo", role: "solo-agent", model: "claude-sonnet-5-5", effort: "medium", why: "one middleware and its tests", status: "running", worktree: "~/code/web/.factory/worktrees/session" },
  ],
};

const ROLES = [
  { name: "builder", description: "Edits code or prose for one plan task, repair or fix and proves it. Start one fresh builder per separate job, with the brief or prompt path and the checkout in the brief.", model: "claude-sonnet-5-5", effort: "medium", tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep", "TaskStop"] },
  { name: "debugger", description: "Finds the cause of a failure with a reproduction and fixes it at the cause with the smallest change. Use for an unknown cause, a flaky test or a failure that survived a first fix.", model: "claude-opus-5-5", effort: "high", tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"] },
  { name: "orchestrator", description: "Leads a session in Auto or Team mode: plans, starts team agents with a chosen model and effort, merges their branches and reports. Not for a single small task a solo agent can do.", model: "claude-opus-5-5", effort: "high", tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Skill", "mcp__factory__spawn_agent", "mcp__factory__set_agent_model", "mcp__factory__send_to_agent", "mcp__factory__list_agents", "mcp__factory__read_agent", "mcp__factory__plan_ready"] },
  { name: "planner", description: "Turns a goal into a plan file of ordered tasks with proofs and the design decisions behind them. Use for architecture and structure before building; it writes no product code.", model: "claude-opus-5-5", effort: "high", tools: ["Read", "Write", "Bash", "Glob", "Grep", "Skill"] },
  { name: "researcher", description: "Reads and answers one bounded question from the sources the brief names (repo, web, docs or brief) and writes the findings to a file. Not for a named file or symbol, a fix or a design.", model: "claude-sonnet-5-5", effort: "medium", tools: ["Read", "Write", "Bash", "Glob", "Grep", "WebSearch", "WebFetch"] },
  { name: "reviewer", description: "Reviews a diff against the plan in two passes and reports findings that touch correctness or security; changes no file. Use after a build, on a clean context.", model: "claude-opus-5-5", effort: "high", tools: ["Read", "Bash", "Glob", "Grep"] },
  { name: "solo-agent", description: "The single lead of a Solo session: plans with the user, then builds the approved plan alone. Not a team member.", model: "claude-opus-5-5", effort: "high", tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Skill", "mcp__factory__plan_ready"] },
  { name: "tester", description: "Writes and runs tests from the plan's requirements, not from the implementation, and reports only what fails. Use after or beside a build; it changes no product code.", model: "claude-sonnet-5-5", effort: "medium", tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"] },
  { name: "ui-designer", description: "Chooses screens, layout and interaction for a UI task and writes the design for a builder to implement; checks the running UI. Use before UI building.", model: "claude-opus-5-5", effort: "high", tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"] },
];

const TOOLS = ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebSearch", "WebFetch", "Skill", "TaskStop", "mcp__factory__spawn_agent", "mcp__factory__send_to_agent", "mcp__factory__set_agent_model", "mcp__factory__list_agents", "mcp__factory__read_agent", "mcp__factory__plan_ready"];

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const entry = (kind: string, source: string, name: string, rest: Record<string, unknown>) => ({
  id: `${kind}:${source}:${rest.plugin ?? ""}:${name}`,
  kind,
  name,
  source,
  plugin: null,
  description: "",
  path: `~/.claude/${name}`,
  enabled: true,
  use_tokens: 0,
  exact: true,
  uses: 0,
  last_used: null,
  ...rest,
});

const CUSTOMIZE_ITEMS = [
  entry("plugin", "plugin", "workflow", { plugin: "workflow", description: "Plan, build and review in steps with proof.", path: "~/.claude/plugins/workflow", invocation: "Adds 3 skills, 1 agent, 1 command", loaded_tokens: 410, use_tokens: 6_800, uses: 41, last_used: ago(0.1) }),
  entry("plugin", "plugin", "lint-kit", { plugin: "lint-kit", description: "Formatter and linter hooks.", path: "~/.claude/plugins/lint-kit", invocation: "Adds 1 hook, 1 MCP server", loaded_tokens: 2_900, uses: 0, enabled: false }),
  entry("skill", "factory", "build", { description: "Builds a change with a proof for each step and one review of the result.", path: "~/kit/skills/build/SKILL.md", invocation: "Claude or /build", loaded_tokens: 58, use_tokens: 3_400, uses: 23, last_used: ago(0.2) }),
  entry("skill", "factory", "diagnose", { description: "Finds the proven cause of wrong behavior, then fixes it with a test seen red before green.", path: "~/kit/skills/diagnose/SKILL.md", invocation: "Claude or /diagnose", loaded_tokens: 64, use_tokens: 2_100, uses: 6, last_used: ago(3) }),
  entry("skill", "factory", "document", { description: "Writes and edits prose read later: README, doc page, changelog line.", path: "~/kit/skills/document/SKILL.md", invocation: "Claude or /document", loaded_tokens: 0, use_tokens: 1_700, enabled: false }),
  entry("skill", "user", "release-notes", { description: "Drafts release notes from merged pull requests.", path: "~/.claude/skills/release-notes/SKILL.md", invocation: "Only /release-notes", loaded_tokens: 0, use_tokens: 900, uses: 2, last_used: ago(12) }),
  entry("skill", "plugin", "review", { plugin: "workflow", description: "Reviews a diff for correctness and security.", path: "~/.claude/plugins/workflow/skills/review/SKILL.md", invocation: "Claude or /review", loaded_tokens: 41, use_tokens: 2_600, uses: 18, last_used: ago(0.5) }),
  entry("agent", "factory", "builder", { description: "Writes the code for one task and proves it.", path: "~/kit/agents/builder.md", invocation: "Claude starts it", loaded_tokens: 32, use_tokens: 1_200, uses: 57, last_used: ago(0.05) }),
  entry("agent", "factory", "reviewer", { description: "Reads the diff and reports what is wrong.", path: "~/kit/agents/reviewer.md", invocation: "Claude starts it", loaded_tokens: 28, use_tokens: 900, uses: 19, last_used: ago(0.3) }),
  entry("agent", "user", "scout", { description: "Searches the codebase and answers where things live.", path: "~/.claude/agents/scout.md", invocation: "Claude starts it", loaded_tokens: 24, use_tokens: 600, uses: 0 }),
  entry("mcp", "project", "postgres", { description: "Query the development database.", path: "~/code/web/.mcp.json", invocation: "Claude calls its tools", loaded_tokens: 1_840, uses: 9, last_used: ago(1) }),
  entry("mcp", "plugin", "lint-server", { plugin: "lint-kit", description: "Runs the linter on demand.", path: "~/.claude/plugins/lint-kit/.mcp.json", invocation: "Claude calls its tools", loaded_tokens: 2_900, enabled: false }),
  entry("hook", "user", "npx prettier --write \"$FILE\"", { path: "~/.claude/settings.json", invocation: "PostToolUse · Edit|Write", loaded_tokens: 0, uses: 212, last_used: ago(0.05) }),
  entry("hook", "project", "./scripts/check-env.sh", { path: "~/code/web/.claude/settings.json", invocation: "SessionStart", loaded_tokens: 0, uses: 14, last_used: ago(0.4) }),
  entry("rule", "user", "typescript.md", { description: "Strict types, no any, small functions.", path: "~/.claude/rules/typescript.md", invocation: "When files match **/*.ts", loaded_tokens: 0, use_tokens: 380, uses: 31, last_used: ago(0.2) }),
  entry("rule", "project", "testing.md", { description: "Every change ships with a test seen red first.", path: "~/code/web/.claude/rules/testing.md", invocation: "Always", loaded_tokens: 260, uses: 33, last_used: ago(0.1) }),
  entry("memory", "user", "CLAUDE.md", { description: "Personal instructions for every project.", path: "~/.claude/CLAUDE.md", invocation: "Always", loaded_tokens: 1_420, uses: 48, last_used: ago(0.05) }),
  entry("memory", "project", "CLAUDE.md", { description: "How this project builds, tests and ships.", path: "~/code/web/CLAUDE.md", invocation: "Always", loaded_tokens: 2_310, uses: 0 }),
  entry("command", "user", "standup", { description: "Summarizes yesterday's commits for the standup.", path: "~/.claude/commands/standup.md", invocation: "/standup", loaded_tokens: 18, use_tokens: 240, uses: 4, last_used: ago(2) }),
  entry("command", "plugin", "ship", { plugin: "workflow", description: "Opens a pull request with the plan as its body.", path: "~/.claude/plugins/workflow/commands/ship.md", invocation: "/ship", loaded_tokens: 22, use_tokens: 520 }),
];

const CUSTOMIZE = { project_path: "~/code/web", items: CUSTOMIZE_ITEMS, context_max: 200_000, measured: true };

const KINDS = [
  { id: "plan", role: "planner", model: "claude-opus-5-5", effort: "high", edited: false },
  { id: "build", role: "builder", model: "claude-sonnet-5-5", effort: "medium", edited: true },
  { id: "mechanical", role: "builder", model: "claude-haiku-5-5", effort: "medium", edited: false },
  { id: "review", role: "reviewer", model: "claude-opus-5-5", effort: "high", edited: false },
];

const tokens = (input: number, cache_write: number, cache_read: number, output: number) => ({ input, cache_write, cache_read, output, uncached: input + cache_write + output });
const NOW_HOUR = Math.floor(Date.now() / 3_600_000);
const CLOCK = [0, 0, 0, 0, 0, 0, 0, 0.1, 0.4, 0.9, 1, 0.95, 0.5, 0.8, 1, 0.9, 0.85, 0.7, 0.4, 0.3, 0.45, 0.5, 0.3, 0.1];
const activity = (hour: number) => {
  const at = new Date(hour * 3_600_000);
  const daysAgo = Math.floor((NOW_HOUR - hour) / 24);
  const weekend = at.getDay() === 0 || at.getDay() === 6 ? 0.2 : 1;
  const idle = at.getDate() % 9 === 4 ? 0 : 1;
  const wobble = 0.6 + Math.abs(Math.sin(hour * 12.9898)) * 0.8;
  return CLOCK[at.getHours()] * weekend * idle * wobble * (0.45 + (180 - daysAgo) / 180);
};
const BY_HOUR = Array.from({ length: 180 * 24 }, (_, i) => NOW_HOUR - i)
  .map((hour) => [hour, activity(hour)] as const)
  .filter(([, weight]) => weight > 0)
  .map(([hour, weight]) => [hour, tokens(Math.round(24_000 * weight), Math.round(90_000 * weight), Math.round(1_400_000 * weight), Math.round(16_000 * weight))] as const);
const share = (part: number) => {
  const sum = (key: "input" | "cache_write" | "cache_read" | "output") => Math.round(BY_HOUR.reduce((total, [, t]) => total + t[key], 0) * part);
  return tokens(sum("input"), sum("cache_write"), sum("cache_read"), sum("output"));
};
const STATS = {
  total: share(1),
  by_model: [
    ["claude-opus-5-5", share(0.64)],
    ["claude-sonnet-5-5", share(0.27)],
    ["claude-haiku-4-5", share(0.09)],
  ],
  by_project: [
    ["~/code/web", share(0.52)],
    ["~/code/api", share(0.31)],
    ["~/code/docs", share(0.17)],
  ],
  by_hour: BY_HOUR,
  sessions: 214,
  messages: 18_406,
  tool_calls: 9_730,
  first_session: "2026-03-02",
  progress: { files_done: 70_190, files_total: 70_190 },
};

async function openApp(page: Page, jobs = JOBS) {
  await page.exposeFunction("ipc", (cmd: string, args: Record<string, unknown>) => {
    if (cmd === "list_jobs") return jobs;
    if (cmd === "list_accounts") return ACCOUNTS;
    if (cmd === "project_accounts") return { "~/code/web": "default", "~/code/api": "~/profiles/work/home" };
    if (cmd === "list_agents") return AGENTS[String(args.job_id)] ?? [];
    if (cmd === "claude_info") return { path: "~/.local/bin/claude", version: "2.1.326" };
    if (cmd === "plugin:app|version") return "0.1.0";
    if (cmd === "list_projects") return [{ path: "~/code/web", name: "web", last_used: 1 }];
    if (cmd === "list_roles") return ROLES.map((role) => ({ ...role, prompt: `# ${role.name}\n\nFollow the brief.`, origin: role.name === "builder" ? "edited" : "builtin" }));
    if (cmd === "list_tools") return TOOLS;
    if (cmd === "list_customize" || cmd === "measure_customize") return CUSTOMIZE;
    if (cmd === "list_kinds") return KINDS;
    if (cmd === "claude_stats" || cmd === "claude_stats_snapshot") return STATS;
    if (cmd === "agent_history") return [];
    if (cmd === "search_sessions") return [];
    if (cmd === "context_usage") {
      return {
        categories: [
          { name: "System prompt", tokens: 6_200, kind: "used" },
          { name: "Tools", tokens: 14_800, kind: "used" },
          { name: "Messages", tokens: 41_000, kind: "used" },
          { name: "Free space", tokens: 138_000, kind: "free" },
        ],
        totalTokens: 62_000,
        maxTokens: 200_000,
      };
    }
    if (cmd === "session_tokens") {
      const agents = (AGENTS[String(args.job_id)] ?? []) as { id: string }[];
      return { total: tokens(42_000, 118_000, 2_400_000, 21_000), agents: agents.map(({ id }) => ({ agent_id: id, tokens: tokens(14_000, 39_000, 800_000, 7_000) })) };
    }
    return null;
  });
  await page.route("**/src/main.tsx", async (route) => {
    const original = await (await route.fetch()).text();
    const bootstrap = `
      import { mockIPC, mockWindows } from "${api}/mocks.js";
      import { emit } from "${api}/event.js";
      window.emitEvent = emit;
      mockWindows("main");
      mockIPC((cmd, args) => window.ipc(cmd, args), { shouldMockEvents: true });
    `;
    await route.fulfill({ contentType: "text/javascript", body: bootstrap + original });
  });
  await page.goto("/");
  await page.getByRole("combobox", { name: "What should we build?" }).waitFor();
  const emit = (event: string, payload: unknown) =>
    page.evaluate(
      ([name, data]) => (window as unknown as { emitEvent: (n: string, d: unknown) => Promise<void> }).emitEvent(name as string, data),
      [event, payload],
    );
  const usage = () =>
    emit("usage", {
      five_hour: { utilization: 0.42, resets_at: 1795222800 },
      seven_day: { utilization: 0.18, resets_at: 1795654800 },
    });
  await usage();
  await page.waitForTimeout(600);
  return { emit, usage };
}

const shot = (page: Page, name: string) => page.screenshot({ path: `${out}/${name}.png` });

test("screens", async ({ page }) => {
  const { emit, usage } = await openApp(page);
  await page.getByRole("button", { name: /Add dark mode/ }).waitFor();
  await shot(page, "1-home");

  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("combobox", { name: "What should we build?" }).waitFor();
  await page.waitForTimeout(600);
  await shot(page, "2-new-session");

  await page.getByRole("button", { name: /Add dark mode/ }).click();
  await page.getByRole("combobox", { name: "Message" }).waitFor();
  const solo = (event: unknown) => emit("agent-event", { job_id: "solo-job", agent_id: "solo-1", event });
  await solo({ Assistant: { content: "I'll add a **dark mode** toggle to the settings page. First I'll look at how the theme is set today." } });
  await solo({ ToolUse: { id: "t1", name: "Read", input: { file_path: "src/settings/Theme.tsx" } } });
  await solo({ ToolResult: { id: "t1", output: "export function Theme() {\n  return <Toggle label=\"Light\" />;\n}", is_error: false } });
  await solo({
    ToolUse: {
      id: "t2",
      name: "Edit",
      input: {
        file_path: "src/settings/Theme.tsx",
        old_string: 'export function Theme() {\n  return <Toggle label="Light" />;\n}',
        new_string: 'export function Theme() {\n  const [dark, setDark] = useTheme();\n  return <Toggle label="Dark mode" checked={dark} onChange={setDark} />;\n}',
      },
    },
  });
  await solo({ ToolResult: { id: "t2", output: "ok", is_error: false } });
  await solo({ TextDelta: { text: "The toggle is in place. Now I'll run the tests to check nothing else" } });
  await solo({ ControlRequest: { request_id: "r1", tool_name: "Bash", input: { command: "npm test -- settings" } } });
  await page.waitForTimeout(400);
  await shot(page, "3-solo-session");

  await page.getByRole("button", { name: /Design and build search/ }).click();
  await page.getByRole("tab", { name: /^Orchestrator/ }).waitFor();
  const orch = (event: unknown) => emit("agent-event", { job_id: "team-job", agent_id: "orch-1", event });
  await orch({ ToolUse: { id: "o1", name: "mcp__factory__spawn_agent", input: { name: "designer" } } });
  await orch({ ToolResult: { id: "o1", output: "designer started", is_error: false } });
  await orch({ ToolUse: { id: "o2", name: "mcp__factory__plan_ready", input: { path: "docs/plans/search.md" } } });
  await orch({ ToolResult: { id: "o2", output: "plan sent for approval", is_error: false } });
  await orch({
    Assistant: {
      content:
        "The plan is ready.\n\n1. Index titles and bodies with a trigram index\n2. Rank by recency and match quality\n3. Add a search box to the header\n\nThe designer chose the ranking; the builder starts after you approve.",
    },
  });
  await page.waitForTimeout(400);
  await shot(page, "4-team-plan");

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const nav = page.getByRole("navigation", { name: "Settings" });
  await nav.waitFor();
  for (const tab of ["General", "Sessions", "Usage", "Statistics", "Claude CLI", "About"]) {
    await nav.getByRole("button", { name: tab }).click();
    await usage();
    await page.waitForTimeout(400);
    await shot(page, `5-settings-${tab.toLowerCase().replace(" ", "-")}`);
  }
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Customize", exact: true }).click();
  const customizeNav = page.getByRole("navigation", { name: "Customize" });
  await customizeNav.waitFor();
  for (const section of ["Overview", "Plugins", "Skills", "Agents", "MCP servers", "Hooks", "Rules", "Memory"]) {
    await customizeNav.getByRole("button", { name: section }).click();
    await page.getByRole("heading", { name: section, level: 3 }).waitFor();
    await page.waitForTimeout(400);
    await shot(page, `6-customize-${section.toLowerCase().replace(" ", "-")}`);
  }
  await page.keyboard.press("Escape");

  await page.keyboard.press("Control+k");
  await page.getByRole("dialog", { name: "Command palette" }).waitFor();
  await page.keyboard.type("dark");
  await page.waitForTimeout(300);
  await shot(page, "6-palette");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: /Rate limit the public API/ }).click();
  await page.getByRole("combobox", { name: "Message" }).waitFor();
  const working = (event: unknown) => emit("agent-event", { job_id: "api-job", agent_id: "solo-2", event });
  await working({ Assistant: { content: "I'll add a token bucket limiter in front of the public routes." } });
  await working({ ToolUse: { id: "w1", name: "Read", input: { file_path: "src/routes/public.ts" } } });
  await working({ ToolResult: { id: "w1", output: "export const routes = [search, items, users];", is_error: false } });
  await working({ TextDelta: { text: "Three routes share one handler, so one middleware covers them. Running the route tests first" } });
  await working({ ToolUse: { id: "w2", name: "Bash", input: { command: "npm test -- routes" } } });
  await page.waitForTimeout(400);
  await shot(page, "7-working");
});

const overflowing = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("main, main *")]
      .filter((el) => /auto|scroll/.test(getComputedStyle(el).overflowY) && !el.closest("[data-scroll-inside]") && el.scrollHeight > el.clientHeight)
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}: ${el.scrollHeight} > ${el.clientHeight}`),
  );

test("every page fits", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  const { usage } = await openApp(page);
  const settle = async (name: string) => {
    await usage();
    await page.waitForTimeout(500);
    expect(await overflowing(page), name).toEqual([]);
  };
  await settle("Home");

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const nav = page.getByRole("navigation", { name: "Settings" });
  await nav.waitFor();
  for (const section of ["General", "Sessions", "Usage", "Statistics", "Claude CLI", "About"]) {
    await nav.getByRole("button", { name: section }).click();
    await settle(section);
  }
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Customize", exact: true }).click();
  const customizeNav = page.getByRole("navigation", { name: "Customize" });
  await customizeNav.waitFor();
  for (const section of ["Overview", "Plugins", "Skills", "Agents", "MCP servers", "Hooks", "Rules", "Memory"]) {
    await customizeNav.getByRole("button", { name: section }).click();
    await settle(section);
  }
});

test("empty", async ({ page }) => {
  await openApp(page, []);
  await shot(page, "8-empty-home");
});
