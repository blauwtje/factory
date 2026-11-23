use std::collections::{HashMap, HashSet};
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize, Serializer};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_opener::OpenerExt;
use uuid::Uuid;

use crate::accounts::{self, config_dir_of, Account, DEFAULT_ID};
use crate::agent::{self, system_env, Agent, AgentSpec, ClaudeInfo};
use crate::audit::{self, AuditEntry};
use crate::bus::{Bus, BusConfig, Openings, LEAD_KIND};
use crate::customize::{self, Customize, Measurement};
use crate::customize_edit::{self, Draft, Roots, SaveRequest};
use crate::github;
use crate::kit::{self, Kind, KindRow, Kit, KitRole, Role, Skill};
use crate::permission::Decision;
use crate::protocol::{parse_transcript_line, Outcome, StreamEvent, Turn, Window};
use crate::store::{self, AccountRow, Job, JobStatus, Project, RecentProject, Store, StoredMeasurement};
use crate::transcripts::{Index, Progress, SearchHit, Stats, Tokens};
use crate::worktree::{self, CommitRow, FileChange, MergeForecast, MergeOutcome, Worktree};

const DEFAULT_MODEL: &str = "claude-opus-5-5";
const DEFAULT_EFFORT: &str = "high";
const LEAD_NAME: &str = "lead";
const SLUG_CHARS: usize = 40;
const SLUG_SUFFIX_CHARS: usize = 6;
const CONTEXT_TIMEOUT: Duration = Duration::from_secs(60);
const USAGE_INTERVAL: Duration = Duration::from_secs(300);

#[derive(Debug)]
pub struct CoreError(String);

impl fmt::Display for CoreError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl Serialize for CoreError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_str(self)
    }
}

impl<E: std::error::Error> From<E> for CoreError {
    fn from(error: E) -> Self {
        CoreError(error.to_string())
    }
}

fn invalid<T>(message: impl Into<String>) -> Result<T, CoreError> {
    Err(CoreError(message.into()))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum JobMode {
    #[default]
    Auto,
    Solo,
    Team,
}

impl JobMode {
    fn as_str(self) -> &'static str {
        match self {
            JobMode::Auto => "auto",
            JobMode::Solo => "solo",
            JobMode::Team => "team",
        }
    }

    fn lead_role(self) -> &'static str {
        match self {
            JobMode::Solo => "solo-agent",
            JobMode::Auto | JobMode::Team => "orchestrator",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Scope {
    Branch,
    Uncommitted,
    Commit { sha: String },
}

#[derive(Debug, Clone, Serialize)]
pub struct Overlap {
    pub job_id: String,
    pub title: String,
    pub files: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NewJob {
    pub project_path: PathBuf,
    pub prompt: String,
    #[serde(default)]
    pub account_id: Option<String>,
    #[serde(default)]
    pub mode: JobMode,
    pub model: Option<String>,
    pub effort: Option<String>,
    #[serde(default)]
    pub permission_mode: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CreatedJob {
    pub id: String,
    pub initialized: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct JobRow {
    #[serde(flatten)]
    pub job: Job,
    pub project_path: PathBuf,
    pub project_name: String,
    pub active: bool,
    pub failed: bool,
    pub cleaned_up: bool,
    pub account_id: String,
    pub last_active_at: i64,
    pub worktree: Option<PathBuf>,
    pub needs_reply: bool,
    pub context_tokens: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ResumeCommand {
    pub command: String,
    pub running: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentEventPayload {
    pub job_id: String,
    pub agent_id: String,
    pub event: StreamEvent,
}

#[derive(Debug, Clone)]
pub enum Notice {
    AgentEvent(AgentEventPayload),
    Accounts(Vec<Account>),
    Tokens(String),
    StatsProgress(Progress),
}

#[derive(Debug, Clone, Serialize)]
pub struct ClaudeStats {
    #[serde(flatten)]
    pub stats: Stats,
    pub progress: Progress,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentTokens {
    pub agent_id: String,
    pub tokens: Tokens,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionTokens {
    pub total: Tokens,
    pub agents: Vec<AgentTokens>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Attachment {
    pub path: PathBuf,
    pub name: String,
}

pub type Emit = Arc<dyn Fn(Notice) + Send + Sync>;

#[derive(Debug, Clone)]
pub struct Paths {
    pub data: PathBuf,
    pub local: PathBuf,
    pub kit: PathBuf,
}

struct Lead {
    id: String,
    agent: Agent,
}

struct Running {
    bus: Bus,
    lead: Arc<Mutex<Lead>>,
}

pub struct Core {
    paths: Paths,
    emit: Emit,
    claude_dir: PathBuf,
    profiles: PathBuf,
    transcripts: PathBuf,
    progress: Mutex<Progress>,
    refreshing: AtomicBool,
    claude_info: Mutex<Option<ClaudeInfo>>,
    kit: Kit,
    store: Mutex<Store>,
    probing: Mutex<HashSet<String>>,
    round: Mutex<()>,
    activity: Mutex<HashMap<String, i64>>,
    running: Mutex<HashMap<String, Arc<Running>>>,
    openings: Openings,
    baselines: Mutex<HashMap<String, u64>>,
}

fn measurement_key(project: Option<&Path>) -> String {
    project.map_or_else(String::new, |path| path.to_string_lossy().into())
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs() as i64)
}

const TITLE_CHARS: usize = 60;
const JOB_KIND: &str = "auto";

pub fn title_from(prompt: &str) -> String {
    let line = prompt
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or_default();
    if line.chars().count() <= TITLE_CHARS {
        return line.into();
    }
    let head: String = line.chars().take(TITLE_CHARS).collect();
    let ends_on_word = line
        .chars()
        .nth(TITLE_CHARS)
        .is_some_and(char::is_whitespace);
    match head.rfind(char::is_whitespace) {
        Some(cut) if !ends_on_word => head[..cut].trim_end().into(),
        _ => head.trim_end().into(),
    }
}

fn slug(title: &str, id: &str) -> String {
    let words: Vec<String> = title
        .to_lowercase()
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(String::from)
        .collect();
    let base: String = words.join("-").chars().take(SLUG_CHARS).collect();
    let base = base.trim_end_matches('-');
    let base = if base.is_empty() { "job" } else { base };
    format!("{base}-{}", &id[..SLUG_SUFFIX_CHARS])
}

fn project_name(path: &std::path::Path) -> String {
    path.file_name()
        .map_or_else(|| "project".into(), |name| name.to_string_lossy().into())
}

fn cleaned_up(job: &Job, agents: &[store::Agent]) -> bool {
    job.status == JobStatus::Merged && agents.iter().all(|agent| !agent.worktree.exists())
}

fn restricted(model: &str, effort: &str) -> bool {
    model.contains("fable") || effort == "max"
}

fn decode_base64(text: &str) -> Result<Vec<u8>, CoreError> {
    let sextet = |byte: u8| match byte {
        b'A'..=b'Z' => Some(byte - b'A'),
        b'a'..=b'z' => Some(byte - b'a' + 26),
        b'0'..=b'9' => Some(byte - b'0' + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    };
    let mut bytes = Vec::with_capacity(text.len() / 4 * 3);
    let (mut buffer, mut bits) = (0u32, 0);
    for byte in text.trim_end_matches('=').bytes() {
        let Some(value) = sextet(byte) else {
            return invalid(format!("attachment data has a non-base64 byte {byte:#04x}"));
        };
        buffer = (buffer << 6 | u32::from(value)) & 0xffff;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            bytes.push((buffer >> bits) as u8);
        }
    }
    Ok(bytes)
}

fn find_transcript(root: &Path, session_id: &str) -> Option<PathBuf> {
    let file = format!("{session_id}.jsonl");
    fs::read_dir(root)
        .ok()?
        .flatten()
        .map(|project| project.path().join(&file))
        .find(|path| path.is_file())
}

fn home_claude_dir() -> PathBuf {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"));
    PathBuf::from(home.unwrap_or_default()).join(".claude")
}

impl Core {
    pub fn open(paths: Paths, emit: Emit) -> Result<Arc<Core>, CoreError> {
        Core::open_with_dirs(paths, emit, home_claude_dir())
    }

    pub fn open_with_dirs(
        paths: Paths,
        emit: Emit,
        claude_dir: PathBuf,
    ) -> Result<Arc<Core>, CoreError> {
        let transcripts = claude_dir.join("projects");
        Core::open_in(paths, emit, claude_dir, transcripts)
    }

    pub fn open_with_transcripts(
        paths: Paths,
        emit: Emit,
        transcripts: PathBuf,
    ) -> Result<Arc<Core>, CoreError> {
        Core::open_in(paths, emit, home_claude_dir(), transcripts)
    }

    fn open_in(
        paths: Paths,
        emit: Emit,
        claude_dir: PathBuf,
        transcripts: PathBuf,
    ) -> Result<Arc<Core>, CoreError> {
        fs::create_dir_all(paths.data.join("attachments"))?;
        let kit = Kit::open(paths.kit.clone(), &paths.data)?;
        let store = Store::open(&paths.data.join("factory.db"))?;
        let profiles = claude_dir.parent().map_or_else(PathBuf::new, |home| {
            home.join("Library").join("Application Support").join("orca").join("claude-profiles")
        });
        Ok(Arc::new(Core {
            paths,
            emit,
            claude_dir,
            profiles,
            transcripts,
            progress: Mutex::new(Progress {
                files_done: 0,
                files_total: 0,
            }),
            refreshing: AtomicBool::new(false),
            claude_info: Mutex::new(None),
            kit,
            store: Mutex::new(store),
            probing: Mutex::default(),
            round: Mutex::default(),
            activity: Mutex::default(),
            running: Mutex::default(),
            openings: Openings::default(),
            baselines: Mutex::default(),
        }))
    }

    fn store(&self) -> std::sync::MutexGuard<'_, Store> {
        self.store.lock().unwrap()
    }

    fn mark(&self, agent_id: &str, status: &str) {
        if let Err(error) = self.store().set_agent_status(agent_id, status) {
            eprintln!("mark agent {agent_id} {status}: {error}");
        }
    }

    fn jobs(&self) -> Result<Vec<(Project, Job)>, CoreError> {
        let store = self.store();
        let mut rows = Vec::new();
        for project in store.projects()? {
            for job in store.jobs(&project.id)? {
                rows.push((project.clone(), job));
            }
        }
        Ok(rows)
    }

    fn job(&self, job_id: &str) -> Result<(Project, Job), CoreError> {
        match self.jobs()?.into_iter().find(|(_, job)| job.id == job_id) {
            Some(found) => Ok(found),
            None => invalid(format!("no job {job_id:?}")),
        }
    }

    fn agent(&self, agent_id: &str) -> Result<(Job, store::Agent), CoreError> {
        for (_, job) in self.jobs()? {
            let agents = self.store().agents(&job.id)?;
            if let Some(agent) = agents.into_iter().find(|agent| agent.id == agent_id) {
                return Ok((job, agent));
            }
        }
        invalid(format!("no agent {agent_id:?}"))
    }

    fn running(&self, job_id: &str) -> Result<Arc<Running>, CoreError> {
        match self.running.lock().unwrap().get(job_id) {
            Some(running) => Ok(Arc::clone(running)),
            None => invalid(format!("job {job_id:?} is not running")),
        }
    }

    pub fn list_jobs(&self) -> Result<Vec<JobRow>, CoreError> {
        let accounts = self.job_accounts()?;
        let jobs = self.jobs()?;
        let mut sessions: HashMap<PathBuf, Vec<String>> = HashMap::new();
        let mut rows = Vec::new();
        for (project, job) in jobs {
            let agents = self.store().agents(&job.id)?;
            let account_id = accounts.get(&job.id).cloned().unwrap_or_else(|| DEFAULT_ID.into());
            let root = self.transcripts_of(&account_id);
            sessions
                .entry(root)
                .or_default()
                .extend(agents.iter().map(|agent| agent.session_id.clone()));
            rows.push((project, job, agents, account_id));
        }
        let index = self.index()?;
        for (root, ids) in &sessions {
            if let Err(error) = index.refresh_sessions(root, ids) {
                eprintln!("index {}: {error}", root.display());
            }
        }
        rows.into_iter()
            .map(|(project, job, agents, account_id)| {
                let lead = agents.iter().rfind(|agent| agent.kind == LEAD_KIND);
                let context = agents
                    .iter()
                    .map(|agent| index.context_tokens(&agent.session_id))
                    .sum::<Result<i64, _>>()?;
                Ok(JobRow {
                    active: agents.iter().any(|agent| agent.status == "running"),
                    failed: lead.is_some_and(|lead| lead.status == "failed"),
                    cleaned_up: cleaned_up(&job, &agents),
                    last_active_at: self.last_active_at(&job, &agents, &account_id),
                    worktree: lead
                        .map(|lead| lead.worktree.clone())
                        .filter(|path| path.exists()),
                    needs_reply: self.needs_reply(&job, &agents),
                    context_tokens: (context > 0).then_some(context),
                    account_id,
                    job,
                    project_name: project.name,
                    project_path: project.path,
                })
            })
            .collect()
    }

    fn last_active_at(&self, job: &Job, agents: &[store::Agent], account_id: &str) -> i64 {
        if let Some(seen) = self.activity.lock().unwrap().get(&job.id) {
            return *seen;
        }
        let root = self.transcripts_of(account_id);
        agents
            .iter()
            .filter_map(|agent| find_transcript(&root, &agent.session_id))
            .filter_map(|path| fs::metadata(path).and_then(|meta| meta.modified()).ok())
            .filter_map(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|elapsed| elapsed.as_secs() as i64)
            .max()
            .unwrap_or(job.created_at)
    }

    fn needs_reply(&self, job: &Job, agents: &[store::Agent]) -> bool {
        if job.archived {
            return false;
        }
        if job.status == JobStatus::AwaitingApproval || self.has_open_requests(&job.id, agents) {
            return true;
        }
        let Some(lead) = agents.iter().rfind(|agent| agent.kind == LEAD_KIND) else {
            return false;
        };
        if lead.status == "running" {
            return false;
        }
        let building = matches!(job.status, JobStatus::Planning | JobStatus::Building);
        let idle = agents.iter().all(|agent| agent.status != "running");
        (building && lead.status == "waiting" && idle) || self.ends_on_question(&job.id, lead)
    }

    fn ends_on_question(&self, job_id: &str, lead: &store::Agent) -> bool {
        let turns = self.transcript(job_id, &lead.session_id).unwrap_or_default();
        for turn in turns.iter().rev() {
            match turn {
                Turn::User { .. } => return false,
                Turn::Event(StreamEvent::Assistant { content }) => {
                    return content.trim_end().ends_with('?');
                }
                Turn::Event(_) => {}
            }
        }
        false
    }

    fn has_open_requests(&self, job_id: &str, agents: &[store::Agent]) -> bool {
        let Ok(running) = self.running(job_id) else {
            return false;
        };
        let lead_asks = running
            .lead
            .try_lock()
            .is_ok_and(|lead| !lead.agent.open_requests().is_empty());
        lead_asks
            || agents
                .iter()
                .filter(|agent| agent.kind != LEAD_KIND)
                .any(|agent| {
                    running
                        .bus
                        .open_requests(&agent.name)
                        .is_ok_and(|open| !open.is_empty())
                })
    }

    fn primary_id(&self, id: &str) -> Result<String, CoreError> {
        let primary = accounts::primaries(&self.store().accounts()?);
        Ok(primary.get(id).map_or(id, String::as_str).into())
    }

    fn job_accounts(&self) -> Result<HashMap<String, String>, CoreError> {
        let primary = accounts::primaries(&self.store().accounts()?);
        let mut jobs = self.store().job_accounts()?;
        for id in jobs.values_mut() {
            if let Some(found) = primary.get(id.as_str()) {
                id.clone_from(found);
            }
        }
        Ok(jobs)
    }

    fn job_account(&self, job_id: &str) -> String {
        let accounts = self.job_accounts().unwrap_or_default();
        accounts.get(job_id).cloned().unwrap_or_else(|| DEFAULT_ID.into())
    }

    fn transcripts_of(&self, account_id: &str) -> PathBuf {
        match config_dir_of(account_id) {
            Some(dir) => dir.join("projects"),
            None => self.transcripts.clone(),
        }
    }

    pub fn agent_history(&self, agent_id: &str) -> Result<Vec<Turn>, CoreError> {
        let (job, row) = self.agent(agent_id)?;
        let mut turns = self.transcript(&job.id, &row.session_id)?;
        if !turns.iter().any(|turn| matches!(turn, Turn::User { .. })) {
            if let Some(text) = self.openings.lock().unwrap().get(agent_id) {
                turns.insert(0, Turn::User { text: text.clone() });
            }
        }
        turns.extend(self.open_requests(&job.id, &row).into_iter().map(Turn::Event));
        Ok(turns)
    }

    fn open_requests(&self, job_id: &str, row: &store::Agent) -> Vec<StreamEvent> {
        let Ok(running) = self.running(job_id) else {
            return Vec::new();
        };
        if row.kind != LEAD_KIND {
            return running.bus.open_requests(&row.name).unwrap_or_default();
        }
        let lead = running.lead.lock().unwrap();
        if lead.id != row.id {
            return Vec::new();
        }
        lead.agent.open_requests()
    }

    fn transcript(&self, job_id: &str, session_id: &str) -> Result<Vec<Turn>, CoreError> {
        let root = self.transcripts_of(&self.job_account(job_id));
        let Some(path) = find_transcript(&root, session_id) else {
            return Ok(Vec::new());
        };
        Ok(std::fs::read_to_string(path)?
            .lines()
            .flat_map(parse_transcript_line)
            .collect())
    }

    fn control(
        &self,
        agent_id: &str,
        what: &str,
        lead: impl FnOnce(&mut Agent) -> Result<Receiver<Value>, agent::AgentError>,
        member: impl FnOnce(&Bus, &str) -> Result<Receiver<Value>, crate::bus::BusError>,
    ) -> Result<Value, CoreError> {
        let (job, row) = self.agent(agent_id)?;
        let running = self.running(&job.id)?;
        let response = if row.kind == LEAD_KIND {
            let mut current = running.lead.lock().unwrap();
            if current.id != agent_id {
                return invalid(format!("agent {agent_id:?} has been replaced"));
            }
            lead(&mut current.agent)?
        } else {
            member(&running.bus, &row.name)?
        };
        match response.recv_timeout(CONTEXT_TIMEOUT) {
            Ok(reply) => Ok(reply),
            Err(_) => invalid(format!("agent {agent_id:?} did not report its {what}")),
        }
    }

    pub fn context_usage(&self, agent_id: &str) -> Result<Value, CoreError> {
        let live = self.control(
            agent_id,
            "context",
            Agent::context_usage,
            Bus::context_usage,
        );
        if live.is_ok() {
            return live;
        }
        let (job, row) = self.agent(agent_id)?;
        let index = self.index()?;
        let root = self.transcripts_of(&self.job_account(&job.id));
        index.refresh_sessions(&root, std::slice::from_ref(&row.session_id))?;
        Ok(json!({
            "categories": [],
            "totalTokens": index.context_tokens(&row.session_id)?,
            "maxTokens": 0,
        }))
    }

    pub fn job_links(&self, job_id: &str) -> Result<github::Links, CoreError> {
        match self.jobs()?.into_iter().find(|(_, job)| job.id == job_id) {
            Some((project, job)) => Ok(github::links(&project.path, &job.branch)),
            None => invalid(format!("no session {job_id:?}")),
        }
    }

    pub fn worktree(&self, agent_id: &str) -> Result<PathBuf, CoreError> {
        Ok(self.agent(agent_id)?.1.worktree)
    }

    pub fn mcp_status(&self, agent_id: &str) -> Result<Value, CoreError> {
        let mut reply = self.control(agent_id, "MCP status", Agent::mcp_status, Bus::mcp_status)?;
        match reply.get_mut("mcpServers").map(Value::take) {
            Some(servers @ Value::Array(_)) => Ok(servers),
            _ => Ok(json!([])),
        }
    }

    pub fn mcp_reconnect(&self, agent_id: &str, server: &str) -> Result<(), CoreError> {
        self.control(
            agent_id,
            &format!("reconnect of {server:?}"),
            |agent| agent.mcp_reconnect(server),
            |bus, name| bus.mcp_reconnect(name, server),
        )
        .map(drop)
    }

    fn fingerprint(&self, agent_id: &str) -> Result<u64, CoreError> {
        let (_, row) = self.agent(agent_id)?;
        let worktree = Some(row.worktree.as_path());
        let customize = customize::list(&self.kit, &self.claude_dir, worktree, &[])?;
        Ok(customize::fingerprint(
            &self.claude_dir,
            worktree,
            &customize,
        ))
    }

    fn keep_baseline(&self, agent_id: &str) {
        if self.baselines.lock().unwrap().contains_key(agent_id) {
            return;
        }
        match self.fingerprint(agent_id) {
            Ok(fingerprint) => {
                self.baselines
                    .lock()
                    .unwrap()
                    .insert(agent_id.into(), fingerprint);
            }
            Err(error) => eprintln!("fingerprint agent {agent_id}: {error}"),
        }
    }

    pub fn settings_changed(&self, agent_id: &str) -> Result<bool, CoreError> {
        let Some(baseline) = self.baselines.lock().unwrap().get(agent_id).copied() else {
            return Ok(false);
        };
        Ok(baseline != self.fingerprint(agent_id)?)
    }

    pub fn list_projects(&self) -> Result<Vec<RecentProject>, CoreError> {
        Ok(self.store().recent_projects()?)
    }

    pub fn kit(&self) -> &Kit {
        &self.kit
    }

    pub fn customize_roots(&self) -> Result<Roots, CoreError> {
        Ok(Roots {
            claude_dir: self.claude_dir.clone(),
            projects: self
                .store()
                .projects()?
                .into_iter()
                .map(|project| project.path)
                .collect(),
            read_only: vec![
                self.claude_dir.join("plugins"),
                self.paths.kit.clone(),
                self.paths.data.clone(),
            ],
        })
    }

    fn attachments(&self) -> PathBuf {
        self.paths.data.join("attachments")
    }

    fn new_attachment(&self, name: &Path) -> Result<Attachment, CoreError> {
        let Some(file) = name.file_name() else {
            return invalid(format!("attachment {} has no file name", name.display()));
        };
        let dir = self.attachments().join(Uuid::new_v4().to_string());
        fs::create_dir_all(&dir)?;
        Ok(Attachment {
            path: dir.join(file),
            name: file.to_string_lossy().into(),
        })
    }

    pub fn save_attachment(&self, name: &str, base64: &str) -> Result<Attachment, CoreError> {
        let attachment = self.new_attachment(Path::new(name))?;
        fs::write(&attachment.path, decode_base64(base64)?)
            .map_err(|error| CoreError(format!("save attachment {name:?}: {error}")))?;
        Ok(attachment)
    }

    pub fn attach_path(&self, path: &Path) -> Result<Attachment, CoreError> {
        let attachment = self.new_attachment(path)?;
        fs::copy(path, &attachment.path)
            .map_err(|error| CoreError(format!("attach {}: {error}", path.display())))?;
        Ok(attachment)
    }

    pub fn claude_info(&self) -> Result<ClaudeInfo, CoreError> {
        let mut cached = self.claude_info.lock().unwrap();
        if let Some(info) = cached.as_ref() {
            return Ok(info.clone());
        }
        let info = agent::claude_info(&system_env())?;
        *cached = Some(info.clone());
        Ok(info)
    }

    pub fn permission_modes(&self) -> Result<Vec<String>, CoreError> {
        Ok(agent::permission_modes(&system_env())?)
    }

    pub fn claude_permission_mode(&self) -> String {
        let mode = fs::read_to_string(self.claude_dir.join("settings.json"))
            .ok()
            .and_then(|text| serde_json::from_str::<Value>(&text).ok())
            .and_then(|settings| settings["permissions"]["defaultMode"].as_str().map(String::from))
            .unwrap_or_default();
        if mode == "default" {
            "manual".into()
        } else {
            mode
        }
    }

    pub fn set_permission_mode(&self, agent_id: &str, mode: &str) -> Result<(), CoreError> {
        self.control(
            agent_id,
            "permission mode",
            |agent| agent.set_permission_mode(mode),
            |_, name| {
                Err(crate::bus::BusError::Invalid(format!(
                    "{name:?} is not the lead; only the lead has a permission mode"
                )))
            },
        )?;
        self.store().set_agent_permission_mode(agent_id, mode)?;
        Ok(())
    }

    fn index(&self) -> Result<Index, CoreError> {
        Ok(Index::open(&self.paths.data.join("factory.db"))?)
    }

    pub fn claude_stats_snapshot(&self, project: Option<&str>) -> Result<ClaudeStats, CoreError> {
        Ok(ClaudeStats {
            stats: self.index()?.stats(project)?,
            progress: *self.progress.lock().unwrap(),
        })
    }

    pub fn claude_stats(self: &Arc<Self>, project: Option<&str>) -> Result<ClaudeStats, CoreError> {
        let snapshot = self.claude_stats_snapshot(project)?;
        self.refresh_in_background();
        Ok(snapshot)
    }

    pub fn list_customize(
        self: &Arc<Self>,
        project: Option<&Path>,
    ) -> Result<Customize, CoreError> {
        let uses = self.index()?.uses(&customize::since(SystemTime::now()))?;
        self.refresh_in_background();
        let mut customize = customize::list(&self.kit, &self.claude_dir, project, &uses)?;
        let Some(stored) = self.store().measurement(&measurement_key(project))? else {
            return Ok(customize);
        };
        let fingerprint = customize::fingerprint(&self.claude_dir, project, &customize);
        Measurement::from_report(&stored.report).apply(&mut customize);
        customize.measured = stored.fingerprint == fingerprint.to_string();
        customize.measured_at = Some(stored.measured_at);
        Ok(customize)
    }

    pub fn measure_customize(
        self: &Arc<Self>,
        project: Option<&Path>,
    ) -> Result<Customize, CoreError> {
        let cwd = match project {
            Some(project) => project,
            None => self.claude_dir.parent().unwrap_or(&self.claude_dir),
        };
        let customize = customize::list(&self.kit, &self.claude_dir, project, &[])?;
        let fingerprint = customize::fingerprint(&self.claude_dir, project, &customize);
        let account = self.account_for(cwd, None)?;
        let mut agent = Agent::spawn(AgentSpec {
            role: "solo-agent".into(),
            name: "measure".into(),
            model: DEFAULT_MODEL.into(),
            effort: DEFAULT_EFFORT.into(),
            cwd: cwd.into(),
            session_id: uuid::Uuid::new_v4().to_string(),
            resume: false,
            plugin_dir: self.kit.dir().into(),
            add_dir: self.attachments(),
            mcp_config: None,
            permission_mode: String::new(),
            allowed_tools: Default::default(),
            config_dir: config_dir_of(&account),
        })?;
        let response = agent.context_usage()?;
        let report = response.recv_timeout(CONTEXT_TIMEOUT);
        agent.stop()?;
        let Ok(report) = report else {
            return invalid(format!("claude did not report the context in {cwd:?}"));
        };
        self.store().save_measurement(&StoredMeasurement {
            project: measurement_key(project),
            report,
            fingerprint: fingerprint.to_string(),
            measured_at: customize::timestamp(SystemTime::now()),
        })?;
        self.list_customize(project)
    }

    fn refresh_in_background(self: &Arc<Self>) {
        if !self.refreshing.swap(true, Ordering::SeqCst) {
            let core = Arc::clone(self);
            thread::spawn(move || {
                let report = |progress| {
                    *core.progress.lock().unwrap() = progress;
                    (core.emit)(Notice::StatsProgress(progress));
                };
                match core
                    .index()
                    .and_then(|index| Ok(index.refresh_with(&core.transcripts, report)?))
                {
                    Ok(progress) => report(progress),
                    Err(error) => eprintln!("index transcripts: {error}"),
                }
                core.refreshing.store(false, Ordering::SeqCst);
            });
        }
    }

    pub fn session_tokens(&self, job_id: &str) -> Result<SessionTokens, CoreError> {
        let index = self.index()?;
        let agents = self.list_agents(job_id)?;
        let sessions: Vec<String> = agents
            .iter()
            .map(|agent| agent.session_id.clone())
            .collect();
        index.refresh_sessions(&self.transcripts_of(&self.job_account(job_id)), &sessions)?;
        let per_agent = agents
            .into_iter()
            .map(|agent| {
                Ok(AgentTokens {
                    tokens: index.session(&[agent.session_id])?,
                    agent_id: agent.id,
                })
            })
            .collect::<Result<_, CoreError>>()?;
        Ok(SessionTokens {
            total: index.session(&sessions)?,
            agents: per_agent,
        })
    }

    pub fn search_sessions(&self, query: &str) -> Result<Vec<SearchHit>, CoreError> {
        let mut sessions: HashMap<PathBuf, Vec<String>> = HashMap::new();
        let accounts = self.job_accounts()?;
        for (_, job) in self.jobs()? {
            let account = accounts.get(&job.id).map_or(DEFAULT_ID, String::as_str);
            let ids = sessions.entry(self.transcripts_of(account)).or_default();
            for agent in self.store().agents(&job.id)? {
                ids.push(agent.session_id);
            }
        }
        let index = self.index()?;
        for (root, ids) in &sessions {
            index.refresh_sessions(root, ids)?;
        }
        Ok(index.search(query)?)
    }

    pub fn list_agents(&self, job_id: &str) -> Result<Vec<store::Agent>, CoreError> {
        Ok(self.store().agents(job_id)?)
    }

    pub fn create_job(self: &Arc<Self>, new: NewJob) -> Result<CreatedJob, CoreError> {
        if new.prompt.trim().is_empty() {
            return invalid("a session needs a prompt");
        }
        let title = title_from(&new.prompt);
        let initialized = worktree::ensure_repo(&new.project_path)?;
        let project = self.project(&new.project_path)?;
        let account = self.account_for(&new.project_path, new.account_id.as_deref())?;
        let id = Uuid::new_v4().to_string();
        let slug = slug(&title, &id);
        let worktree = worktree::job_worktree(&self.paths.local, &project.path, &slug)?;
        let job = Job {
            id: id.clone(),
            project_id: project.id,
            title,
            kind: JOB_KIND.into(),
            mode: new.mode.as_str().into(),
            branch: worktree.branch.clone(),
            status: JobStatus::Planning,
            created_at: now(),
            archived: false,
            pinned: false,
        };
        self.store().add_job(&job)?;
        self.store().set_job_account(&id, &account)?;
        let lead = store::Agent {
            id: Uuid::new_v4().to_string(),
            job_id: id.clone(),
            role: new.mode.lead_role().into(),
            name: LEAD_NAME.into(),
            kind: LEAD_KIND.into(),
            model: new.model.unwrap_or_else(|| DEFAULT_MODEL.into()),
            effort: new.effort.unwrap_or_else(|| DEFAULT_EFFORT.into()),
            why: "Chosen when the session was created".into(),
            attempt: 1,
            cli_version: String::new(),
            session_id: Uuid::new_v4().to_string(),
            worktree: worktree.path.clone(),
            status: "running".into(),
            permission_mode: new.permission_mode.unwrap_or_default(),
        };
        let lead_id = lead.id.clone();
        let started = self.start(&job, worktree, lead, false);
        let running = started.inspect_err(|_| self.fail(&job.id))?;
        running.lead.lock().unwrap().agent.send(&new.prompt)?;
        self.openings.lock().unwrap().insert(lead_id, new.prompt);
        Ok(CreatedJob { id, initialized })
    }

    fn project(&self, path: &std::path::Path) -> Result<Project, CoreError> {
        let store = self.store();
        if let Some(known) = store.projects()?.into_iter().find(|p| p.path == path) {
            store.touch_project(&known.id, now())?;
            return Ok(known);
        }
        let project = Project {
            id: Uuid::new_v4().to_string(),
            path: path.into(),
            name: project_name(path),
        };
        store.add_project(&project)?;
        store.touch_project(&project.id, now())?;
        Ok(project)
    }

    fn fail(&self, job_id: &str) {
        if let Err(error) = self.store().set_job_status(job_id, JobStatus::Failed) {
            eprintln!("mark job {job_id} failed: {error}");
        }
    }

    fn start(
        self: &Arc<Self>,
        job: &Job,
        worktree: Worktree,
        mut lead: store::Agent,
        resume: bool,
    ) -> Result<Arc<Running>, CoreError> {
        let (lead_tx, lead_rx) = mpsc::channel();
        let (tap, team_events) = mpsc::channel();
        let config_dir = config_dir_of(&self.job_account(&job.id));
        let bus = Bus::start(
            BusConfig {
                store: Store::open(&self.paths.data.join("factory.db"))?,
                job: job.clone(),
                job_worktree: worktree,
                worktrees_root: self.paths.local.clone(),
                job_dir: self.paths.data.join("jobs").join(&job.id),
                plugin_dir: self.kit.dir().into(),
                add_dir: self.attachments(),
                allow_restricted: restricted(&lead.model, &lead.effort),
                config_dir: config_dir.clone(),
                tap,
                openings: Arc::clone(&self.openings),
            },
            lead_tx,
        )?;
        let (agent, events) = self.spawn_lead(&lead, resume, &bus, config_dir)?;
        if !resume {
            lead.cli_version = agent.cli_version.clone();
            self.store().add_agent(&lead)?;
        }
        let lead_id = lead.id;
        let lead = Arc::new(Mutex::new(Lead {
            id: lead_id.clone(),
            agent,
        }));
        self.pump(&job.id, lead_id, Arc::clone(&lead), events);
        self.forward(Arc::clone(&lead), lead_rx);
        self.pump_team(&job.id, Arc::clone(&lead), team_events);
        let running = Arc::new(Running { bus, lead });
        self.running
            .lock()
            .unwrap()
            .insert(job.id.clone(), Arc::clone(&running));
        Ok(running)
    }

    fn spawn_lead(
        &self,
        row: &store::Agent,
        resume: bool,
        bus: &Bus,
        config_dir: Option<PathBuf>,
    ) -> Result<(Agent, Receiver<StreamEvent>), CoreError> {
        let mut agent = Agent::spawn(AgentSpec {
            role: row.role.clone(),
            name: row.name.clone(),
            model: row.model.clone(),
            effort: row.effort.clone(),
            cwd: row.worktree.clone(),
            session_id: row.session_id.clone(),
            resume,
            plugin_dir: self.kit.dir().into(),
            add_dir: self.attachments(),
            mcp_config: Some(bus.mcp_config().into()),
            permission_mode: row.permission_mode.clone(),
            allowed_tools: bus.allowed_tools(),
            config_dir,
        })?;
        let events = agent.events().expect("a new agent has its events");
        Ok((agent, events))
    }

    fn forward(self: &Arc<Self>, lead: Arc<Mutex<Lead>>, messages: Receiver<String>) {
        let core = Arc::clone(self);
        thread::spawn(move || {
            for text in messages {
                let mut lead = lead.lock().unwrap();
                match lead.agent.send(&text) {
                    Ok(()) => core.mark(&lead.id, "running"),
                    Err(_) => core.mark(&lead.id, "failed"),
                }
            }
        });
    }

    fn pump(
        self: &Arc<Self>,
        job_id: &str,
        agent_id: String,
        lead: Arc<Mutex<Lead>>,
        events: Receiver<StreamEvent>,
    ) {
        let core = Arc::clone(self);
        let job_id = job_id.to_string();
        thread::spawn(move || {
            for event in events {
                core.on_event(&job_id, &agent_id, &lead, event);
            }
        });
    }

    fn pump_team(
        self: &Arc<Self>,
        job_id: &str,
        lead: Arc<Mutex<Lead>>,
        events: Receiver<(String, StreamEvent)>,
    ) {
        let core = Arc::clone(self);
        let job_id = job_id.to_string();
        thread::spawn(move || {
            for (name, event) in events {
                let agents = core.list_agents(&job_id).unwrap_or_default();
                if let Some(agent) = agents.iter().find(|agent| agent.name == name) {
                    core.on_event(&job_id, &agent.id, &lead, event);
                }
            }
        });
    }

    fn on_event(&self, job_id: &str, agent_id: &str, lead: &Mutex<Lead>, event: StreamEvent) {
        self.activity.lock().unwrap().insert(job_id.into(), now());
        match &event {
            StreamEvent::RateLimit { windows } => self.apply_rate_limits(job_id, windows),
            StreamEvent::Init { .. } => self.keep_baseline(agent_id),
            StreamEvent::Result {
                outcome, queued, ..
            } if lead.lock().unwrap().id == agent_id => {
                if !queued {
                    self.lead_finished(job_id, agent_id, *outcome);
                }
            }
            _ => {}
        }
        let finished = matches!(event, StreamEvent::Result { .. });
        (self.emit)(Notice::AgentEvent(AgentEventPayload {
            job_id: job_id.into(),
            agent_id: agent_id.into(),
            event,
        }));
        if finished {
            (self.emit)(Notice::Tokens(job_id.into()));
        }
    }

    fn reply(
        &self,
        agent_id: &str,
        request_id: &str,
        decision: &Decision,
    ) -> Result<(), CoreError> {
        let (job, row) = self.agent(agent_id)?;
        let running = self.running(&job.id)?;
        let pending = if row.kind != LEAD_KIND {
            running
                .bus
                .answer_permission(&row.name, request_id, decision)?
        } else {
            let mut lead = running.lead.lock().unwrap();
            if lead.id != agent_id {
                return invalid(format!("agent {agent_id:?} has been replaced"));
            }
            lead.agent.answer_permission(request_id, decision)?
        };
        let entry = AuditEntry::new(
            &job.id,
            agent_id,
            &pending.tool_name,
            pending.input,
            decision,
            now(),
        );
        let _ = audit::append(&self.audit_path(&job.project_id), &entry);
        Ok(())
    }

    fn audit_path(&self, project_id: &str) -> PathBuf {
        self.paths
            .data
            .join("audit")
            .join(format!("{project_id}.jsonl"))
    }

    pub fn permission_log(
        &self,
        project_path: Option<&Path>,
    ) -> Result<Vec<AuditEntry>, CoreError> {
        let mut entries = Vec::new();
        for project in self.store().projects()? {
            if project_path.is_some_and(|path| project.path != path) {
                continue;
            }
            entries.extend(
                audit::read(&self.audit_path(&project.id))?
                    .into_iter()
                    .rev(),
            );
        }
        entries.sort_by_key(|entry| std::cmp::Reverse(entry.time));
        Ok(entries)
    }

    fn lead_finished(&self, job_id: &str, agent_id: &str, outcome: Outcome) {
        let failed = outcome == Outcome::Failed;
        self.mark(agent_id, if failed { "failed" } else { "waiting" });
        let Ok((_, job)) = self.job(job_id) else {
            return;
        };
        if job.status != JobStatus::Building || outcome == Outcome::Stopped {
            return;
        }
        let next = match self.list_agents(job_id) {
            Ok(_) if failed => JobStatus::Failed,
            Ok(agents) if agents.iter().any(|agent| agent.status == "running") => return,
            Ok(_) => JobStatus::Done,
            Err(_) => return,
        };
        if let Err(error) = self.store().set_job_status(job_id, next) {
            eprintln!("set job {job_id} status: {error}");
        }
    }

    pub fn approve_plan(self: &Arc<Self>, job_id: &str) -> Result<(), CoreError> {
        let (_, job) = self.job(job_id)?;
        if job.status != JobStatus::AwaitingApproval {
            return invalid(format!("job {job_id:?} is not awaiting approval"));
        }
        let running = self.running(job_id)?;
        let Some(plan) = running.bus.plan() else {
            return invalid(
                "the plan was lost when the app restarted; ask the lead to call plan_ready again",
            );
        };
        let mut lead = running.lead.lock().unwrap();
        let (_, row) = self.agent(&lead.id)?;
        self.store().set_job_status(job_id, JobStatus::Building)?;
        if row.model != plan.build_model || row.effort != plan.build_effort {
            lead.agent
                .set_model(&plan.build_model, &plan.build_effort)?;
            self.baselines.lock().unwrap().remove(&row.id);
        }
        self.store().set_agent_model(
            &row.id,
            &plan.build_model,
            &plan.build_effort,
            &plan.why,
        )?;
        self.mark(&row.id, "running");
        lead.agent.send(&format!("{}\n[plan approved]", plan.path))?;
        Ok(())
    }

    pub fn set_agent_model(
        &self,
        agent_id: &str,
        model: &str,
        effort: &str,
    ) -> Result<(), CoreError> {
        let (job, row) = self.agent(agent_id)?;
        let running = self.running(&job.id)?;
        if row.kind == LEAD_KIND {
            running
                .lead
                .lock()
                .unwrap()
                .agent
                .set_model(model, effort)?;
            self.store()
                .set_agent_model(agent_id, model, effort, &row.why)?;
        } else {
            running.bus.user_set_model(&row.name, model, effort)?;
        }
        self.baselines.lock().unwrap().remove(agent_id);
        Ok(())
    }

    pub fn send_message(&self, agent_id: &str, text: &str) -> Result<(), CoreError> {
        let (job, row) = self.agent(agent_id)?;
        let running = self.running(&job.id)?;
        if row.kind != LEAD_KIND {
            return Ok(running.bus.user_message(&row.name, text)?);
        }
        let mut lead = running.lead.lock().unwrap();
        if lead.id != agent_id {
            return invalid(format!("agent {agent_id:?} has been replaced"));
        }
        lead.agent.send(text)?;
        self.mark(agent_id, "running");
        Ok(())
    }

    pub fn answer_permission(
        &self,
        agent_id: &str,
        request_id: &str,
        decision: &Decision,
    ) -> Result<(), CoreError> {
        self.reply(agent_id, request_id, decision)
    }

    pub fn idle(&self) -> bool {
        let running: Vec<_> = self.running.lock().unwrap().values().cloned().collect();
        running
            .iter()
            .all(|running| running.lead.lock().unwrap().agent.idle() && running.bus.idle())
    }

    pub fn interrupt_agent(&self, agent_id: &str) -> Result<(), CoreError> {
        let (job, row) = self.agent(agent_id)?;
        let running = self.running(&job.id)?;
        if row.kind != LEAD_KIND {
            return Ok(running.bus.interrupt(&row.name)?);
        }
        let mut lead = running.lead.lock().unwrap();
        if lead.id != agent_id {
            return invalid(format!("agent {agent_id:?} has been replaced"));
        }
        Ok(lead.agent.interrupt()?)
    }

    pub fn merge_job(&self, job_id: &str) -> Result<MergeOutcome, CoreError> {
        let (project, job) = self.job(job_id)?;
        if job.status != JobStatus::Done {
            return invalid(format!("job {job_id:?} is not done"));
        }
        let slug = job.branch.trim_start_matches("factory/");
        let outcome = worktree::merge_job(&project.path, slug)?;
        if let MergeOutcome::Merged { .. } = outcome {
            self.store().set_job_status(job_id, JobStatus::Merged)?;
            let running = self.running.lock().unwrap().remove(job_id);
            if let Some(running) = running {
                running.lead.lock().unwrap().agent.stop()?;
            }
        }
        Ok(outcome)
    }

    pub fn merge_forecast(&self, job_id: &str) -> Result<MergeForecast, CoreError> {
        let (project, job) = self.job(job_id)?;
        if job.status != JobStatus::Done {
            return invalid(format!("job {job_id:?} is not done"));
        }
        let slug = job.branch.trim_start_matches("factory/");
        Ok(worktree::forecast_job(&project.path, slug)?)
    }

    pub fn resolve_conflicts(&self, job_id: &str) -> Result<(), CoreError> {
        let MergeForecast::Conflict { files } = self.merge_forecast(job_id)? else {
            return invalid(format!("job {job_id:?} merges cleanly"));
        };
        let (project, _) = self.job(job_id)?;
        let Some(base) = worktree::current_branch(&project.path)? else {
            return invalid("the project checkout has a detached HEAD; check out a branch first");
        };
        let agents = self.store().agents(job_id)?;
        let Some(lead) = agents.iter().rfind(|agent| agent.kind == LEAD_KIND) else {
            return invalid(format!("job {job_id:?} has no lead"));
        };
        let text = format!(
            "Merging this branch into {base} would conflict in: {}. Run `git merge {base}` in your worktree, resolve every conflict, run the project's checks and commit the merge. Change nothing else.",
            files.join(", ")
        );
        self.send_message(&lead.id, &text)
    }

    pub fn job_changes(&self, job_id: &str, scope: &Scope) -> Result<Vec<FileChange>, CoreError> {
        let (project, job) = self.job(job_id)?;
        let agents = self.store().agents(job_id)?;
        if cleaned_up(&job, &agents) {
            return invalid(format!("job {job_id:?} is cleaned up"));
        }
        let slug = job.branch.trim_start_matches("factory/");
        match scope {
            Scope::Branch => Ok(worktree::branch_changes(&project.path, slug)?),
            Scope::Uncommitted => {
                let Some(lead) = agents.iter().rfind(|agent| agent.kind == LEAD_KIND) else {
                    return invalid(format!("job {job_id:?} has no lead"));
                };
                Ok(worktree::uncommitted_changes(&lead.worktree)?)
            }
            Scope::Commit { sha } => {
                let commits = worktree::branch_commits(&project.path, slug)?;
                if !commits.iter().any(|commit| &commit.sha == sha) {
                    return invalid(format!("commit {sha:?} is not on job {job_id:?}"));
                }
                Ok(worktree::commit_changes(&project.path, sha)?)
            }
        }
    }

    pub fn job_overlaps(&self, job_id: &str) -> Result<Vec<Overlap>, CoreError> {
        let (project, job) = self.job(job_id)?;
        let mut overlaps = Vec::new();
        for (_, other) in self.jobs()?.into_iter().filter(|(other_project, other)| {
            other_project.id == project.id
                && other.id != job.id
                && other.status != JobStatus::Merged
                && worktree::branch_exists(&project.path, &other.branch)
        }) {
            if let MergeForecast::Conflict { files } =
                worktree::forecast_pair(&project.path, &job.branch, &other.branch)?
            {
                overlaps.push(Overlap {
                    job_id: other.id,
                    title: other.title,
                    files,
                });
            }
        }
        Ok(overlaps)
    }

    pub fn job_commits(&self, job_id: &str) -> Result<Vec<CommitRow>, CoreError> {
        let (project, job) = self.job(job_id)?;
        let slug = job.branch.trim_start_matches("factory/");
        Ok(worktree::branch_commits(&project.path, slug)?)
    }

    pub fn clean_up_job(&self, job_id: &str) -> Result<(), CoreError> {
        let (project, job) = self.job(job_id)?;
        if job.status != JobStatus::Merged {
            return invalid(format!("job {job_id:?} is not merged"));
        }
        let worktrees = self.job_worktrees(&job)?;
        Ok(worktree::clean_up(&project.path, &worktrees)?)
    }

    fn job_worktrees(&self, job: &Job) -> Result<Vec<Worktree>, CoreError> {
        Ok(self
            .list_agents(&job.id)?
            .into_iter()
            .map(|agent| Worktree {
                branch: match agent.kind == LEAD_KIND {
                    true => job.branch.clone(),
                    false => worktree::agent_branch(&job.branch, &agent.name),
                },
                path: agent.worktree,
            })
            .collect())
    }

    pub fn archive_job(&self, job_id: &str, archived: bool) -> Result<(), CoreError> {
        self.job(job_id)?;
        Ok(self.store().set_job_archived(job_id, archived)?)
    }

    pub fn pin_job(&self, job_id: &str, pinned: bool) -> Result<(), CoreError> {
        self.job(job_id)?;
        Ok(self.store().set_job_pinned(job_id, pinned)?)
    }

    pub fn rename_job(&self, job_id: &str, title: &str) -> Result<(), CoreError> {
        self.job(job_id)?;
        let title = title_from(title);
        if title.is_empty() {
            return invalid("a session needs a title");
        }
        Ok(self.store().set_job_title(job_id, &title)?)
    }

    pub fn resume_command(&self, job_id: &str) -> Result<ResumeCommand, CoreError> {
        self.job(job_id)?;
        let agents = self.store().agents(job_id)?;
        let Some(lead) = agents.iter().rfind(|agent| agent.kind == LEAD_KIND) else {
            return invalid(format!("job {job_id:?} has no lead"));
        };
        if !lead.worktree.exists() {
            return invalid("the worktree of this session was cleaned up, so it cannot be resumed");
        }
        let path = lead.worktree.to_string_lossy().replace('\'', "'\\''");
        Ok(ResumeCommand {
            command: format!("cd '{path}' && claude --resume {}", lead.session_id),
            running: self.running(job_id).is_ok(),
        })
    }

    pub fn delete_job(&self, job_id: &str) -> Result<(), CoreError> {
        let (project, job) = self.job(job_id)?;
        let running = self.running.lock().unwrap().remove(job_id);
        if let Some(running) = running {
            running.lead.lock().unwrap().agent.stop()?;
        }
        let worktrees = self.job_worktrees(&job)?;
        worktree::delete(&project.path, &worktrees)?;
        self.store().delete_job(job_id)?;
        match fs::remove_dir_all(self.paths.data.join("jobs").join(job_id)) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error.into()),
            _ => Ok(()),
        }
    }

    pub fn resume(self: &Arc<Self>) -> Vec<CoreError> {
        let jobs = match self.jobs() {
            Ok(jobs) => jobs,
            Err(error) => return vec![error],
        };
        let open = |job: &Job| {
            matches!(
                job.status,
                JobStatus::Planning | JobStatus::AwaitingApproval | JobStatus::Building
            )
        };
        let mut errors = Vec::new();
        for (_, job) in jobs.into_iter().filter(|(_, job)| open(job)) {
            if let Err(error) = self.resume_job(&job) {
                self.fail(&job.id);
                errors.push(error);
            }
        }
        errors
    }

    fn resume_job(self: &Arc<Self>, job: &Job) -> Result<(), CoreError> {
        let agents = self.list_agents(&job.id)?;
        let lead = agents.into_iter().rfind(|agent| {
            agent.kind == LEAD_KIND && !matches!(agent.status.as_str(), "done" | "failed")
        });
        let Some(lead) = lead else {
            return Ok(());
        };
        let worktree = Worktree {
            path: lead.worktree.clone(),
            branch: job.branch.clone(),
        };
        self.start(job, worktree, lead, true)?;
        Ok(())
    }

    fn visible_accounts(&self) -> Result<Vec<AccountRow>, CoreError> {
        Ok(accounts::merged(&self.store().accounts()?))
    }

    fn default_account(rows: &[AccountRow]) -> String {
        rows.iter()
            .find(|row| row.is_default)
            .or_else(|| rows.iter().find(|row| row.id == DEFAULT_ID))
            .or(rows.first())
            .map_or_else(|| DEFAULT_ID.into(), |row| row.id.clone())
    }

    pub fn list_accounts(&self) -> Result<Vec<Account>, CoreError> {
        let rows = self.visible_accounts()?;
        let default = Core::default_account(&rows);
        let probing = self.probing.lock().unwrap();
        Ok(rows
            .into_iter()
            .map(|row| Account {
                is_default: row.id == default,
                refreshing: probing.contains(&row.id),
                id: row.id,
                label: row.label,
                email: row.email,
                plan: row.plan,
                config_dir: row.config_dir,
                limits: row.limits,
                updated_at: row.updated_at,
                error: row.error,
            })
            .collect())
    }

    fn announce_accounts(&self) {
        match self.list_accounts() {
            Ok(accounts) => (self.emit)(Notice::Accounts(accounts)),
            Err(error) => eprintln!("list accounts: {error}"),
        }
    }

    fn account_row(&self, id: &str) -> Result<AccountRow, CoreError> {
        match self.store().accounts()?.into_iter().find(|row| row.id == id) {
            Some(row) => Ok(row),
            None => invalid(format!("no account {id:?}")),
        }
    }

    fn change_account(
        &self,
        id: &str,
        change: impl FnOnce(&mut AccountRow),
    ) -> Result<(), CoreError> {
        let mut row = self.account_row(id)?;
        change(&mut row);
        self.store().save_account(&row)?;
        self.announce_accounts();
        Ok(())
    }

    pub fn add_account(self: &Arc<Self>, config_dir: &Path) -> Result<Account, CoreError> {
        let Some(login) = accounts::login(&system_env(), Some(config_dir.into())) else {
            return invalid(format!("no Claude login in {}", config_dir.display()));
        };
        let known = self.account_row(&login.id).ok();
        let label = known.as_ref().map_or_else(
            || login.email.clone().unwrap_or_else(|| project_name(config_dir)),
            |row| row.label.clone(),
        );
        self.store().save_account(&AccountRow {
            label,
            email: login.email,
            plan: login.plan,
            org_id: login.org_id,
            config_dir: Some(login.id.clone()),
            manual: true,
            hidden: false,
            ..known.unwrap_or_else(|| blank_account(&login.id))
        })?;
        self.probing.lock().unwrap().insert(login.id.clone());
        self.announce_accounts();
        let core = Arc::clone(self);
        let id = login.id.clone();
        thread::spawn(move || core.probe_account(&system_env(), &id));
        match self.list_accounts()?.into_iter().find(|account| account.id == login.id) {
            Some(account) => Ok(account),
            None => invalid(format!("no account {:?}", login.id)),
        }
    }

    pub fn remove_account(&self, id: &str) -> Result<(), CoreError> {
        let row = self.account_row(id)?;
        if row.manual {
            self.store().delete_account(id)?;
            self.announce_accounts();
            return Ok(());
        }
        self.change_account(id, |row| row.hidden = true)
    }

    pub fn rename_account(&self, id: &str, label: &str) -> Result<(), CoreError> {
        let label = label.trim();
        if label.is_empty() {
            return invalid("an account needs a label");
        }
        self.change_account(id, |row| row.label = label.into())
    }

    pub fn set_default_account(&self, id: &str) -> Result<(), CoreError> {
        self.account_row(id)?;
        self.store().set_default_account(id)?;
        self.announce_accounts();
        Ok(())
    }

    pub fn project_accounts(&self) -> Result<HashMap<String, String>, CoreError> {
        let mut rules = self.store().project_accounts()?;
        for id in rules.values_mut() {
            *id = self.primary_id(id)?;
        }
        Ok(rules)
    }

    pub fn set_project_account(
        &self,
        project_path: &Path,
        account_id: Option<&str>,
    ) -> Result<(), CoreError> {
        if let Some(id) = account_id {
            self.account_row(id)?;
        }
        Ok(self
            .store()
            .set_project_account(&project_path.to_string_lossy(), account_id)?)
    }

    fn account_for(&self, project_path: &Path, asked: Option<&str>) -> Result<String, CoreError> {
        let rows = self.visible_accounts()?;
        let known = |id: &str| rows.iter().any(|row| row.id == id);
        if let Some(id) = asked {
            let primary = self.primary_id(id)?;
            return match primary == DEFAULT_ID || known(&primary) {
                true => Ok(primary),
                false => invalid(format!("no account {id:?}")),
            };
        }
        let mut rules = self.store().project_accounts()?;
        for id in rules.values_mut() {
            *id = self.primary_id(id)?;
        }
        rules.retain(|_, id| known(id));
        let remembered = accounts::folder_account(&rules, project_path);
        Ok(remembered.map_or_else(|| Core::default_account(&rows), String::from))
    }

    pub fn refresh_accounts(self: &Arc<Self>) {
        if self.round.try_lock().is_err() {
            return;
        }
        let core = Arc::clone(self);
        thread::spawn(move || core.refresh_accounts_now());
    }

    pub fn watch_accounts(self: &Arc<Self>) {
        let core = Arc::clone(self);
        thread::spawn(move || loop {
            core.refresh_accounts_now();
            thread::sleep(USAGE_INTERVAL);
        });
    }

    pub fn refresh_accounts_now(&self) {
        let _round = self.round.lock().unwrap();
        let env = system_env();
        if let Err(error) = self.remember_logins(accounts::discover(&env, &self.profiles)) {
            eprintln!("discover accounts: {error}");
        }
        let ids = match self.store().accounts() {
            Ok(rows) => accounts::probe_ids(&rows),
            Err(error) => return eprintln!("list accounts: {error}"),
        };
        self.probing.lock().unwrap().extend(ids.iter().cloned());
        self.announce_accounts();
        thread::scope(|scope| {
            for id in &ids {
                let env = &env;
                scope.spawn(move || self.probe_account(env, id));
            }
        });
    }

    fn probe_account(&self, env: &agent::Env, id: &str) {
        let config_dir = config_dir_of(id);
        let ask = || {
            accounts::probe(env, config_dir.as_deref())
                .and_then(|reply| accounts::parse_usage(&reply))
        };
        let usage = ask().or_else(|_| {
            thread::sleep(accounts::PROBE_RETRY);
            ask()
        });
        self.record_usage(id, usage);
    }

    fn remember_logins(&self, logins: Vec<accounts::Login>) -> Result<(), CoreError> {
        let known = self.store().accounts()?;
        for login in logins {
            let row = match known.iter().find(|row| row.id == login.id) {
                Some(row) => AccountRow {
                    email: login.email.or_else(|| row.email.clone()),
                    plan: login.plan.or_else(|| row.plan.clone()),
                    org_id: login.org_id.or_else(|| row.org_id.clone()),
                    ..row.clone()
                },
                None => AccountRow {
                    label: login.email.clone().unwrap_or_else(|| match login.config_dir {
                        Some(ref dir) => project_name(dir),
                        None => "Default".into(),
                    }),
                    email: login.email,
                    plan: login.plan,
                    org_id: login.org_id,
                    config_dir: login.config_dir.map(|dir| dir.to_string_lossy().into()),
                    ..blank_account(&login.id)
                },
            };
            self.store().save_account(&row)?;
        }
        Ok(())
    }

    fn record_usage(&self, id: &str, usage: Result<accounts::Usage, String>) {
        self.probing.lock().unwrap().remove(id);
        let saved = self.account_row(id).and_then(|mut row| {
            match usage {
                Ok(usage) => {
                    row.plan = row.plan.or_else(|| accounts::plan_name(None, usage.plan.as_deref()));
                    row.limits = usage.limits;
                    row.updated_at = Some(now());
                    row.error = None;
                }
                Err(error) => row.error = Some(error),
            }
            Ok(self.store().save_account_usage(&row)?)
        });
        if let Err(error) = saved {
            eprintln!("record usage of account {id}: {error}");
        }
        self.announce_accounts();
    }

    fn apply_rate_limits(&self, job_id: &str, windows: &std::collections::BTreeMap<String, Window>) {
        let id = self.job_account(job_id);
        let updated = self.account_row(&id).map(|row| {
            let mut limits = row.limits.clone();
            accounts::apply_rate_limits(&mut limits, windows);
            (row, limits)
        });
        let Ok((row, limits)) = updated else {
            return;
        };
        let row = AccountRow {
            limits,
            updated_at: Some(now()),
            ..row
        };
        match self.store().save_account_usage(&row) {
            Ok(()) => self.announce_accounts(),
            Err(error) => eprintln!("record usage of account {id}: {error}"),
        }
    }
}

fn blank_account(id: &str) -> AccountRow {
    AccountRow {
        id: id.into(),
        label: String::new(),
        email: None,
        plan: None,
        org_id: None,
        config_dir: None,
        manual: false,
        hidden: false,
        is_default: false,
        limits: Vec::new(),
        updated_at: None,
        error: None,
    }
}

pub fn tauri_emit(app: AppHandle) -> Emit {
    Arc::new(move |notice| {
        let sent = match notice {
            Notice::AgentEvent(payload) => app.emit("agent-event", payload),
            Notice::Accounts(accounts) => app.emit("accounts", accounts),
            Notice::Tokens(job_id) => app.emit("tokens", json!({ "job_id": job_id })),
            Notice::StatsProgress(progress) => app.emit("stats-progress", progress),
        };
        if let Err(error) = sent {
            eprintln!("emit: {error}");
        }
    })
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn create_job(core: State<'_, Arc<Core>>, job: NewJob) -> Result<CreatedJob, CoreError> {
    core.inner().create_job(job)
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn approve_plan(core: State<'_, Arc<Core>>, job_id: String) -> Result<(), CoreError> {
    core.inner().approve_plan(&job_id)
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn set_agent_model(
    core: State<'_, Arc<Core>>,
    agent_id: String,
    model: String,
    effort: String,
) -> Result<(), CoreError> {
    core.set_agent_model(&agent_id, &model, &effort)
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn merge_job(core: State<'_, Arc<Core>>, job_id: String) -> Result<MergeOutcome, CoreError> {
    core.merge_job(&job_id)
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn merge_forecast(
    core: State<'_, Arc<Core>>,
    job_id: String,
) -> Result<MergeForecast, CoreError> {
    core.merge_forecast(&job_id)
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn resolve_conflicts(core: State<'_, Arc<Core>>, job_id: String) -> Result<(), CoreError> {
    core.resolve_conflicts(&job_id)
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn job_changes(
    core: State<'_, Arc<Core>>,
    job_id: String,
    scope: Scope,
) -> Result<Vec<FileChange>, CoreError> {
    core.job_changes(&job_id, &scope)
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn job_overlaps(
    core: State<'_, Arc<Core>>,
    job_id: String,
) -> Result<Vec<Overlap>, CoreError> {
    core.job_overlaps(&job_id)
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn job_commits(
    core: State<'_, Arc<Core>>,
    job_id: String,
) -> Result<Vec<CommitRow>, CoreError> {
    core.job_commits(&job_id)
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn clean_up_job(core: State<'_, Arc<Core>>, job_id: String) -> Result<(), CoreError> {
    core.clean_up_job(&job_id)
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn send_message(
    core: State<'_, Arc<Core>>,
    agent_id: String,
    text: String,
) -> Result<(), CoreError> {
    core.send_message(&agent_id, &text)
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn answer_permission(
    core: State<'_, Arc<Core>>,
    agent_id: String,
    request_id: String,
    decision: Decision,
) -> Result<(), CoreError> {
    core.answer_permission(&agent_id, &request_id, &decision)
}

#[tauri::command(async)]
pub fn agents_idle(core: State<'_, Arc<Core>>) -> bool {
    core.idle()
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn interrupt_agent(core: State<'_, Arc<Core>>, agent_id: String) -> Result<(), CoreError> {
    core.interrupt_agent(&agent_id)
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn list_jobs(core: State<'_, Arc<Core>>) -> Result<Vec<JobRow>, CoreError> {
    core.list_jobs()
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn list_projects(core: State<'_, Arc<Core>>) -> Result<Vec<RecentProject>, CoreError> {
    core.list_projects()
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn permission_log(
    core: State<'_, Arc<Core>>,
    project_path: Option<String>,
) -> Result<Vec<AuditEntry>, CoreError> {
    core.permission_log(project_path.as_deref().map(Path::new))
}

#[tauri::command(async)]
pub fn search_sessions(
    core: State<'_, Arc<Core>>,
    query: String,
) -> Result<Vec<SearchHit>, CoreError> {
    core.search_sessions(&query)
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn list_agents(
    core: State<'_, Arc<Core>>,
    job_id: String,
) -> Result<Vec<store::Agent>, CoreError> {
    core.list_agents(&job_id)
}

#[tauri::command(async)]
pub fn claude_info(core: State<'_, Arc<Core>>) -> Result<ClaudeInfo, CoreError> {
    core.claude_info()
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn archive_job(
    core: State<'_, Arc<Core>>,
    job_id: String,
    archived: bool,
) -> Result<(), CoreError> {
    core.archive_job(&job_id, archived)
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn pin_job(core: State<'_, Arc<Core>>, job_id: String, pinned: bool) -> Result<(), CoreError> {
    core.pin_job(&job_id, pinned)
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn rename_job(
    core: State<'_, Arc<Core>>,
    job_id: String,
    title: String,
) -> Result<(), CoreError> {
    core.rename_job(&job_id, &title)
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn resume_command(
    core: State<'_, Arc<Core>>,
    job_id: String,
) -> Result<ResumeCommand, CoreError> {
    core.resume_command(&job_id)
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn delete_job(core: State<'_, Arc<Core>>, job_id: String) -> Result<(), CoreError> {
    core.delete_job(&job_id)
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn list_roles(core: State<'_, Arc<Core>>) -> Result<Vec<KitRole>, CoreError> {
    Ok(core.kit().roles()?)
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn save_role(core: State<'_, Arc<Core>>, role: Role) -> Result<KitRole, CoreError> {
    Ok(core.kit().save_role(role)?)
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn reset_role(core: State<'_, Arc<Core>>, name: String) -> Result<(), CoreError> {
    Ok(core.kit().reset_role(&name)?)
}

#[tauri::command]
pub fn list_tools() -> Vec<String> {
    kit::tools()
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn list_skills(core: State<'_, Arc<Core>>) -> Result<Vec<Skill>, CoreError> {
    Ok(core.kit().skills()?)
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn set_skill_enabled(
    core: State<'_, Arc<Core>>,
    name: String,
    enabled: bool,
) -> Result<(), CoreError> {
    Ok(core.kit().set_skill_enabled(&name, enabled)?)
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn list_kinds(core: State<'_, Arc<Core>>) -> Result<Vec<KindRow>, CoreError> {
    Ok(core.kit().kinds()?)
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn save_kind(core: State<'_, Arc<Core>>, kind: Kind) -> Result<KindRow, CoreError> {
    Ok(core.kit().save_kind(kind)?)
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn reset_kind(core: State<'_, Arc<Core>>, id: String) -> Result<(), CoreError> {
    Ok(core.kit().reset_kind(&id)?)
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn save_attachment(
    core: State<'_, Arc<Core>>,
    name: String,
    base64: String,
) -> Result<Attachment, CoreError> {
    core.save_attachment(&name, &base64)
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn attach_path(core: State<'_, Arc<Core>>, path: PathBuf) -> Result<Attachment, CoreError> {
    core.attach_path(&path)
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn claude_stats(
    core: State<'_, Arc<Core>>,
    project_path: Option<String>,
) -> Result<ClaudeStats, CoreError> {
    core.inner().claude_stats(project_path.as_deref())
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn list_customize(
    core: State<'_, Arc<Core>>,
    project_path: Option<PathBuf>,
) -> Result<Customize, CoreError> {
    core.inner().list_customize(project_path.as_deref())
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn measure_customize(
    core: State<'_, Arc<Core>>,
    project_path: Option<PathBuf>,
) -> Result<Customize, CoreError> {
    core.inner().measure_customize(project_path.as_deref())
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn read_customize_item(core: State<'_, Arc<Core>>, path: PathBuf) -> Result<Draft, CoreError> {
    Ok(customize_edit::read(&core.customize_roots()?, &path)?)
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn save_customize_item(
    core: State<'_, Arc<Core>>,
    request: SaveRequest,
) -> Result<PathBuf, CoreError> {
    Ok(customize_edit::save(&core.customize_roots()?, &request)?)
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn delete_customize_item(core: State<'_, Arc<Core>>, path: PathBuf) -> Result<(), CoreError> {
    let discard = |item: &Path| trash::delete(item);
    Ok(customize_edit::delete(
        &core.customize_roots()?,
        &path,
        discard,
    )?)
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn claude_stats_snapshot(
    core: State<'_, Arc<Core>>,
    project_path: Option<String>,
) -> Result<ClaudeStats, CoreError> {
    core.claude_stats_snapshot(project_path.as_deref())
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn session_tokens(
    core: State<'_, Arc<Core>>,
    job_id: String,
) -> Result<SessionTokens, CoreError> {
    core.session_tokens(&job_id)
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn agent_history(core: State<'_, Arc<Core>>, agent_id: String) -> Result<Vec<Turn>, CoreError> {
    core.agent_history(&agent_id)
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn settings_changed(core: State<'_, Arc<Core>>, agent_id: String) -> Result<bool, CoreError> {
    core.settings_changed(&agent_id)
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn context_usage(core: State<'_, Arc<Core>>, agent_id: String) -> Result<Value, CoreError> {
    core.context_usage(&agent_id)
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn job_links(core: State<'_, Arc<Core>>, job_id: String) -> Result<github::Links, CoreError> {
    core.job_links(&job_id)
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn open_worktree(app: AppHandle, core: State<'_, Arc<Core>>, agent_id: String) -> Result<(), CoreError> {
    let worktree = core.worktree(&agent_id)?;
    app.opener()
        .open_path(worktree.to_string_lossy(), None::<&str>)
        .map_err(|error| CoreError(format!("could not open {worktree:?}: {error}")))
}

#[tauri::command(async)]
pub fn permission_modes(core: State<'_, Arc<Core>>) -> Result<Vec<String>, CoreError> {
    core.permission_modes()
}

#[tauri::command(async)]
pub fn claude_permission_mode(core: State<'_, Arc<Core>>) -> String {
    core.claude_permission_mode()
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn set_permission_mode(
    core: State<'_, Arc<Core>>,
    agent_id: String,
    mode: String,
) -> Result<(), CoreError> {
    core.set_permission_mode(&agent_id, &mode)
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn mcp_status(core: State<'_, Arc<Core>>, agent_id: String) -> Result<Value, CoreError> {
    core.mcp_status(&agent_id)
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn mcp_reconnect(
    core: State<'_, Arc<Core>>,
    agent_id: String,
    server: String,
) -> Result<(), CoreError> {
    core.mcp_reconnect(&agent_id, &server)
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn list_accounts(core: State<'_, Arc<Core>>) -> Result<Vec<Account>, CoreError> {
    core.list_accounts()
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn refresh_accounts(core: State<'_, Arc<Core>>) {
    core.inner().refresh_accounts();
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn add_account(core: State<'_, Arc<Core>>, config_dir: PathBuf) -> Result<Account, CoreError> {
    core.inner().add_account(&config_dir)
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn remove_account(core: State<'_, Arc<Core>>, id: String) -> Result<(), CoreError> {
    core.remove_account(&id)
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn rename_account(
    core: State<'_, Arc<Core>>,
    id: String,
    label: String,
) -> Result<(), CoreError> {
    core.rename_account(&id, &label)
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn set_default_account(core: State<'_, Arc<Core>>, id: String) -> Result<(), CoreError> {
    core.set_default_account(&id)
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn project_accounts(
    core: State<'_, Arc<Core>>,
) -> Result<HashMap<String, String>, CoreError> {
    core.project_accounts()
}

#[tauri::command(async, rename_all = "snake_case")]
pub fn set_project_account(
    core: State<'_, Arc<Core>>,
    project_path: PathBuf,
    account_id: Option<String>,
) -> Result<(), CoreError> {
    core.set_project_account(&project_path, account_id.as_deref())
}
