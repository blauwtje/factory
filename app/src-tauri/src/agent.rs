use std::collections::HashMap;
use std::fmt;
use std::io::{self, BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use command_group::{CommandGroup, GroupChild};
use serde::Serialize;
use serde_json::json;

use crate::permission::{control_response, AllowedTools, Decision, Pending, PendingRequests};
use crate::protocol::{failure_reason, parse_control_response, parse_line, Outcome, StreamEvent};

pub type Env = HashMap<String, String>;

pub const DEFAULT_OUTPUT_STYLE: &str = "Concise";

static OUTPUT_STYLE: Mutex<String> = Mutex::new(String::new());

pub fn set_output_style(name: &str) {
    *OUTPUT_STYLE.lock().unwrap() = name.trim().into();
}

pub fn output_style() -> String {
    let chosen = OUTPUT_STYLE.lock().unwrap().clone();
    if chosen.is_empty() {
        DEFAULT_OUTPUT_STYLE.into()
    } else {
        chosen
    }
}

const MIN_VERSION: (u32, u32, u32) = (2, 1, 326);
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const REMOVED_VARS: [&str; 3] = [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "CLAUDE_CODE_OAUTH_TOKEN",
];
const NPM_EXE: [&str; 5] = [
    "node_modules",
    "@anthropic-ai",
    "claude-code",
    "bin",
    "claude.exe",
];

#[derive(Debug, Clone)]
pub struct AgentSpec {
    pub role: String,
    pub name: String,
    pub model: String,
    pub effort: String,
    pub cwd: PathBuf,
    pub session_id: String,
    pub resume: bool,
    pub plugin_dir: PathBuf,
    pub add_dir: PathBuf,
    pub mcp_config: Option<PathBuf>,
    pub permission_mode: String,
    pub allowed_tools: AllowedTools,
    pub config_dir: Option<PathBuf>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum AgentError {
    ClaudeNotFound(String),
    UnsupportedVersion(String),
    ApiKeySource(String),
    ModelMismatch { asked: String, got: String },
    NoInit,
    NoPermissionModes,
    UnknownRequest(String),
    Io(String),
}

impl fmt::Display for AgentError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            AgentError::ClaudeNotFound(searched) => write!(f, "claude not found: {searched}"),
            AgentError::UnsupportedVersion(found) => {
                let (major, minor, patch) = MIN_VERSION;
                write!(
                    f,
                    "claude version {found:?} is below {major}.{minor}.{patch}"
                )
            }
            AgentError::ApiKeySource(source) => {
                write!(
                    f,
                    "claude reported apiKeySource {source:?}, expected \"none\""
                )
            }
            AgentError::ModelMismatch { asked, got } => {
                write!(f, "claude started model {got:?}, asked for {asked:?}")
            }
            AgentError::NoInit => write!(f, "claude sent no init event"),
            AgentError::NoPermissionModes => {
                write!(f, "claude --help lists no choices for --permission-mode")
            }
            AgentError::UnknownRequest(request_id) => {
                write!(f, "no pending permission request {request_id:?}")
            }
            AgentError::Io(message) => write!(f, "{message}"),
        }
    }
}

impl std::error::Error for AgentError {}

type SharedChild = Arc<Mutex<Option<GroupChild>>>;

type Replies = Arc<Mutex<HashMap<String, Sender<serde_json::Value>>>>;

type Turns = Arc<AtomicUsize>;

struct Process {
    child: SharedChild,
    stdin: ChildStdin,
}

pub struct Agent {
    pub cli_version: String,
    spec: AgentSpec,
    env: Env,
    events_tx: Sender<StreamEvent>,
    events_rx: Option<Receiver<StreamEvent>>,
    pending: PendingRequests,
    replies: Replies,
    turns: Turns,
    process: Process,
}

fn io_error(operation: &str) -> impl Fn(io::Error) -> AgentError + '_ {
    move |error| AgentError::Io(format!("{operation}: {error}"))
}

pub fn system_env() -> Env {
    let mut env: Env = std::env::vars().collect();
    if env.contains_key("FACTORY_CLAUDE_BIN") {
        return env;
    }
    if let Some(path) = login_path(&env) {
        env.retain(|key, _| !key.eq_ignore_ascii_case("PATH"));
        env.insert("PATH".into(), path);
    }
    env
}

pub fn account_env<'a>(
    command: &'a mut Command,
    env: &Env,
    config_dir: Option<&Path>,
) -> &'a mut Command {
    command.envs(env);
    for name in REMOVED_VARS {
        command.env_remove(name);
    }
    match config_dir {
        Some(dir) => command.env("CLAUDE_CONFIG_DIR", dir),
        None => command.env_remove("CLAUDE_CONFIG_DIR"),
    }
}

pub fn spawn_group(command: &mut Command) -> io::Result<GroupChild> {
    #[cfg(windows)]
    return command.group().creation_flags(CREATE_NO_WINDOW).spawn();
    #[cfg(not(windows))]
    command.group_spawn()
}

pub fn no_window(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    std::os::windows::process::CommandExt::creation_flags(command, CREATE_NO_WINDOW);
    command
}

#[cfg(unix)]
fn login_path(env: &Env) -> Option<String> {
    let shell = env.get("SHELL").map_or("/bin/sh", String::as_str);
    let output = Command::new(shell)
        .args(["-ilc", r#"printf '\n%s' "$PATH""#])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    let text = String::from_utf8(output.stdout).ok()?;
    text.lines()
        .last()
        .filter(|path| !path.is_empty())
        .map(String::from)
}

#[cfg(windows)]
fn login_path(env: &Env) -> Option<String> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;
    let read = |root, key: &str| {
        RegKey::predef(root)
            .open_subkey(key)
            .and_then(|key| key.get_value::<String, _>("Path"))
            .ok()
    };
    let system = read(
        HKEY_LOCAL_MACHINE,
        r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment",
    );
    let user = read(HKEY_CURRENT_USER, "Environment");
    let path = [system, user]
        .into_iter()
        .flatten()
        .map(|value| expand(&value, env))
        .collect::<Vec<_>>()
        .join(";");
    (!path.is_empty()).then_some(path)
}

#[cfg(windows)]
fn expand(value: &str, env: &Env) -> String {
    let pieces: Vec<&str> = value.split('%').collect();
    let last = pieces.len() - 1;
    let lookup = |name: &str| {
        env.iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.clone())
    };
    pieces
        .iter()
        .enumerate()
        .map(|(index, piece)| match index % 2 {
            0 => piece.to_string(),
            _ if index == last => format!("%{piece}"),
            _ => lookup(piece).unwrap_or_else(|| format!("%{piece}%")),
        })
        .collect()
}

fn find_claude(env: &Env) -> Result<PathBuf, AgentError> {
    if let Some(configured) = env.get("FACTORY_CLAUDE_BIN") {
        let path = PathBuf::from(configured);
        return if path.is_file() {
            Ok(path)
        } else {
            Err(AgentError::ClaudeNotFound(format!(
                "FACTORY_CLAUDE_BIN={configured}"
            )))
        };
    }
    let installed = env
        .get("HOME")
        .or_else(|| env.get("USERPROFILE"))
        .map(|home| {
            [home.as_str(), ".local", "bin"]
                .iter()
                .collect::<PathBuf>()
                .join(if cfg!(windows) {
                    "claude.exe"
                } else {
                    "claude"
                })
        });
    let names: Vec<String> = match env.get("PATHEXT") {
        Some(extensions) => extensions
            .split(';')
            .filter(|extension| !extension.is_empty())
            .map(|extension| format!("claude{}", extension.to_lowercase()))
            .collect(),
        None => vec!["claude".into()],
    };
    let on_path = env
        .get("PATH")
        .into_iter()
        .flat_map(std::env::split_paths)
        .flat_map(|dir| names.iter().map(move |name| dir.join(name)));
    installed
        .into_iter()
        .chain(on_path)
        .find(|path| path.is_file())
        .ok_or_else(|| AgentError::ClaudeNotFound("~/.local/bin and PATH".into()))
}

fn npm_exe(cmd: &std::path::Path) -> Option<PathBuf> {
    let exe: PathBuf = cmd.parent()?.join(NPM_EXE.iter().collect::<PathBuf>());
    exe.is_file().then_some(exe)
}

pub fn resolve_claude(env: &Env) -> Result<(Command, PathBuf), AgentError> {
    let path = find_claude(env)?;
    let extension = path
        .extension()
        .map(|extension| extension.to_string_lossy().to_lowercase());
    let resolved = match extension.as_deref() {
        Some("js" | "mjs") => {
            let mut command = Command::new("node");
            command.arg(&path);
            (command, path)
        }
        Some("cmd" | "bat") => match npm_exe(&path) {
            Some(exe) => (Command::new(&exe), exe),
            None => {
                let mut command = Command::new("cmd");
                command.arg("/c").arg(&path);
                (command, path)
            }
        },
        _ => (Command::new(&path), path),
    };
    Ok(resolved)
}

pub fn check_version(output: &str) -> Result<String, AgentError> {
    let unsupported = || AgentError::UnsupportedVersion(output.trim().into());
    let version = output.split_whitespace().next().ok_or_else(unsupported)?;
    let parts: Vec<u32> = version
        .split('.')
        .map(str::parse)
        .collect::<Result<_, _>>()
        .map_err(|_| unsupported())?;
    match parts[..] {
        [major, minor, patch] if (major, minor, patch) >= MIN_VERSION => Ok(version.into()),
        _ => Err(unsupported()),
    }
}

pub fn cli_version(env: &Env) -> Result<String, AgentError> {
    let (mut command, _) = resolve_claude(env)?;
    let output = no_window(&mut command)
        .arg("--version")
        .envs(env)
        .stdin(Stdio::null())
        .output()
        .map_err(io_error("run claude --version"))?;
    check_version(&String::from_utf8_lossy(&output.stdout))
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ClaudeInfo {
    pub path: PathBuf,
    pub version: String,
}

pub fn claude_info(env: &Env) -> Result<ClaudeInfo, AgentError> {
    let (_, path) = resolve_claude(env)?;
    let version = cli_version(env)?;
    Ok(ClaudeInfo { path, version })
}

pub fn parse_permission_modes(help: &str) -> Result<Vec<String>, AgentError> {
    let flag = help
        .split_once("--permission-mode")
        .ok_or(AgentError::NoPermissionModes)?
        .1;
    let choices = flag
        .split_once("(choices:")
        .and_then(|(_, rest)| rest.split_once(')'))
        .ok_or(AgentError::NoPermissionModes)?
        .0;
    let modes: Vec<String> = choices
        .split('"')
        .skip(1)
        .step_by(2)
        .map(String::from)
        .collect();
    if modes.is_empty() {
        return Err(AgentError::NoPermissionModes);
    }
    Ok(modes)
}

pub fn permission_modes(env: &Env) -> Result<Vec<String>, AgentError> {
    let (mut command, _) = resolve_claude(env)?;
    let output = no_window(&mut command)
        .arg("--help")
        .envs(env)
        .stdin(Stdio::null())
        .output()
        .map_err(io_error("run claude --help"))?;
    parse_permission_modes(&String::from_utf8_lossy(&output.stdout))
}

fn forward(
    stdout: ChildStdout,
    spec: AgentSpec,
    child: SharedChild,
    events: Sender<StreamEvent>,
    pending: PendingRequests,
    replies: Replies,
    turns: Turns,
) {
    let mut reader = BufReader::new(stdout);
    let mut line = Vec::new();
    let mut started = false;
    while matches!(reader.read_until(b'\n', &mut line), Ok(read) if read > 0) {
        let text = String::from_utf8_lossy(&line).into_owned();
        line.clear();
        if let Some((request_id, response)) = parse_control_response(&text) {
            if let Some(reply) = replies.lock().unwrap().remove(&request_id) {
                let _ = reply.send(response);
            }
            continue;
        }
        let event = parse_line(&text);
        let Some(mut event) = event else { continue };
        if let StreamEvent::Init {
            api_key_source,
            model,
            ..
        } = &event
        {
            started = true;
            if let Err(error) = check_init(&spec, api_key_source, model) {
                return refuse(&spec, &child, &events, &turns, error);
            }
        }
        if let StreamEvent::ControlRequest {
            request_id,
            tool_name,
            input,
            rules,
        } = &event
        {
            pending.lock().unwrap().insert(
                request_id.clone(),
                Pending {
                    tool_name: tool_name.clone(),
                    input: input.clone(),
                    rules: rules.clone(),
                },
            );
        }
        if let StreamEvent::Result { queued, .. } = &mut event {
            if let Some(message) = failure_reason(&text) {
                if events.send(StreamEvent::Failure { message }).is_err() {
                    return;
                }
            }
            *queued = turns
                .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |n| n.checked_sub(1))
                .is_ok_and(|before| before > 1);
        }
        if events.send(event).is_err() {
            return;
        }
    }
    if !started && child.lock().unwrap().is_some() {
        refuse(&spec, &child, &events, &turns, AgentError::NoInit);
        return;
    }
    if turns.load(Ordering::SeqCst) > 0 && child.lock().unwrap().is_some() {
        pending.lock().unwrap().clear();
        let error = AgentError::Io("claude exited before the turn finished".into());
        refuse(&spec, &child, &events, &turns, error);
    }
}

fn check_init(spec: &AgentSpec, api_key_source: &str, model: &str) -> Result<(), AgentError> {
    if api_key_source != "none" {
        return Err(AgentError::ApiKeySource(api_key_source.into()));
    }
    if model != spec.model {
        return Err(AgentError::ModelMismatch {
            asked: spec.model.clone(),
            got: model.into(),
        });
    }
    Ok(())
}

fn refuse(
    spec: &AgentSpec,
    child: &SharedChild,
    events: &Sender<StreamEvent>,
    turns: &Turns,
    error: AgentError,
) {
    turns.store(0, Ordering::SeqCst);
    let taken = child.lock().unwrap().take();
    if let Some(mut child) = taken {
        let _ = child.kill();
        let _ = child.wait();
    }
    let _ = events.send(StreamEvent::Assistant {
        content: error.to_string(),
    });
    let _ = events.send(StreamEvent::Failure {
        message: error.to_string(),
    });
    let _ = events.send(StreamEvent::Result {
        session_id: spec.session_id.clone(),
        outcome: Outcome::Failed,
        queued: false,
    });
}

impl Process {
    fn start(
        spec: &AgentSpec,
        env: &Env,
        events: &Sender<StreamEvent>,
        pending: &PendingRequests,
        replies: &Replies,
        turns: &Turns,
    ) -> Result<Process, AgentError> {
        let (mut command, _) = resolve_claude(env)?;
        let settings = json!({ "outputStyle": output_style() }).to_string();
        command
            .args([
                "-p",
                "--input-format",
                "stream-json",
                "--output-format",
                "stream-json",
                "--verbose",
                "--include-partial-messages",
                "--permission-prompt-tool",
                "stdio",
                "--model",
                &spec.model,
                "--effort",
                &spec.effort,
                if spec.resume {
                    "--resume"
                } else {
                    "--session-id"
                },
                &spec.session_id,
                "--plugin-dir",
            ])
            .arg(&spec.plugin_dir)
            .arg("--add-dir")
            .arg(&spec.add_dir)
            .args([
                "--agent",
                &format!("factory:{}", spec.role),
                "--settings",
                &settings,
            ]);
        if let Some(mcp_config) = &spec.mcp_config {
            command.arg("--mcp-config").arg(mcp_config);
        }
        if !spec.permission_mode.is_empty() {
            command.args(["--permission-mode", &spec.permission_mode]);
        }
        for tool in spec.allowed_tools.lock().unwrap().iter() {
            command.args(["--allowedTools", tool]);
        }
        command
            .current_dir(&spec.cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        account_env(&mut command, env, spec.config_dir.as_deref());
        let mut child = spawn_group(&mut command).map_err(io_error("start claude"))?;
        let stdin = child.inner().stdin.take().expect("stdin is piped");
        let stdout = child.inner().stdout.take().expect("stdout is piped");
        let child = Arc::new(Mutex::new(Some(child)));
        let (spec, shared, events, pending, replies, turns) = (
            spec.clone(),
            Arc::clone(&child),
            events.clone(),
            Arc::clone(pending),
            Arc::clone(replies),
            Arc::clone(turns),
        );
        thread::spawn(move || forward(stdout, spec, shared, events, pending, replies, turns));
        Ok(Process { child, stdin })
    }

    fn write(&mut self, line: &serde_json::Value) -> Result<(), AgentError> {
        if self.child.lock().unwrap().is_none() {
            return Err(AgentError::Io("claude is stopped".into()));
        }
        writeln!(self.stdin, "{line}")
            .and_then(|()| self.stdin.flush())
            .map_err(io_error("write to claude stdin"))
    }

    fn stop(&mut self) -> io::Result<()> {
        let taken = self.child.lock().unwrap().take();
        let Some(mut child) = taken else {
            return Ok(());
        };
        child.kill()?;
        child.wait().map(drop)
    }
}

impl Drop for Process {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

impl Agent {
    pub fn spawn(spec: AgentSpec) -> Result<Agent, AgentError> {
        let env = system_env();
        let cli_version = cli_version(&env)?;
        let (events_tx, events_rx) = mpsc::channel();
        let pending = PendingRequests::default();
        let replies = Replies::default();
        let turns = Turns::default();
        let process = Process::start(&spec, &env, &events_tx, &pending, &replies, &turns)?;
        Ok(Agent {
            cli_version,
            spec,
            env,
            events_tx,
            events_rx: Some(events_rx),
            pending,
            replies,
            turns,
            process,
        })
    }

    pub fn events(&mut self) -> Option<Receiver<StreamEvent>> {
        self.events_rx.take()
    }

    pub fn send(&mut self, text: &str) -> Result<(), AgentError> {
        let line = json!({"type": "user", "message": {"role": "user", "content": text}});
        self.turns
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |n| Some((n + 1).min(2)))
            .ok();
        self.process.write(&line).inspect_err(|_| {
            self.turns
                .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |n| n.checked_sub(1))
                .ok();
        })
    }

    pub fn busy(&self) -> bool {
        self.turns.load(Ordering::SeqCst) > 0
    }

    pub fn idle(&self) -> bool {
        !self.busy() && self.pending.lock().unwrap().is_empty()
    }

    pub fn answer_permission(
        &mut self,
        request_id: &str,
        decision: &Decision,
    ) -> Result<Pending, AgentError> {
        let pending = self
            .pending
            .lock()
            .unwrap()
            .remove(request_id)
            .ok_or_else(|| AgentError::UnknownRequest(request_id.into()))?;
        if *decision == Decision::AllowAlways {
            let mut allowed = self.spec.allowed_tools.lock().unwrap();
            for tool in pending.rules.iter().map(|rule| rule.allowed_tool()) {
                if !allowed.contains(&tool) {
                    allowed.push(tool);
                }
            }
        }
        let line = control_response(request_id, pending.clone(), decision);
        self.process.write(&line)?;
        Ok(pending)
    }

    pub fn open_requests(&self) -> Vec<StreamEvent> {
        self.pending
            .lock()
            .unwrap()
            .iter()
            .map(|(request_id, pending)| StreamEvent::ControlRequest {
                request_id: request_id.clone(),
                tool_name: pending.tool_name.clone(),
                input: pending.input.clone(),
                rules: pending.rules.clone(),
            })
            .collect()
    }

    pub fn set_model(&mut self, model: &str, effort: &str) -> Result<(), AgentError> {
        self.stop()?;
        self.spec.model = model.into();
        self.spec.effort = effort.into();
        self.spec.resume = true;
        self.pending.lock().unwrap().clear();
        self.turns.store(0, Ordering::SeqCst);
        self.process = Process::start(
            &self.spec,
            &self.env,
            &self.events_tx,
            &self.pending,
            &self.replies,
            &self.turns,
        )?;
        Ok(())
    }

    pub fn set_permission_mode(
        &mut self,
        mode: &str,
    ) -> Result<Receiver<serde_json::Value>, AgentError> {
        let wire = if mode == "manual" { "default" } else { mode };
        let pending = self.control_request(json!({"subtype": "set_permission_mode", "mode": wire}))?;
        let reply = pending
            .recv_timeout(Duration::from_secs(60))
            .map_err(|_| AgentError::Io(format!("claude did not answer permission mode {mode:?}")))?;
        if reply.is_null() {
            return Err(AgentError::Io(format!("claude rejected permission mode {mode:?}")));
        }
        self.spec.permission_mode = mode.into();
        let (answer, response) = mpsc::channel();
        let _ = answer.send(reply);
        Ok(response)
    }

    pub fn context_usage(&mut self) -> Result<Receiver<serde_json::Value>, AgentError> {
        self.control_request(json!({"subtype": "get_context_usage", "detail": "summary"}))
    }

    pub fn mcp_status(&mut self) -> Result<Receiver<serde_json::Value>, AgentError> {
        self.control_request(json!({"subtype": "mcp_status"}))
    }

    pub fn mcp_reconnect(
        &mut self,
        server: &str,
    ) -> Result<Receiver<serde_json::Value>, AgentError> {
        self.control_request(json!({"subtype": "mcp_reconnect", "serverName": server}))
    }

    pub fn interrupt(&mut self) -> Result<(), AgentError> {
        self.pending.lock().unwrap().clear();
        self.control_request(json!({"subtype": "interrupt"}))
            .map(drop)
    }

    fn control_request(
        &mut self,
        request: serde_json::Value,
    ) -> Result<Receiver<serde_json::Value>, AgentError> {
        let request_id = uuid::Uuid::new_v4().to_string();
        let (reply, response) = mpsc::channel();
        self.replies
            .lock()
            .unwrap()
            .insert(request_id.clone(), reply);
        let line = json!({
            "type": "control_request",
            "request_id": request_id,
            "request": request,
        });
        self.process.write(&line)?;
        Ok(response)
    }

    pub fn stop(&mut self) -> Result<(), AgentError> {
        self.process.stop().map_err(io_error("stop claude"))
    }
}
