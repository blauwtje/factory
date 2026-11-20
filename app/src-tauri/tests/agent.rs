use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::Receiver;
use std::time::Duration;

use factory_lib::agent::{
    check_version, cli_version, parse_permission_modes, permission_modes, resolve_claude, Agent, AgentError, AgentSpec, Env,
};
use factory_lib::permission::Decision;
use factory_lib::protocol::{Outcome, StreamEvent};
use serde_json::Value;
use tempfile::TempDir;

const FAKE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fake-claude.mjs");
const NPM_EXE: [&str; 5] = [
    "node_modules",
    "@anthropic-ai",
    "claude-code",
    "bin",
    "claude.exe",
];

fn touch(path: &Path) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, "").unwrap();
}

fn env(pairs: &[(&str, &Path)]) -> Env {
    pairs
        .iter()
        .map(|(key, value)| (key.to_string(), value.to_string_lossy().into_owned()))
        .collect()
}

fn resolved(env: &Env) -> (String, Vec<String>, PathBuf) {
    let (command, path) = resolve_claude(env).unwrap();
    let words = |s: &std::ffi::OsStr| s.to_string_lossy().into_owned();
    (
        words(command.get_program()),
        command.get_args().map(words).collect(),
        path,
    )
}

fn spec(role: &str) -> AgentSpec {
    std::env::set_var("FACTORY_CLAUDE_BIN", FAKE);
    AgentSpec {
        config_dir: None,
        role: role.into(),
        name: "builder-1".into(),
        model: "claude-sonnet-5-5".into(),
        effort: "medium".into(),
        cwd: std::env::temp_dir(),
        session_id: "11111111-2222-3333-4444-555555555555".into(),
        resume: false,
        plugin_dir: PathBuf::from("kit"),
        add_dir: std::env::temp_dir(),
        mcp_config: None,
        permission_mode: String::new(),
        allowed_tools: Default::default(),
    }
}

fn reply(events: &Receiver<StreamEvent>) -> Value {
    loop {
        let event = events.recv_timeout(Duration::from_secs(10)).unwrap();
        if let StreamEvent::Assistant { content } = event {
            return serde_json::from_str(&content).unwrap();
        }
    }
}

fn refusal(role: &str) -> (Vec<StreamEvent>, Agent) {
    let mut agent = Agent::spawn(spec(role)).unwrap();
    let events = agent.events().unwrap();
    agent.send("hi").ok();
    let mut seen = Vec::new();
    while !matches!(seen.last(), Some(StreamEvent::Result { .. })) {
        seen.push(events.recv_timeout(Duration::from_secs(10)).unwrap());
    }
    (seen, agent)
}

fn stopped_with(error: AgentError) -> Vec<StreamEvent> {
    vec![
        StreamEvent::Assistant {
            content: error.to_string(),
        },
        StreamEvent::Result {
            session_id: "11111111-2222-3333-4444-555555555555".into(),
            outcome: Outcome::Failed,
            queued: false,
        },
    ]
}

fn argv(reply: &Value) -> Vec<&str> {
    reply["argv"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a.as_str().unwrap())
        .collect()
}

fn pair_in(argv: &[&str], flag: &str, value: &str) -> bool {
    argv.windows(2).any(|w| w[0] == flag && w[1] == value)
}

#[test]
fn a_configured_exe_is_started_directly() {
    let dir = TempDir::new().unwrap();
    let exe = dir.path().join("claude.exe");
    touch(&exe);
    let (program, args, path) = resolved(&env(&[("FACTORY_CLAUDE_BIN", &exe)]));
    assert_eq!(
        (program, args, path),
        (exe.to_string_lossy().into_owned(), vec![], exe)
    );
}

#[test]
fn an_npm_cmd_starts_the_exe_of_its_package() {
    let dir = TempDir::new().unwrap();
    let cmd = dir.path().join("claude.cmd");
    let exe: PathBuf = std::iter::once(dir.path())
        .chain(NPM_EXE.iter().map(Path::new))
        .collect();
    touch(&cmd);
    touch(&exe);
    let (program, args, path) = resolved(&env(&[("FACTORY_CLAUDE_BIN", &cmd)]));
    assert_eq!(
        (program, args, path),
        (exe.to_string_lossy().into_owned(), vec![], exe)
    );
}

#[test]
fn a_lone_cmd_starts_through_cmd_c() {
    let dir = TempDir::new().unwrap();
    let cmd = dir.path().join("claude.cmd");
    touch(&cmd);
    let (program, args, path) = resolved(&env(&[("FACTORY_CLAUDE_BIN", &cmd)]));
    assert_eq!(
        (program, args, path),
        (
            "cmd".to_string(),
            vec!["/c".to_string(), cmd.to_string_lossy().into_owned()],
            cmd
        )
    );
}

#[test]
fn an_mjs_starts_through_node() {
    let (program, args, path) = resolved(&env(&[("FACTORY_CLAUDE_BIN", Path::new(FAKE))]));
    assert_eq!(
        (program, args, path),
        (
            "node".to_string(),
            vec![FAKE.to_string()],
            PathBuf::from(FAKE)
        )
    );
}

#[test]
fn the_search_order_is_override_then_home_install_then_path() {
    let dir = TempDir::new().unwrap();
    let home = dir.path().join("home");
    let bin = dir.path().join("bin");
    let override_bin = dir.path().join("override").join("claude.exe");
    let installed = home.join(".local").join("bin").join(if cfg!(windows) {
        "claude.exe"
    } else {
        "claude"
    });
    let on_path = bin.join("claude.cmd");
    touch(&override_bin);
    touch(&installed);
    touch(&on_path);
    let mut search = env(&[("HOME", &home), ("USERPROFILE", &home), ("PATH", &bin)]);
    search.insert("PATHEXT".into(), ".EXE;.CMD".into());
    assert_eq!(resolved(&search).2, installed);
    search.insert(
        "FACTORY_CLAUDE_BIN".into(),
        override_bin.to_string_lossy().into_owned(),
    );
    assert_eq!(resolved(&search).2, override_bin);
    search.remove("FACTORY_CLAUDE_BIN");
    fs::remove_file(&installed).unwrap();
    assert_eq!(resolved(&search).2, on_path);
}

#[test]
fn a_missing_claude_is_an_error_naming_where_it_looked() {
    let dir = TempDir::new().unwrap();
    let missing = dir.path().join("nope.exe");
    let error = resolve_claude(&env(&[("FACTORY_CLAUDE_BIN", &missing)])).err();
    assert_eq!(
        error,
        Some(AgentError::ClaudeNotFound(format!(
            "FACTORY_CLAUDE_BIN={}",
            missing.display()
        )))
    );
}

#[test]
fn versions_below_2_1_326_are_refused() {
    assert_eq!(
        check_version("2.1.326 (Claude Code)\n"),
        Ok("2.1.326".into())
    );
    assert_eq!(check_version("2.2.0 (Claude Code)"), Ok("2.2.0".into()));
    assert_eq!(check_version("10.0.0 (Claude Code)"), Ok("10.0.0".into()));
    for old in ["2.1.325 (Claude Code)", "1.99.999", "garbage", ""] {
        assert_eq!(
            check_version(old),
            Err(AgentError::UnsupportedVersion(old.trim().into()))
        );
    }
}

#[test]
fn the_version_comes_from_the_resolved_claude() {
    assert_eq!(
        cli_version(&env(&[("FACTORY_CLAUDE_BIN", Path::new(FAKE))])),
        Ok("2.1.326".into())
    );
}

#[test]
fn spawn_passes_flags_and_keeps_the_prompt_out_of_argv() {
    let mut spec = spec("builder");
    spec.mcp_config = Some(PathBuf::from("bus.json"));
    let mut agent = Agent::spawn(spec).unwrap();
    let events = agent.events().unwrap();
    assert_eq!(agent.cli_version, "2.1.326");
    agent.send("do the \"thing\"\nnow").unwrap();
    let reply = reply(&events);
    let argv = argv(&reply);
    assert_eq!(reply["text"], "do the \"thing\"\nnow");
    assert!(argv.iter().all(|a| !a.contains("thing")));
    assert!(pair_in(&argv, "--model", "claude-sonnet-5-5"));
    assert!(pair_in(&argv, "--effort", "medium"));
    assert!(pair_in(&argv, "--agent", "factory:builder"));
    assert!(pair_in(&argv, "--settings", r#"{"outputStyle":"Concise"}"#));
    assert!(pair_in(&argv, "--plugin-dir", "kit"));
    assert!(pair_in(&argv, "--mcp-config", "bus.json"));
    assert!(pair_in(&argv, "--permission-prompt-tool", "stdio"));
    assert!(pair_in(
        &argv,
        "--session-id",
        "11111111-2222-3333-4444-555555555555"
    ));
    assert!(!argv.contains(&"--resume"));
    assert!(!argv.contains(&"--bare"));
    assert!(!argv.contains(&"--permission-mode"));
}

#[test]
fn a_permission_mode_is_passed_to_claude_and_kept_across_a_restart() {
    let mut spec = spec("builder");
    spec.permission_mode = "plan".into();
    let mut agent = Agent::spawn(spec).unwrap();
    let events = agent.events().unwrap();
    agent.set_model("claude-sonnet-5-5", "high").unwrap();
    agent.send("hi").unwrap();
    let reply = reply(&events);
    assert!(pair_in(&argv(&reply), "--permission-mode", "plan"));
}

#[test]
fn a_rejected_permission_mode_is_an_error_and_is_not_kept() {
    let mut agent = Agent::spawn(spec("builder")).unwrap();
    let events = agent.events().unwrap();
    assert!(agent.set_permission_mode("invalid").is_err());
    agent.set_model("claude-sonnet-5-5", "high").unwrap();
    agent.send("hi").unwrap();
    let reply = reply(&events);
    assert!(!argv(&reply).contains(&"--permission-mode"));
}

#[test]
fn the_init_event_reaches_the_receiver() {
    let mut agent = Agent::spawn(spec("builder")).unwrap();
    let events = agent.events().unwrap();
    agent.send("hi").unwrap();
    assert_eq!(
        events.recv_timeout(Duration::from_secs(10)).unwrap(),
        StreamEvent::Init {
            session_id: "11111111-2222-3333-4444-555555555555".into(),
            api_key_source: "none".into(),
            model: "claude-sonnet-5-5".into(),
        }
    );
}

#[test]
fn credentials_are_removed_and_the_rest_of_the_environment_stays() {
    for name in [
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_AUTH_TOKEN",
        "CLAUDE_CODE_OAUTH_TOKEN",
    ] {
        std::env::set_var(name, "sk-test");
    }
    let mut agent = Agent::spawn(spec("builder")).unwrap();
    let events = agent.events().unwrap();
    agent.send("hi").unwrap();
    let reply = reply(&events);
    assert_eq!(reply["leaked"], serde_json::json!([]));
    assert_eq!(reply["hasPath"], true);
}

#[test]
fn an_api_key_source_other_than_none_stops_the_agent() {
    let (seen, mut agent) = refusal("wrong-key");
    assert_eq!(
        seen,
        stopped_with(AgentError::ApiKeySource("ANTHROPIC_API_KEY".into()))
    );
    assert!(matches!(agent.send("late"), Err(AgentError::Io(_))));
}

#[test]
fn a_model_other_than_asked_stops_the_agent() {
    let (seen, mut agent) = refusal("wrong-model");
    assert_eq!(
        seen,
        stopped_with(AgentError::ModelMismatch {
            asked: "claude-sonnet-5-5".into(),
            got: "claude-haiku-5-5".into()
        })
    );
    assert!(matches!(agent.send("late"), Err(AgentError::Io(_))));
}

#[test]
fn a_process_that_dies_before_init_ends_in_an_error() {
    let (seen, _) = refusal("no-init");
    assert_eq!(seen, stopped_with(AgentError::NoInit));
}

#[test]
fn set_model_resumes_the_session_on_the_new_model() {
    let mut agent = Agent::spawn(spec("builder")).unwrap();
    let events = agent.events().unwrap();
    agent.send("first").unwrap();
    reply(&events);
    agent.set_model("claude-opus-5-5", "high").unwrap();
    agent.send("second").unwrap();
    let reply = reply(&events);
    let argv = argv(&reply);
    assert_eq!(reply["text"], "second");
    assert!(pair_in(&argv, "--model", "claude-opus-5-5"));
    assert!(pair_in(&argv, "--effort", "high"));
    assert!(pair_in(
        &argv,
        "--resume",
        "11111111-2222-3333-4444-555555555555"
    ));
    assert!(!argv.contains(&"--session-id"));
}

#[test]
fn a_stopped_agent_cannot_be_written_to() {
    let mut agent = Agent::spawn(spec("builder")).unwrap();
    agent.stop().unwrap();
    assert!(matches!(agent.send("late"), Err(AgentError::Io(_))));
}

fn pids_in(dir: &Path, cwd: &Path) -> Vec<String> {
    fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap())
        .filter(|entry| fs::read_to_string(entry.path()).unwrap() == cwd.to_str().unwrap())
        .map(|entry| entry.file_name().into_string().unwrap())
        .collect()
}

#[test]
fn an_interrupt_ends_the_turn_and_forgets_its_permission_requests_in_the_same_process() {
    let pids = Path::new(env!("CARGO_TARGET_TMPDIR")).join("pids");
    fs::create_dir_all(&pids).unwrap();
    std::env::set_var("FAKE_CLAUDE_PID_DIR", &pids);
    let cwd = TempDir::new().unwrap();
    let cwd = fs::canonicalize(cwd.path()).unwrap();
    let mut spec = spec("builder");
    spec.cwd = cwd.clone();
    let mut agent = Agent::spawn(spec).unwrap();
    let events = agent.events().unwrap();
    agent.send("ask permission").unwrap();
    while !matches!(
        events.recv_timeout(Duration::from_secs(10)).unwrap(),
        StreamEvent::ControlRequest { .. }
    ) {}
    let before = pids_in(&pids, &cwd);

    agent.interrupt().unwrap();
    while !matches!(
        events.recv_timeout(Duration::from_secs(10)).unwrap(),
        StreamEvent::Result { .. }
    ) {}
    assert_eq!(
        agent.answer_permission("req_team", &Decision::AllowOnce),
        Err(AgentError::UnknownRequest("req_team".into()))
    );
    agent.send("after").unwrap();
    assert_eq!(reply(&events)["text"], "after");
    assert_eq!(before.len(), 1);
    assert_eq!(pids_in(&pids, &cwd), before);
}

#[test]
fn context_usage_returns_the_reply_to_its_own_request() {
    let mut agent = Agent::spawn(spec("builder")).unwrap();
    let events = agent.events().unwrap();
    agent.send("first").unwrap();
    reply(&events);
    let usage = agent.context_usage().unwrap();
    let usage = usage.recv_timeout(Duration::from_secs(10)).unwrap();
    assert_eq!(usage["totalTokens"], 1200);
    assert_eq!(usage["maxTokens"], 200000);
    assert_eq!(usage["memoryFiles"][0]["tokens"], 321);
}

#[test]
fn a_process_that_exits_mid_turn_leaves_an_agent_that_is_not_busy() {
    let mut agent = Agent::spawn(spec("builder")).unwrap();
    let events = agent.events().unwrap();
    agent.send("die").unwrap();
    loop {
        let event = events.recv_timeout(Duration::from_secs(10)).unwrap();
        if matches!(
            event,
            StreamEvent::Result {
                outcome: Outcome::Failed,
                ..
            }
        ) {
            break;
        }
    }
    assert!(matches!(agent.send("late"), Err(AgentError::Io(_))));
    assert!(!agent.busy());
}

const HELP: &str = r#"Options:
  --model <model>                   Model for the current session.
  --permission-mode <mode>          Permission mode to use for the session
                                    (choices: "acceptEdits", "auto",
                                    "bypassPermissions", "manual", "dontAsk", "plan")
  --plugin-dir <path>               Load plugins
"#;

#[test]
fn permission_modes_are_the_choices_listed_in_the_help_in_order() {
    assert_eq!(
        parse_permission_modes(HELP).unwrap(),
        ["acceptEdits", "auto", "bypassPermissions", "manual", "dontAsk", "plan"]
    );
}

#[test]
fn a_help_without_permission_mode_choices_is_an_error() {
    let error = parse_permission_modes("Options:\n  --model <model>  Model\n").unwrap_err();
    assert_eq!(error, AgentError::NoPermissionModes);
}

#[test]
fn permission_modes_come_from_the_resolved_claude() {
    let modes = permission_modes(&env(&[("FACTORY_CLAUDE_BIN", Path::new(FAKE))])).unwrap();
    assert_eq!(modes, ["acceptEdits", "plan"]);
}
