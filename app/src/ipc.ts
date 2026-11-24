import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AgentEventPayload, Turn } from "@/chat/types";
import type { AgentRow, MergeForecast, MergeOutcome } from "@/job/types";
import type { JobStatus } from "@/shell/types";

export type JobRow = {
  id: string;
  title: string;
  status: Exclude<JobStatus, "waiting">;
  project_path: string;
  project_name: string;
  branch: string;
  archived: boolean;
  pinned: boolean;
  active: boolean;
  failed: boolean;
  cleaned_up: boolean;
  account_id?: string | null;
  created_at?: number;
  last_active_at?: number;
  worktree?: string | null;
  needs_reply?: boolean;
  context_tokens?: number | null;
  failure?: string | null;
};

export const listJobs = () => invoke<JobRow[]>("list_jobs");
export const listAgents = (job_id: string) =>
  invoke<AgentRow[]>("list_agents", { job_id });
export const setAgentModel = (
  agent_id: string,
  model: string,
  effort: string,
) => invoke("set_agent_model", { agent_id, model, effort });
export const permissionModes = () => invoke<string[]>("permission_modes");
export const claudePermissionMode = () => invoke<string>("claude_permission_mode");
export const setPermissionMode = (agent_id: string, mode: string) =>
  invoke("set_permission_mode", { agent_id, mode });
export const outputStyles = () => invoke<{ current: string; available: string[] }>("output_styles");
export const setOutputStyle = (name: string) => invoke("set_output_style", { name });
export const approvePlan = (job_id: string) =>
  invoke("approve_plan", { job_id });
export const mergeJob = (job_id: string) =>
  invoke<MergeOutcome>("merge_job", { job_id });
export const mergeForecast = (job_id: string) =>
  invoke<MergeForecast>("merge_forecast", { job_id });
export const resolveConflicts = (job_id: string) =>
  invoke("resolve_conflicts", { job_id });
export type FileChange = {
  path: string;
  old_path: string | null;
  status: "Added" | "Modified" | "Deleted" | "Renamed";
  binary: boolean;
  before: string;
  after: string;
};
export type Scope =
  | { kind: "branch" }
  | { kind: "uncommitted" }
  | { kind: "commit"; sha: string };
export const jobChanges = (
  job_id: string,
  scope: Scope = { kind: "branch" },
) => invoke<FileChange[]>("job_changes", { job_id, scope });
export type CommitRow = { sha: string; subject: string };
export const jobCommits = (job_id: string) =>
  invoke<CommitRow[]>("job_commits", { job_id });
export type Overlap = { job_id: string; title: string; files: string[] };
export const jobOverlaps = (job_id: string) =>
  invoke<Overlap[]>("job_overlaps", { job_id });
export const sendMessage = (agent_id: string, text: string) =>
  invoke("send_message", { agent_id, text });
export const archiveJob = (job_id: string, archived: boolean) =>
  invoke("archive_job", { job_id, archived });
export const pinJob = (job_id: string, pinned: boolean) =>
  invoke("pin_job", { job_id, pinned });
export const renameJob = (job_id: string, title: string) =>
  invoke("rename_job", { job_id, title });
export type ResumeCommand = { command: string; running: boolean };
export const resumeCommand = (job_id: string) =>
  invoke<ResumeCommand>("resume_command", { job_id });
export const setTrayStatus = (title: string, tooltip: string) =>
  invoke("set_tray_status", { title, tooltip });
export const deleteJob =(job_id: string) => invoke("delete_job", { job_id });

export type ClaudeInfo = { path: string; version: string };

export const claudeInfo = () => invoke<ClaudeInfo>("claude_info");

export type Origin = "builtin" | "edited" | "custom";
export type Role = {
  name: string;
  description: string;
  model: string;
  effort: string;
  tools: string[];
  prompt: string;
  origin: Origin;
};
export type RoleInput = Omit<Role, "origin">;
export type Skill = { name: string; description: string; enabled: boolean; origin: Exclude<Origin, "edited"> };
export type Kind = { id: string; role: string; model: string; effort: string; edited: boolean };
export type Attachment = { path: string; name: string };
export type Tokens = {
  input: number;
  cache_write: number;
  cache_read: number;
  output: number;
  uncached: number;
};
export type Progress = { files_done: number; files_total: number };
export type Stats = {
  total: Tokens;
  by_model: [string, Tokens][];
  by_project: [string, Tokens][];
  by_hour: [number, Tokens][];
  sessions: number;
  messages: number;
  tool_calls: number;
  first_session: string | null;
  progress: Progress;
};
export type SessionTokens = {
  total: Tokens;
  agents: { agent_id: string; tokens: Tokens }[];
};
export type RecentProject = { path: string; name: string; last_used: number };
export type NewJob = {
  project_path: string;
  prompt: string;
  account_id?: string;
  mode?: "auto" | "solo" | "team";
  model?: string;
  effort?: string;
  permission_mode?: string;
};

export type CustomizeKind = "plugin" | "skill" | "agent" | "mcp" | "hook" | "rule" | "memory" | "command";
export type CustomizeSource = "factory" | "user" | "project" | "plugin";
export type ScanVerdict = "pass" | "review" | "risk";
export type CustomizeItem = {
  id: string;
  kind: CustomizeKind;
  name: string;
  description: string;
  source: CustomizeSource;
  plugin: string | null;
  origin?: string | null;
  scope?: "user" | "project" | "local" | null;
  version?: string | null;
  path: string;
  invocation: string;
  enabled: boolean;
  loaded_tokens: number | null;
  use_tokens: number;
  exact: boolean;
  uses: number;
  last_used: string | null;
  scan?: { verdict: ScanVerdict; findings: { level: "review" | "risk"; reason: string }[] };
  conflicts?: string[];
};
export type Customize = {
  project_path: string | null;
  items: CustomizeItem[];
  context_max: number;
  measured: boolean;
  measured_at?: string | null;
  context?: { total: number; max: number; categories: { name: string; tokens: number; kind: "used" | "deferred" | "buffer" | "free" }[] } | null;
};

export const customizeKey = (path: string | null) => `customize:${path ?? "all"}`;
export const listCustomize = (project_path: string | null) =>
  invoke<Customize>("list_customize", { project_path });
export const measureCustomize = (project_path: string | null) =>
  invoke<Customize>("measure_customize", { project_path });

export type CustomizeDraft = { name: string; description: string; paths: string[]; body: string };
export type CustomizeSaveRequest = {
  kind: "skill" | "agent" | "rule" | "memory";
  scope: "user" | "project";
  project: string | null;
  original_path: string | null;
  draft: CustomizeDraft;
};
export const readCustomizeItem = (path: string) => invoke<CustomizeDraft>("read_customize_item", { path });
export const saveCustomizeItem = (request: CustomizeSaveRequest) => invoke<string>("save_customize_item", { request });
export const deleteCustomizeItem = (path: string) => invoke<void>("delete_customize_item", { path });

export type ContextCategory ={ id?: string; name: string; tokens: number; kind?: "used" | "deferred" | "buffer" | "free" };
type Sourced = { source?: string; path?: string; tokens: number };
export type ContextUsage = {
  categories: ContextCategory[];
  totalTokens: number;
  maxTokens: number;
  memoryFiles?: { path: string; type: string; tokens: number }[];
  skills?: { skillFrontmatter?: (Sourced & { name: string })[] };
  agents?: (Sourced & { agentType: string })[];
  mcpTools?: { serverName: string; tokens: number; isLoaded?: boolean }[];
};

export const agentHistory = (agent_id: string) => invoke<Turn[]>("agent_history", { agent_id });
export const contextUsage = (agent_id: string) => invoke<ContextUsage>("context_usage", { agent_id });
export type PullRequest = {
  number: number;
  title: string;
  url: string;
  state: "open" | "draft" | "merged" | "closed";
  checks: "passing" | "failing" | "pending" | null;
  issues: { number: number; url: string }[];
};
export type JobLinks = { repo_url: string | null; branch_url: string | null; pull_request: PullRequest | null };
export const jobLinks = (job_id: string) => invoke<JobLinks>("job_links", { job_id });
export const openWorktree = (agent_id: string) => invoke<void>("open_worktree", { agent_id });
export const settingsChanged = (agent_id: string) => invoke<boolean>("settings_changed", { agent_id });
export type McpServer = { name: string; status: "connected" | "failed" | "needs-auth" | "pending" | "disabled"; error?: string };
export const mcpStatus = (agent_id: string) => invoke<McpServer[]>("mcp_status", { agent_id });
export const mcpReconnect = (agent_id: string, server: string) => invoke<void>("mcp_reconnect", { agent_id, server });
export const listRoles = () => invoke<Role[]>("list_roles");
export const saveRole = (role: RoleInput) => invoke<Role>("save_role", { role });
export const resetRole = (name: string) => invoke("reset_role", { name });
export const listTools = () => invoke<string[]>("list_tools");
export const listSkills = () => invoke<Skill[]>("list_skills");
export const setSkillEnabled = (name: string, enabled: boolean) =>
  invoke("set_skill_enabled", { name, enabled });
export const listKinds = () => invoke<Kind[]>("list_kinds");
export const saveKind = (kind: Omit<Kind, "edited">) => invoke<Kind>("save_kind", { kind });
export const resetKind = (id: string) => invoke("reset_kind", { id });
export const saveAttachment = (name: string, base64: string) =>
  invoke<Attachment>("save_attachment", { name, base64 });
export const attachPath = (path: string) => invoke<Attachment>("attach_path", { path });
export const claudeStats = (projectPath: string | null) => invoke<Stats>("claude_stats", { project_path: projectPath });
export const claudeStatsSnapshot = (projectPath: string | null) =>
  invoke<Stats>("claude_stats_snapshot", { project_path: projectPath });
export const sessionTokens = (job_id: string) =>
  invoke<SessionTokens>("session_tokens", { job_id });
export type SearchHit = {
  job_id: string;
  agent_id: string;
  title: string;
  role: "user" | "assistant";
  text: string;
  snippet: string;
  seq: number;
};
export const searchSessions = (query: string) =>
  invoke<SearchHit[]>("search_sessions", { query });
export const listProjects = () => invoke<RecentProject[]>("list_projects");
export type AuditEntry = {
  time: number;
  job_id: string;
  agent_id: string;
  tool_name: string;
  input: Record<string, unknown>;
  decision: "allow_once" | "allow_always" | "deny";
  reason?: string;
};
export const permissionLog = (project_path: string | null) =>
  invoke<AuditEntry[]>("permission_log", { project_path });
export const createJob = (job: NewJob) =>
  invoke<{ id: string; initialized: boolean }>("create_job", { job });

export function onTokens(handler: (job_id: string) => void) {
  const unlisten = listen<{ job_id: string }>("tokens", ({ payload }) =>
    handler(payload.job_id),
  );
  return () => void unlisten.then((stop) => stop());
}

export function onStatsProgress(handler: (progress: Progress) => void) {
  const unlisten = listen<Progress>("stats-progress", ({ payload }) =>
    handler(payload),
  );
  return () => void unlisten.then((stop) => stop());
}

export function onJobsChanged(handler: () => void) {
  const unlisten = listen("jobs-changed", () => handler());
  return () => void unlisten.then((stop) => stop());
}

export function onAgentEvent(handler: (payload: AgentEventPayload) => void) {
  const unlisten = listen<AgentEventPayload>("agent-event", ({ payload }) =>
    handler(payload),
  );
  return () => void unlisten.then((stop) => stop());
}

export type UsageLimit = {
  kind: string;
  label: string;
  percent: number;
  resets_at: number | null;
  severity: string;
  active: boolean;
};
export type Account = {
  id: string;
  label: string;
  email: string | null;
  plan: string | null;
  config_dir: string | null;
  is_default: boolean;
  limits: UsageLimit[];
  updated_at: number | null;
  error: string | null;
  refreshing: boolean;
};
export const listAccounts = () => invoke<Account[]>("list_accounts");
export const refreshAccounts = () => invoke("refresh_accounts");
export const addAccount = (config_dir: string) => invoke<Account>("add_account", { config_dir });
export const removeAccount = (id: string) => invoke("remove_account", { id });
export const renameAccount = (id: string, label: string) => invoke("rename_account", { id, label });
export const setDefaultAccount = (id: string) => invoke("set_default_account", { id });
export const projectAccounts = () => invoke<Record<string, string>>("project_accounts");
export const setProjectAccount = (project_path: string, account_id: string | null) =>
  invoke("set_project_account", { project_path, account_id });

export function onAccounts(handler: (accounts: Account[]) => void) {
  const unlisten = listen<Account[]>("accounts", ({ payload }) => handler(payload));
  return () => void unlisten.then((stop) => stop());
}
