import { existsSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import process from "node:process";
import { createInterface } from "node:readline";

const argv = process.argv.slice(2);
const flag = (name) => argv[argv.indexOf(name) + 1];
const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);

if (argv.includes("--version")) {
  process.stdout.write("2.1.326 (Claude Code)\n");
  process.exit(0);
}

if (argv.includes("--help")) {
  process.stdout.write('  --permission-mode <mode>  Permission mode (choices: "acceptEdits", "plan")\n');
  process.exit(0);
}

const configDir = process.env.CLAUDE_CONFIG_DIR ?? null;
const account = !configDir ? "default" : basename(configDir) === "home" ? basename(dirname(configDir)) : basename(configDir);

if (argv[0] === "auth" && argv[1] === "status") {
  const loggedIn = account !== "loggedout";
  process.stdout.write(`${JSON.stringify({ loggedIn, email: `${account}@example.com`, subscriptionType: "max", planTier: "max_5x", orgId: "org-1" })}\n`);
  process.exit(0);
}

const role = flag("--agent").replace(/^factory:/, "");
const model = flag("--model");
const sessionId = flag("--session-id") ?? flag("--resume");
const leaked = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"].filter((name) => name in process.env);

if (role === "no-init") process.exit(1);

if (process.env.FAKE_CLAUDE_PID_DIR) writeFileSync(`${process.env.FAKE_CLAUDE_PID_DIR}/${process.pid}`, process.cwd());

let started = false;
const start = () => {
  started = true;
  emit({ type: "system", subtype: "hook_started", hook_name: "SessionStart:startup" });
  emit({
    type: "system",
    subtype: "init",
    session_id: sessionId,
    model: role === "wrong-model" ? "claude-haiku-5-5" : model,
    apiKeySource: role === "wrong-key" || leaked.includes("ANTHROPIC_API_KEY") ? "ANTHROPIC_API_KEY" : "none",
  });
};

const categories = [
  { name: "System prompt", tokens: 2900 },
  { name: "Memory files", tokens: 321, kind: "used" },
  { name: "MCP tools", tokens: 50, kind: "deferred" },
  { name: "Messages", tokens: 8, kind: "used" },
  { name: "Autocompact buffer", tokens: 33000, kind: "buffer" },
  { name: "Free space", tokens: 163771, kind: "free" },
];

const summary = () => ({
  memoryFiles: [{ path: `${process.cwd()}/CLAUDE.md`, type: "Project", tokens: 321 }],
  mcpTools: [
    { name: "mcp__notes__search", serverName: "notes", tokens: 40, isLoaded: true },
    { name: "mcp__notes__list", serverName: "notes", tokens: 25, isLoaded: true },
    { name: "mcp__notes__later", serverName: "notes", tokens: 999, isLoaded: false },
    { name: "mcp__plugin_tools_lsp__hover", serverName: "plugin_tools_lsp", tokens: 30, isLoaded: false },
    { name: "mcp__plugin_tools_lsp__rename", serverName: "plugin_tools_lsp", tokens: 20, isLoaded: false },
  ],
  mcpInstructions: [{ serverName: "notes", tokens: 10 }],
  agents: [{ agentType: "helper", source: "userSettings", tokens: 77 }],
  skills: {
    skillFrontmatter: [
      { name: "humanizer", source: "userSettings", tokens: 55 },
      { name: "factory:build", source: "plugin", pluginName: "factory", tokens: 88 },
    ],
  },
});

let open = null;
let held = false;
let waiting = [];
let notesUp = false;
const interrupt = (requestId) => {
  if (open) emit({ type: "control_cancel_request", request_id: open });
  emit({ type: "control_response", response: { subtype: "success", request_id: requestId, response: { still_queued: [] } } });
  if (!open) return;
  open = null;
  const rejected = "The user doesn't want to proceed with this tool use. The tool use was rejected.";
  emit({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: rejected, is_error: true, tool_use_id: "toolu_team" }] } });
  emit({ type: "user", message: { role: "user", content: [{ type: "text", text: "[Request interrupted by user for tool use]" }] } });
  emit({ type: "result", subtype: "error_during_execution", is_error: true, terminal_reason: "aborted_tools", session_id: sessionId });
};

createInterface({ input: process.stdin }).on("line", (line) => {
  if (line === "") return;
  if (!started) start();
  const message = JSON.parse(line);
  if (message.type === "control_request" && message.request.subtype === "interrupt") {
    interrupt(message.request_id);
    return;
  }
  if (message.type === "control_request" && message.request.subtype === "set_permission_mode") {
    if (message.request.mode === "invalid") {
      emit({ type: "control_response", response: { subtype: "error", request_id: message.request_id, error: "Invalid permission mode" } });
      return;
    }
    emit({ type: "control_response", response: { subtype: "success", request_id: message.request_id, response: { mode: message.request.mode } } });
    return;
  }
  if (message.type === "control_request" && message.request.subtype === "get_usage") {
    const limit = (kind, percent, scope = null) => ({ kind, group: kind, percent, severity: "normal", resets_at: "2026-11-20T13:00:00.076020+00:00", scope, is_active: false });
    const limits = account === "ultra"
      ? [limit("weekly_all", 12), limit("weekly_scoped", 3, { model: { id: null, display_name: "Fable" } })]
      : [limit("session", 36), limit("weekly_all", 55)];
    if (configDir && existsSync(join(configDir, "fail"))) {
      emit({ type: "control_response", response: { subtype: "error", request_id: message.request_id, error: "Not logged in" } });
      return;
    }
    const report = { subscription_type: "max", rate_limits: { limits } };
    emit({ type: "control_response", response: { subtype: "success", request_id: message.request_id, response: report } });
    return;
  }
  if (message.type === "control_request" && message.request.subtype === "get_context_usage") {
    const report = { categories, totalTokens: 1200, maxTokens: 200000 };
    if (message.request.detail === "summary") Object.assign(report, summary());
    emit({ type: "control_response", response: { subtype: "success", request_id: message.request_id, response: report } });
    return;
  }
  if (message.type === "control_request" && message.request.subtype === "mcp_status") {
    const notes = notesUp ? { name: "notes", status: "connected" } : { name: "notes", status: "failed", error: "Connection closed" };
    emit({ type: "control_response", response: { subtype: "success", request_id: message.request_id, response: { mcpServers: [notes] } } });
    return;
  }
  if (message.type === "control_request" && message.request.subtype === "mcp_reconnect") {
    const name = message.request.serverName;
    if (name !== "notes") {
      emit({ type: "control_response", response: { subtype: "error", request_id: message.request_id, error: `Server not found: ${name}` } });
      return;
    }
    notesUp = true;
    emit({ type: "control_response", response: { subtype: "success", request_id: message.request_id, response: {} } });
    return;
  }
  if (message.type === "control_response") {
    open = null;
    emit({ type: "assistant", message: { content: [{ type: "text", text: `permission ${message.response.response.behavior}` }] } });
    emit({ type: "result", session_id: sessionId, is_error: false });
    return;
  }
  const text = message.message.content;
  if (held && text !== "release") {
    waiting.push(text);
    return;
  }
  if (held) {
    const merged = waiting;
    waiting = [];
    held = merged.includes("hold");
    emit({ type: "result", session_id: sessionId, is_error: false });
    if (merged.length === 0) return;
    start();
    if (held) return;
    emit({ type: "assistant", message: { content: [{ type: "text", text: merged.join("\n") }] } });
    emit({ type: "result", session_id: sessionId, is_error: false });
    return;
  }
  if (text === "hold") {
    held = true;
    return;
  }
  if (text === "die") {
    emit({ type: "assistant", message: { content: [{ type: "text", text: "halfway" }] } });
    process.exit(1);
  }
  if (text.startsWith("ask permission")) {
    open = "req_team";
    emit({ type: "control_request", request_id: "req_team", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "ls" } } });
    return;
  }
  emit({
    type: "assistant",
    message: { content: [{ type: "text", text: JSON.stringify({ argv, text, leaked, hasPath: "PATH" in process.env, configDir }) }] },
  });
  emit({ type: "result", session_id: sessionId, is_error: false });
});
