use std::fs;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::thread::sleep;
use std::time::Duration;

use factory_lib::commands::{Core, Emit, JobMode, NewJob, Notice, Paths};
use factory_lib::permission::Decision;
use factory_lib::protocol::StreamEvent;
use serde_json::{json, Value};
use tempfile::TempDir;

const FAKE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fake-claude.mjs");
const KIT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../kit");

type Notices = Arc<Mutex<Vec<Notice>>>;

struct Fixture {
    _dirs: (TempDir, TempDir, TempDir),
    repo: PathBuf,
    paths: Paths,
    core: Arc<Core>,
    notices: Notices,
}

fn git(dir: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .current_dir(dir)
        .args(["-c", "user.name=Test", "-c", "user.email=test@example.com"])
        .args(args)
        .output()
        .unwrap();
    assert!(output.status.success(), "git {args:?}: {output:?}");
    String::from_utf8(output.stdout).unwrap()
}

fn commit_file(dir: &Path, name: &str) {
    fs::write(dir.join(name), format!("{name}\n")).unwrap();
    git(dir, &["add", name]);
    git(dir, &["commit", "-m", &format!("add {name}")]);
}

fn collecting() -> (Emit, Notices) {
    let notices = Notices::default();
    let sink = Arc::clone(&notices);
    let emit: Emit = Arc::new(move |notice| sink.lock().unwrap().push(notice));
    (emit, notices)
}

fn fixture() -> Fixture {
    std::env::set_var("FACTORY_CLAUDE_BIN", FAKE);
    let (repo, data, local) = (
        TempDir::new().unwrap(),
        TempDir::new().unwrap(),
        TempDir::new().unwrap(),
    );
    git(repo.path(), &["init", "-q"]);
    commit_file(repo.path(), "base.txt");
    let paths = Paths {
        data: data.path().into(),
        local: local.path().into(),
        kit: KIT.into(),
    };
    let (emit, notices) = collecting();
    let core = Core::open(paths.clone(), emit).unwrap();
    Fixture {
        repo: repo.path().into(),
        _dirs: (repo, data, local),
        paths,
        core,
        notices,
    }
}

fn new_job(fixture: &Fixture, mode: JobMode) -> String {
    fixture
        .core
        .create_job(NewJob {
            account_id: None,
            project_path: fixture.repo.clone(),
            prompt: "Add login".into(),
            mode,
            model: None,
            effort: None,
            permission_mode: None,
        })
        .unwrap()
        .id
}

fn wait_for<T>(what: &str, mut probe: impl FnMut() -> Option<T>) -> T {
    for _ in 0..100 {
        if let Some(found) = probe() {
            return found;
        }
        sleep(Duration::from_millis(100));
    }
    panic!("never saw {what}");
}

fn echoes(notices: &Notices) -> Vec<String> {
    notices
        .lock()
        .unwrap()
        .iter()
        .filter_map(|notice| match notice {
            Notice::AgentEvent(payload) => match &payload.event {
                StreamEvent::Assistant { content } => Some(content.clone()),
                _ => None,
            },
            Notice::Accounts(_) | Notice::Tokens(_) | Notice::StatsProgress(_) | Notice::JobsChanged => None,
        })
        .collect()
}

fn wait_for_echo(notices: &Notices, needle: &str) -> String {
    wait_for(needle, || {
        echoes(notices)
            .into_iter()
            .find(|text| text.contains(needle))
    })
}

fn agents(core: &Core, job_id: &str) -> Vec<Value> {
    serde_json::to_value(core.list_agents(job_id).unwrap())
        .unwrap()
        .as_array()
        .unwrap()
        .clone()
}

fn call_bus(paths: &Paths, job_id: &str, tool: &str, arguments: Value) -> Value {
    let config = fs::read_to_string(paths.data.join("jobs").join(job_id).join("mcp.json")).unwrap();
    let config: Value = serde_json::from_str(&config).unwrap();
    let server = &config["mcpServers"]["factory"];
    let address = server["url"]
        .as_str()
        .unwrap()
        .trim_start_matches("http://")
        .trim_end_matches("/mcp");
    let body = json!({
        "jsonrpc": "2.0", "id": 1, "method": "tools/call",
        "params": {"name": tool, "arguments": arguments},
    })
    .to_string();
    let request = format!(
        "POST /mcp HTTP/1.1\r\nHost: {address}\r\nAuthorization: {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        server["headers"]["Authorization"].as_str().unwrap(),
        body.len()
    );
    let mut stream = TcpStream::connect(address).unwrap();
    stream.write_all(request.as_bytes()).unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).unwrap();
    let reply: Value = serde_json::from_str(response.split_once("\r\n\r\n").unwrap().1).unwrap();
    let result = &reply["result"];
    assert_eq!(result["isError"], false, "{tool}: {result}");
    serde_json::from_str(result["content"][0]["text"].as_str().unwrap()).unwrap()
}

#[test]
fn a_team_agent_reaches_the_ui_asks_permission_and_keeps_a_changed_model() {
    let fixture = fixture();
    let job_id = new_job(&fixture, JobMode::Team);
    wait_for_echo(&fixture.notices, "orchestrator");
    call_bus(
        &fixture.paths,
        &job_id,
        "spawn_agent",
        json!({
            "role": "builder", "name": "worker-1", "task": "ask permission", "kind": "build",
            "model": "claude-sonnet-5-5", "effort": "medium", "why": "A clear task.",
        }),
    );
    let worker_id = agents(&fixture.core, &job_id)
        .iter()
        .find(|row| row["name"] == "worker-1")
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();

    wait_for("the worker's permission request", || {
        fixture
            .notices
            .lock()
            .unwrap()
            .iter()
            .find_map(|notice| match notice {
                Notice::AgentEvent(p)
                    if p.agent_id == worker_id
                        && matches!(&p.event, StreamEvent::ControlRequest { request_id, .. } if request_id == "req_team") =>
                {
                    Some(())
                }
                _ => None,
            })
    });
    fixture
        .core
        .answer_permission(&worker_id, "req_team", &Decision::AllowOnce)
        .unwrap();
    wait_for_echo(&fixture.notices, "permission allow");

    call_bus(
        &fixture.paths,
        &job_id,
        "set_agent_model",
        json!({
            "name": "worker-1", "model": "claude-haiku-5-5", "effort": "low",
            "why": "A simple edit.",
        }),
    );
    let worker = agents(&fixture.core, &job_id)
        .into_iter()
        .find(|row| row["name"] == "worker-1")
        .unwrap();
    assert_eq!(worker["model"], "claude-haiku-5-5");
    assert_eq!(worker["effort"], "low");
    assert_eq!(worker["why"], "A simple edit.");
}

#[test]
fn a_team_agent_gets_a_config_with_only_the_headless_browser() {
    let fixture = fixture();
    let job_id = new_job(&fixture, JobMode::Team);
    wait_for_echo(&fixture.notices, "orchestrator");
    call_bus(
        &fixture.paths,
        &job_id,
        "spawn_agent",
        json!({
            "role": "builder", "name": "worker-1", "task": "open the page", "kind": "build",
            "model": "claude-sonnet-5-5", "effort": "medium", "why": "A clear task.",
        }),
    );
    let argv: Vec<String> = wait_for("the worker's start", || {
        echoes(&fixture.notices).iter().find_map(|text| {
            let echoed: Value = serde_json::from_str(text).ok()?;
            let argv: Vec<String> = echoed["argv"]
                .as_array()?
                .iter()
                .map(|a| a.as_str().unwrap().to_string())
                .collect();
            argv.contains(&"factory:builder".to_string()).then_some(argv)
        })
    });
    let at = argv.iter().position(|a| a == "--mcp-config").unwrap();
    let config: Value = serde_json::from_str(&std::fs::read_to_string(&argv[at + 1]).unwrap()).unwrap();
    assert_eq!(
        config,
        json!({"mcpServers": {"browser": {
            "command": "npx",
            "args": ["-y", "@playwright/mcp@0.0.86", "--headless", "--isolated", "--allow-unrestricted-file-access"],
        }}})
    );
}
