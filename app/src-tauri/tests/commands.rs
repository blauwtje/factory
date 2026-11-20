use std::fs;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::thread::sleep;
use std::time::Duration;

use factory_lib::commands::{title_from, Core, Emit, JobMode, NewJob, Notice, Paths, Scope};
use factory_lib::permission::Decision;
use factory_lib::protocol::StreamEvent;
use factory_lib::worktree::{MergeForecast, MergeOutcome};
use serde_json::{json, Value};
use tempfile::TempDir;

const FAKE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fake-claude.mjs");
const KIT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../kit");

type Notices = Arc<Mutex<Vec<Notice>>>;

struct Fixture {
    _dirs: (TempDir, TempDir, TempDir, TempDir),
    transcripts: PathBuf,
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
    fixture_in(TempDir::new().unwrap())
}

fn fixture_in(local: TempDir) -> Fixture {
    std::env::set_var("FACTORY_CLAUDE_BIN", FAKE);
    let (repo, data, transcripts) = (
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
    let core = Core::open_with_transcripts(paths.clone(), emit, transcripts.path().into()).unwrap();
    Fixture {
        repo: repo.path().into(),
        transcripts: transcripts.path().into(),
        _dirs: (repo, data, local, transcripts),
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

fn listed(core: &Core, job_id: &str) -> Option<Value> {
    let jobs = serde_json::to_value(core.list_jobs().unwrap()).unwrap();
    jobs.as_array()
        .unwrap()
        .iter()
        .find(|job| job["id"] == job_id)
        .cloned()
}

fn status_of(core: &Core, job_id: &str) -> Value {
    listed(core, job_id).unwrap()["status"].clone()
}

fn wait_for_status(core: &Core, job_id: &str, status: &str) {
    wait_for(status, || (status_of(core, job_id) == status).then_some(()));
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
            Notice::Accounts(_) | Notice::Tokens(_) | Notice::StatsProgress(_) => None,
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

fn results(notices: &Notices) -> usize {
    notices
        .lock()
        .unwrap()
        .iter()
        .filter(|notice| {
            matches!(notice, Notice::AgentEvent(p) if matches!(p.event, StreamEvent::Result { .. }))
        })
        .count()
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

fn plan_ready(fixture: &Fixture, job_id: &str, build_model: &str, build_effort: &str) {
    call_bus(
        &fixture.paths,
        job_id,
        "plan_ready",
        json!({
            "path": "docs/specs/add-login.md",
            "build_model": build_model,
            "build_effort": build_effort,
            "why": "The plan is clear.",
        }),
    );
    wait_for_status(&fixture.core, job_id, "awaiting_approval");
}

fn job_branch(core: &Core, job_id: &str) -> String {
    listed(core, job_id).unwrap()["branch"]
        .as_str()
        .unwrap()
        .into()
}

#[test]
fn a_finished_session_whose_lead_ended_on_a_question_needs_a_reply_until_the_user_answers() {
    let fixture = fixture();
    let job_id = new_job(&fixture, JobMode::Solo);
    plan_ready(&fixture, &job_id, "claude-sonnet-5-5", "medium");
    fixture.core.approve_plan(&job_id).unwrap();
    wait_for_status(&fixture.core, &job_id, "done");
    assert_eq!(listed(&fixture.core, &job_id).unwrap()["needs_reply"], false);
    let session = agents(&fixture.core, &job_id).remove(0)["session_id"]
        .as_str()
        .unwrap()
        .to_string();
    fs::create_dir_all(fixture.transcripts.join("p")).unwrap();
    let transcript = fixture.transcripts.join("p").join(format!("{session}.jsonl"));
    let asked = json!({"type": "assistant", "message": {"content": [
        {"type": "text", "text": "Which database should it use? "}]}});
    fs::write(&transcript, format!("{asked}\n")).unwrap();
    assert_eq!(listed(&fixture.core, &job_id).unwrap()["needs_reply"], true);
    let answered = json!({"type": "user", "message": {"content": "Postgres"}});
    fs::write(&transcript, format!("{asked}\n{answered}\n")).unwrap();
    assert_eq!(listed(&fixture.core, &job_id).unwrap()["needs_reply"], false);
}

#[test]
fn a_solo_session_runs_from_the_dialog_to_a_branch_with_the_agents_commit() {
    let fixture = fixture();
    let job_id = new_job(&fixture, JobMode::Solo);
    let branch = job_branch(&fixture.core, &job_id);
    assert!(branch.starts_with("factory/add-login-"), "{branch}");
    let first = wait_for_echo(&fixture.notices, "Add login");
    let echoed: Value = serde_json::from_str(&first).unwrap();
    assert_eq!(echoed["text"], "Add login");
    for flag in [
        "solo-agent",
        "--mcp-config",
        "--plugin-dir",
        "/kit",
        "claude-opus-5-5",
    ] {
        assert!(first.contains(flag), "{flag} missing in {first}");
    }

    let planner = agents(&fixture.core, &job_id).remove(0);
    commit_file(
        Path::new(planner["worktree"].as_str().unwrap()),
        "login.txt",
    );
    plan_ready(&fixture, &job_id, "claude-sonnet-5-5", "medium");

    fixture.core.approve_plan(&job_id).unwrap();
    let rows = agents(&fixture.core, &job_id);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["id"], planner["id"]);
    assert_eq!(rows[0]["session_id"], planner["session_id"]);
    assert_eq!(rows[0]["model"], "claude-sonnet-5-5");
    assert_eq!(rows[0]["effort"], "medium");
    assert_eq!(rows[0]["why"], "The plan is clear.");
    let approved = wait_for_echo(&fixture.notices, "[plan approved]");
    assert!(approved.contains("docs/specs/add-login.md"), "{approved}");
    assert!(approved.contains("claude-sonnet-5-5"), "{approved}");
    wait_for_status(&fixture.core, &job_id, "done");

    let outcome = fixture.core.merge_job(&job_id).unwrap();
    assert!(
        matches!(outcome, MergeOutcome::Merged { .. }),
        "{outcome:?}"
    );
    assert!(fixture.repo.join("login.txt").is_file());
    assert_eq!(status_of(&fixture.core, &job_id), "merged");
}

#[test]
fn a_done_job_forecasts_its_merge_and_a_merged_job_is_cleaned_up_on_request() {
    let fixture = fixture();
    let job_id = new_job(&fixture, JobMode::Solo);
    wait_for_echo(&fixture.notices, "Add login");
    let planner = agents(&fixture.core, &job_id).remove(0);
    commit_file(
        Path::new(planner["worktree"].as_str().unwrap()),
        "login.txt",
    );
    plan_ready(&fixture, &job_id, "claude-sonnet-5-5", "medium");
    fixture.core.approve_plan(&job_id).unwrap();
    wait_for_status(&fixture.core, &job_id, "done");
    let branch = job_branch(&fixture.core, &job_id);

    assert_eq!(
        fixture.core.merge_forecast(&job_id).unwrap(),
        MergeForecast::Clean
    );
    assert!(!fixture.repo.join("login.txt").exists());
    assert!(fixture.core.clean_up_job(&job_id).is_err());

    fixture.core.merge_job(&job_id).unwrap();
    assert_eq!(listed(&fixture.core, &job_id).unwrap()["cleaned_up"], false);
    fixture.core.clean_up_job(&job_id).unwrap();

    assert_eq!(listed(&fixture.core, &job_id).unwrap()["cleaned_up"], true);
    assert_eq!(status_of(&fixture.core, &job_id), "merged");
    for row in agents(&fixture.core, &job_id) {
        assert!(!Path::new(row["worktree"].as_str().unwrap()).exists());
    }
    assert_eq!(git(&fixture.repo, &["branch", "--list", &branch]), "");
    assert!(fixture.repo.join("login.txt").is_file());
    let lead_id = agents(&fixture.core, &job_id)[0]["id"].as_str().unwrap().to_string();
    assert!(fixture.core.send_message(&lead_id, "again").is_err());
}

#[test]
fn job_changes_lists_the_branch_files_until_the_job_is_cleaned_up() {
    let fixture = fixture();
    let job_id = new_job(&fixture, JobMode::Solo);
    wait_for_echo(&fixture.notices, "Add login");
    let planner = agents(&fixture.core, &job_id).remove(0);
    commit_file(
        Path::new(planner["worktree"].as_str().unwrap()),
        "login.txt",
    );

    let changes =
        serde_json::to_value(fixture.core.job_changes(&job_id, &Scope::Branch).unwrap()).unwrap();
    assert_eq!(
        changes,
        json!([{
            "path": "login.txt",
            "old_path": null,
            "status": "Added",
            "binary": false,
            "before": "",
            "after": "login.txt\n",
        }])
    );

    plan_ready(&fixture, &job_id, "claude-sonnet-5-5", "medium");
    fixture.core.approve_plan(&job_id).unwrap();
    wait_for_status(&fixture.core, &job_id, "done");
    fixture.core.merge_job(&job_id).unwrap();
    fixture.core.clean_up_job(&job_id).unwrap();
    let refused = fixture
        .core
        .job_changes(&job_id, &Scope::Branch)
        .unwrap_err()
        .to_string();
    assert!(refused.contains("cleaned up"), "{refused}");
}

#[test]
fn job_scope_serves_uncommitted_and_single_commit_changes_and_refuses_an_unknown_sha() {
    let fixture = fixture();
    let job_id = new_job(&fixture, JobMode::Solo);
    wait_for_echo(&fixture.notices, "Add login");
    let lead = agents(&fixture.core, &job_id).remove(0);
    let worktree = Path::new(lead["worktree"].as_str().unwrap());
    commit_file(worktree, "login.txt");
    fs::write(worktree.join("draft.txt"), "draft\n").unwrap();

    let paths = |scope: Scope| -> Vec<String> {
        fixture
            .core
            .job_changes(&job_id, &scope)
            .unwrap()
            .into_iter()
            .map(|change| serde_json::to_value(change).unwrap()["path"].to_string())
            .collect()
    };
    assert_eq!(paths(Scope::Uncommitted), vec!["\"draft.txt\""]);

    let commits = serde_json::to_value(fixture.core.job_commits(&job_id).unwrap()).unwrap();
    assert_eq!(commits[0]["subject"], "add login.txt");
    assert_eq!(commits.as_array().unwrap().len(), 1);
    let sha = commits[0]["sha"].as_str().unwrap().to_string();
    assert_eq!(paths(Scope::Commit { sha }), vec!["\"login.txt\""]);

    let refused = fixture
        .core
        .job_changes(
            &job_id,
            &Scope::Commit {
                sha: "HEAD".into(),
            },
        )
        .unwrap_err()
        .to_string();
    assert!(refused.contains("HEAD"), "{refused}");
}

fn commit_text(dir: &Path, name: &str, text: &str) {
    fs::write(dir.join(name), text).unwrap();
    git(dir, &["add", name]);
    git(dir, &["commit", "-m", &format!("write {name}")]);
}

fn lead_worktree(core: &Core, job_id: &str) -> PathBuf {
    agents(core, job_id)[0]["worktree"].as_str().unwrap().into()
}

#[test]
fn overlap_lists_the_other_open_jobs_whose_branch_would_conflict() {
    let fixture = fixture();
    let first = new_job(&fixture, JobMode::Solo);
    let second = new_job(&fixture, JobMode::Solo);
    let quiet = new_job(&fixture, JobMode::Solo);
    commit_text(&lead_worktree(&fixture.core, &first), "base.txt", "first\n");
    commit_text(&lead_worktree(&fixture.core, &second), "base.txt", "second\n");
    commit_text(&lead_worktree(&fixture.core, &quiet), "quiet.txt", "quiet\n");

    let overlaps = serde_json::to_value(fixture.core.job_overlaps(&first).unwrap()).unwrap();
    assert_eq!(
        overlaps,
        json!([{ "job_id": second, "title": "Add login", "files": ["base.txt"] }])
    );
    let quiet_overlaps = serde_json::to_value(fixture.core.job_overlaps(&quiet).unwrap()).unwrap();
    assert_eq!(quiet_overlaps, json!([]));
}

#[test]
fn resolve_conflicts_asks_the_newest_lead_to_merge_and_refuses_a_clean_forecast() {
    let fixture = fixture();
    let job_id = new_job(&fixture, JobMode::Solo);
    wait_for_echo(&fixture.notices, "Add login");
    commit_text(&lead_worktree(&fixture.core, &job_id), "base.txt", "job\n");
    plan_ready(&fixture, &job_id, "claude-sonnet-5-5", "medium");
    fixture.core.approve_plan(&job_id).unwrap();
    wait_for_status(&fixture.core, &job_id, "done");

    let clean = fixture.core.resolve_conflicts(&job_id).unwrap_err().to_string();
    assert!(clean.contains("cleanly"), "{clean}");

    commit_text(&fixture.repo, "base.txt", "project\n");
    git(&fixture.repo, &["checkout", "-q", "--detach"]);
    let detached = fixture.core.resolve_conflicts(&job_id).unwrap_err().to_string();
    assert!(detached.contains("detached"), "{detached}");
    git(&fixture.repo, &["checkout", "-q", "-"]);

    fixture.core.resolve_conflicts(&job_id).unwrap();
    let base = git(&fixture.repo, &["branch", "--show-current"]);
    let sent = wait_for_echo(&fixture.notices, "would conflict in");
    let sent: Value = serde_json::from_str(&sent).unwrap();
    assert_eq!(
        sent["text"],
        format!(
            "Merging this branch into {base} would conflict in: base.txt. Run `git merge {base}` in your worktree, resolve every conflict, run the project's checks and commit the merge. Change nothing else.",
            base = base.trim()
        )
    );
}

fn alive(pid: &str) -> bool {
    Command::new("kill")
        .args(["-0", pid])
        .output()
        .unwrap()
        .status
        .success()
}

#[test]
fn merging_a_job_stops_its_lead_process() {
    let pids = TempDir::new().unwrap();
    std::env::set_var("FAKE_CLAUDE_PID_DIR", pids.path());
    let fixture = fixture();
    let job_id = new_job(&fixture, JobMode::Solo);
    wait_for_echo(&fixture.notices, "Add login");
    let planner = agents(&fixture.core, &job_id).remove(0);
    let worktree = fs::canonicalize(planner["worktree"].as_str().unwrap()).unwrap();
    commit_file(&worktree, "login.txt");
    plan_ready(&fixture, &job_id, "claude-sonnet-5-5", "medium");
    fixture.core.approve_plan(&job_id).unwrap();
    wait_for_echo(&fixture.notices, "[plan approved]");
    wait_for_status(&fixture.core, &job_id, "done");
    let leads: Vec<String> = fs::read_dir(pids.path())
        .unwrap()
        .map(|entry| entry.unwrap())
        .filter(|entry| fs::read_to_string(entry.path()).unwrap() == worktree.to_str().unwrap())
        .map(|entry| entry.file_name().into_string().unwrap())
        .collect();
    assert!(!leads.is_empty());

    let outcome = fixture.core.merge_job(&job_id).unwrap();
    assert!(
        matches!(outcome, MergeOutcome::Merged { .. }),
        "{outcome:?}"
    );

    sleep(Duration::from_secs(3));
    let running: Vec<&String> = leads.iter().filter(|pid| alive(pid)).collect();
    for pid in &running {
        Command::new("kill").arg(pid).output().unwrap();
    }
    assert!(
        running.is_empty(),
        "lead processes still running after merge: {running:?}"
    );
}

#[test]
fn an_interrupted_lead_turn_while_building_leaves_the_lead_waiting_and_the_job_building() {
    let fixture = fixture();
    let job_id = new_job(&fixture, JobMode::Solo);
    wait_for("the first result", || {
        (results(&fixture.notices) == 1).then_some(())
    });
    call_bus(
        &fixture.paths,
        &job_id,
        "plan_ready",
        json!({
            "path": "ask permission",
            "build_model": "claude-sonnet-5-5",
            "build_effort": "medium",
            "why": "The plan is clear.",
        }),
    );
    fixture.core.approve_plan(&job_id).unwrap();
    let lead_id = agents(&fixture.core, &job_id)[0]["id"]
        .as_str()
        .unwrap()
        .to_string();
    wait_for("the lead's permission request", || {
        fixture.notices.lock().unwrap().iter().find_map(|notice| {
            matches!(notice, Notice::AgentEvent(p) if matches!(p.event, StreamEvent::ControlRequest { .. }))
                .then_some(())
        })
    });

    fixture.core.interrupt_agent(&lead_id).unwrap();
    wait_for("the interrupted result", || {
        (results(&fixture.notices) == 2).then_some(())
    });
    assert_eq!(status_of(&fixture.core, &job_id), "building");
    assert!(fixture.core.merge_job(&job_id).is_err());
    assert_eq!(agents(&fixture.core, &job_id)[0]["status"], "waiting");

    fixture.core.send_message(&lead_id, "go on").unwrap();
    wait_for_status(&fixture.core, &job_id, "done");
}

#[test]
fn a_planning_job_whose_lead_process_dies_is_listed_as_failed_while_staying_planning() {
    let fixture = fixture();
    let job_id = new_job(&fixture, JobMode::Solo);
    wait_for("the first result", || {
        (results(&fixture.notices) == 1).then_some(())
    });
    let lead_id = agents(&fixture.core, &job_id)[0]["id"]
        .as_str()
        .unwrap()
        .to_string();

    fixture.core.send_message(&lead_id, "die").unwrap();
    wait_for("the failed flag", || {
        (listed(&fixture.core, &job_id).unwrap()["failed"] == true).then_some(())
    });
    assert_eq!(status_of(&fixture.core, &job_id), "planning");
}

#[test]
fn a_message_sent_during_a_lead_turn_keeps_the_lead_running_into_the_next_turn() {
    let fixture = fixture();
    let job_id = new_job(&fixture, JobMode::Solo);
    wait_for("the first result", || {
        (results(&fixture.notices) == 1).then_some(())
    });
    let lead_id = agents(&fixture.core, &job_id)[0]["id"]
        .as_str()
        .unwrap()
        .to_string();

    fixture.core.send_message(&lead_id, "hold").unwrap();
    fixture.core.send_message(&lead_id, "hold").unwrap();
    fixture.core.send_message(&lead_id, "release").unwrap();
    wait_for("the second turn's init", || {
        let notices = fixture.notices.lock().unwrap();
        let inits = notices.iter().filter(|notice| {
            matches!(notice, Notice::AgentEvent(p) if matches!(p.event, StreamEvent::Init { .. }))
        });
        (inits.count() == 2).then_some(())
    });
    assert_eq!(results(&fixture.notices), 2);
    assert_eq!(agents(&fixture.core, &job_id)[0]["status"], "running");
}

#[test]
fn two_messages_sent_during_a_lead_turn_share_one_next_turn() {
    let fixture = fixture();
    let job_id = new_job(&fixture, JobMode::Solo);
    wait_for("the first result", || {
        (results(&fixture.notices) == 1).then_some(())
    });
    let lead_id = agents(&fixture.core, &job_id)[0]["id"]
        .as_str()
        .unwrap()
        .to_string();

    for text in ["hold", "banana", "cherry", "release"] {
        fixture.core.send_message(&lead_id, text).unwrap();
    }
    wait_for("the shared turn's result", || {
        (results(&fixture.notices) == 3).then_some(())
    });
    wait_for("the lead to wait", || {
        (agents(&fixture.core, &job_id)[0]["status"] == "waiting").then_some(())
    });
}

#[test]
fn a_team_session_runs_with_a_worker_up_to_a_branch_with_both_commits() {
    let fixture = fixture();
    let job_id = new_job(&fixture, JobMode::Team);
    wait_for_echo(&fixture.notices, "orchestrator");

    call_bus(
        &fixture.paths,
        &job_id,
        "spawn_agent",
        json!({
            "role": "builder", "name": "worker-1", "task": "write the form", "kind": "build",
            "model": "claude-sonnet-5-5", "effort": "medium", "why": "A clear task.",
        }),
    );
    wait_for_echo(&fixture.notices, "worker-1 done");
    wait_for("the report turn", || {
        (results(&fixture.notices) >= 2).then_some(())
    });
    let rows = agents(&fixture.core, &job_id);
    assert_eq!(rows.len(), 2);
    let worker = rows.iter().find(|row| row["name"] == "worker-1").unwrap();
    assert_eq!(worker["why"], "A clear task.");
    assert_eq!(worker["status"], "done");

    let lead = rows.iter().find(|row| row["kind"] == "lead").unwrap();
    let job_worktree = Path::new(lead["worktree"].as_str().unwrap());
    let branch = job_branch(&fixture.core, &job_id);
    let slug = branch.trim_start_matches("factory/");
    commit_file(Path::new(worker["worktree"].as_str().unwrap()), "form.txt");
    git(
        job_worktree,
        &["merge", &format!("factory-agent/{slug}/worker-1")],
    );
    commit_file(job_worktree, "login.txt");
    plan_ready(&fixture, &job_id, "claude-opus-5-5", "medium");

    fixture.core.approve_plan(&job_id).unwrap();
    let lead = agents(&fixture.core, &job_id).remove(0);
    assert_eq!(lead["effort"], "medium");
    assert_eq!(lead["why"], "The plan is clear.");
    let approved = wait_for_echo(&fixture.notices, "[plan approved]");
    assert!(approved.contains("--resume"), "{approved}");
    wait_for_status(&fixture.core, &job_id, "done");

    let outcome = fixture.core.merge_job(&job_id).unwrap();
    assert!(
        matches!(outcome, MergeOutcome::Merged { .. }),
        "{outcome:?}"
    );
    assert!(fixture.repo.join("form.txt").is_file());
    assert!(fixture.repo.join("login.txt").is_file());
}

#[test]
fn a_reopened_app_resumes_the_lead_with_its_session() {
    let fixture = fixture();
    let job_id = new_job(&fixture, JobMode::Solo);
    wait_for("the first turn", || {
        (results(&fixture.notices) >= 1).then_some(())
    });
    wait_for("a waiting lead", || {
        (agents(&fixture.core, &job_id)[0]["status"] == "waiting").then_some(())
    });
    let lead = agents(&fixture.core, &job_id).remove(0);

    let (emit, notices) = collecting();
    let reopened = Core::open(fixture.paths.clone(), emit).unwrap();
    assert!(reopened.resume().is_empty());
    reopened
        .send_message(lead["id"].as_str().unwrap(), "continue")
        .unwrap();
    let echo = wait_for_echo(&notices, "continue");
    assert!(echo.contains("--resume"), "{echo}");
    assert!(
        echo.contains(lead["session_id"].as_str().unwrap()),
        "{echo}"
    );
}

#[test]
fn a_reopened_app_lets_the_orchestrator_read_an_existing_team_agent() {
    let fixture = fixture();
    let job_id = new_job(&fixture, JobMode::Team);
    wait_for_echo(&fixture.notices, "orchestrator");
    call_bus(
        &fixture.paths,
        &job_id,
        "spawn_agent",
        json!({
            "role": "builder", "name": "worker-1", "task": "write the form", "kind": "build",
            "model": "claude-sonnet-5-5", "effort": "medium", "why": "A clear task.",
        }),
    );
    wait_for_echo(&fixture.notices, "worker-1 done");

    let (emit, _notices) = collecting();
    let reopened = Core::open(fixture.paths.clone(), emit).unwrap();
    assert!(reopened.resume().is_empty());
    wait_for("the reopened bus", || {
        let config = fs::read_to_string(
            fixture
                .paths
                .data
                .join("jobs")
                .join(&job_id)
                .join("mcp.json"),
        )
        .ok()?;
        (!config.is_empty()).then_some(())
    });
    call_bus(
        &fixture.paths,
        &job_id,
        "read_agent",
        json!({"name": "worker-1"}),
    );
}

#[test]
fn a_reopened_app_resumes_an_unfinished_team_agent_with_its_session() {
    let fixture = fixture();
    let job_id = new_job(&fixture, JobMode::Team);
    wait_for_echo(&fixture.notices, "orchestrator");
    call_bus(
        &fixture.paths,
        &job_id,
        "spawn_agent",
        json!({
            "role": "builder", "name": "worker-1", "task": "hold", "kind": "build",
            "model": "claude-sonnet-5-5", "effort": "medium", "why": "A clear task.",
        }),
    );
    let worker = wait_for("the unfinished worker", || {
        agents(&fixture.core, &job_id)
            .into_iter()
            .find(|agent| agent["name"] == "worker-1" && agent["status"] == "running")
    });

    let (emit, notices) = collecting();
    let reopened = Core::open(fixture.paths.clone(), emit).unwrap();
    assert!(reopened.resume().is_empty());
    reopened
        .send_message(worker["id"].as_str().unwrap(), "continue")
        .unwrap();
    let session = worker["session_id"].as_str().unwrap();
    let echo = wait_for("the worker's own echo", || {
        echoes(&notices)
            .into_iter()
            .find(|text| text.contains("continue") && text.contains(session))
    });
    assert!(echo.contains("--resume"), "{echo}");
}

#[test]
fn events_and_outcomes_serialize_in_the_form_the_ui_reads() {
    let event = StreamEvent::Init {
        session_id: "s".into(),
        api_key_source: "none".into(),
        model: "m".into(),
    };
    assert_eq!(
        serde_json::to_value(event).unwrap(),
        json!({"Init": {"session_id": "s", "api_key_source": "none", "model": "m"}})
    );
    assert_eq!(
        serde_json::to_value(MergeOutcome::Conflict {
            files: vec!["a".into()]
        })
        .unwrap(),
        json!({"Conflict": {"files": ["a"]}})
    );
    let decision: Decision = serde_json::from_value(json!({"Deny": {"reason": "no"}})).unwrap();
    assert_eq!(
        decision,
        Decision::Deny {
            reason: "no".into()
        }
    );
}

#[test]
fn a_title_is_the_first_line_cut_at_a_word_within_sixty_characters() {
    assert_eq!(title_from("  Add login\nwith details"), "Add login");
    assert_eq!(title_from("\n  fix the bug"), "fix the bug");
    let long = "word ".repeat(20);
    assert_eq!(title_from(&long), "word ".repeat(12).trim_end());
    assert_eq!(title_from(&"x".repeat(80)), "x".repeat(60));
}

#[test]
fn a_session_without_a_prompt_is_refused() {
    let fixture = fixture();
    let error = fixture
        .core
        .create_job(NewJob {
            account_id: None,
            project_path: fixture.repo.clone(),
            prompt: "  \n".into(),
            mode: JobMode::Auto,
            model: None,
            effort: None,
            permission_mode: None,
        })
        .unwrap_err();
    assert!(error.to_string().contains("prompt"), "{error}");
}

#[test]
fn a_new_session_shows_its_prompt_before_the_transcript_has_it() {
    let fixture = fixture();
    let job_id = new_job(&fixture, JobMode::Auto);
    let lead = agents(&fixture.core, &job_id)[0]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let history = serde_json::to_value(fixture.core.agent_history(&lead).unwrap()).unwrap();
    assert_eq!(history, json!([{"User": {"text": "Add login"}}]));
}

#[test]
fn a_new_helper_shows_its_task_before_the_transcript_has_it() {
    let fixture = fixture();
    let job_id = new_job(&fixture, JobMode::Team);
    wait_for_echo(&fixture.notices, "orchestrator");
    call_bus(
        &fixture.paths,
        &job_id,
        "spawn_agent",
        json!({
            "role": "builder", "name": "worker-1", "task": "write the form", "kind": "build",
            "model": "claude-sonnet-5-5", "effort": "medium", "why": "A clear task.",
        }),
    );
    let rows = agents(&fixture.core, &job_id);
    let worker = rows.iter().find(|row| row["name"] == "worker-1").unwrap();
    let history = serde_json::to_value(
        fixture
            .core
            .agent_history(worker["id"].as_str().unwrap())
            .unwrap(),
    )
    .unwrap();
    assert_eq!(history, json!([{"User": {"text": "write the form"}}]));
}

#[test]
fn approving_a_plan_keeps_the_lead_and_its_session_and_shows_the_approval_in_its_history() {
    let fixture = fixture();
    let job_id = new_job(&fixture, JobMode::Team);
    wait_for_echo(&fixture.notices, "orchestrator");
    let before = agents(&fixture.core, &job_id);
    plan_ready(&fixture, &job_id, "claude-sonnet-5-5", "medium");
    fixture.core.approve_plan(&job_id).unwrap();
    let rows = agents(&fixture.core, &job_id);
    assert_eq!(rows.len(), before.len());
    let lead = rows.iter().find(|row| row["kind"] == "lead").unwrap();
    let kept = before.iter().find(|row| row["kind"] == "lead").unwrap();
    assert_eq!(lead["id"], kept["id"]);
    assert_eq!(lead["session_id"], kept["session_id"]);
    assert_eq!(lead["attempt"], 1);
    let approved = wait_for_echo(&fixture.notices, "[plan approved]");
    assert!(approved.contains("--resume"), "{approved}");
}

#[test]
fn a_new_job_without_a_mode_runs_in_auto() {
    let job: NewJob =
        serde_json::from_value(json!({"project_path": "/p", "prompt": "Add login"})).unwrap();
    assert_eq!(job.mode, JobMode::Auto);
}

#[test]
fn a_plain_folder_is_initialised_and_listed_newest_first() {
    for (key, value) in [
        ("GIT_AUTHOR_NAME", "Test"),
        ("GIT_AUTHOR_EMAIL", "test@example.com"),
        ("GIT_COMMITTER_NAME", "Test"),
        ("GIT_COMMITTER_EMAIL", "test@example.com"),
    ] {
        std::env::set_var(key, value);
    }
    let fixture = fixture();
    let plain = TempDir::new().unwrap();
    let start = |path: &Path| {
        fixture
            .core
            .create_job(NewJob {
                account_id: None,
                project_path: path.into(),
                prompt: "Add login".into(),
                mode: JobMode::Solo,
                model: None,
                effort: None,
                permission_mode: None,
            })
            .unwrap()
    };
    assert!(!start(&fixture.repo).initialized);
    assert!(start(plain.path()).initialized);
    assert_eq!(
        git(plain.path(), &["log", "--format=%s"]).trim(),
        "Initial commit"
    );
    let projects = serde_json::to_value(fixture.core.list_projects().unwrap()).unwrap();
    let paths: Vec<&str> = projects
        .as_array()
        .unwrap()
        .iter()
        .map(|project| project["path"].as_str().unwrap())
        .collect();
    assert_eq!(
        paths,
        [
            plain.path().to_str().unwrap(),
            fixture.repo.to_str().unwrap()
        ]
    );
    assert!(projects[0]["last_used"].as_i64().unwrap() > 0);
    assert_eq!(
        projects[0]["name"],
        plain.path().file_name().unwrap().to_str().unwrap()
    );
}

fn usage_line(session: &str, id: &str, input: i64, cache_read: i64, output: i64) -> String {
    json!({
        "type": "assistant", "sessionId": session, "requestId": format!("req_{id}"),
        "timestamp": "2026-01-01T10:00:01.000Z",
        "message": {"id": id, "model": "claude-opus-x", "content": [],
            "usage": {"input_tokens": input, "cache_creation_input_tokens": 0,
                "cache_read_input_tokens": cache_read, "output_tokens": output}}
    })
    .to_string()
}

#[test]
fn context_usage_of_a_stopped_lead_falls_back_to_its_newest_transcript_message() {
    let fixture = fixture();
    let job = new_job(&fixture, JobMode::Solo);
    wait_for_echo(&fixture.notices, "Add login");
    let lead = agents(&fixture.core, &job).remove(0);
    let (id, session) = (lead["id"].as_str().unwrap(), lead["session_id"].as_str().unwrap());
    let live = fixture.core.context_usage(id).unwrap();
    assert_eq!(live["maxTokens"], 200000);
    fs::write(
        fixture.transcripts.join(format!("{session}.jsonl")),
        usage_line(session, "m1", 10, 5000, 3) + "\n",
    )
    .unwrap();
    commit_file(Path::new(lead["worktree"].as_str().unwrap()), "login.txt");
    plan_ready(&fixture, &job, "claude-sonnet-5-5", "medium");
    fixture.core.approve_plan(&job).unwrap();
    wait_for_status(&fixture.core, &job, "done");
    fixture.core.merge_job(&job).unwrap();
    assert_eq!(
        fixture.core.context_usage(id).unwrap(),
        json!({"categories": [], "totalTokens": 5010, "maxTokens": 0})
    );
}

#[test]
fn the_roles_come_from_the_kit_frontmatter() {
    let roles = serde_json::to_value(fixture().core.kit().roles().unwrap()).unwrap();
    let roles = roles.as_array().unwrap();
    assert_eq!(roles.len(), 9);
    let builder = roles.iter().find(|role| role["name"] == "builder").unwrap();
    assert_eq!(builder["model"], "claude-sonnet-5-5");
    assert_eq!(builder["effort"], "medium");
    assert_eq!(
        builder["tools"],
        json!(["Read", "Edit", "Write", "Bash", "Glob", "Grep", "TaskStop", "mcp__browser"])
    );
    assert!(builder["description"]
        .as_str()
        .unwrap()
        .starts_with("Edits code or prose"));
}

#[test]
fn a_session_counts_its_own_uncached_tokens_and_announces_a_result() {
    let fixture = fixture();
    let job = new_job(&fixture, JobMode::Solo);
    wait_for("a result", || (results(&fixture.notices) > 0).then_some(()));
    let session = agents(&fixture.core, &job)[0]["session_id"]
        .as_str()
        .unwrap()
        .to_string();
    fs::write(
        fixture.transcripts.join(format!("{session}.jsonl")),
        [
            usage_line(&session, "m1", 10, 5000, 3),
            usage_line("other", "m2", 99, 99, 99),
        ]
        .join("\n")
            + "\n",
    )
    .unwrap();
    let tokens = serde_json::to_value(fixture.core.session_tokens(&job).unwrap()).unwrap();
    assert_eq!(tokens["total"]["uncached"], 13);
    assert_eq!(tokens["total"]["cache_read"], 5000);
    assert_eq!(tokens["agents"][0]["tokens"]["uncached"], 13);
    assert_eq!(
        tokens["agents"][0]["agent_id"],
        agents(&fixture.core, &job)[0]["id"]
    );
    assert!(fixture
        .notices
        .lock()
        .unwrap()
        .iter()
        .any(|notice| matches!(notice, Notice::Tokens(id) if *id == job)));
}

#[test]
fn claude_stats_indexes_in_the_background_and_reports_progress() {
    let fixture = fixture();
    fs::write(
        fixture.transcripts.join("a.jsonl"),
        usage_line("s1", "m1", 1, 0, 2) + "\n",
    )
    .unwrap();
    let first = fixture.core.claude_stats(None).unwrap();
    assert_eq!(first.stats.messages, 0);
    wait_for("finished progress", || {
        fixture
            .notices
            .lock()
            .unwrap()
            .iter()
            .find_map(|notice| match notice {
                Notice::StatsProgress(p) if p.files_done == 1 && p.files_total == 1 => Some(()),
                _ => None,
            })
    });
    let stats = serde_json::to_value(fixture.core.claude_stats(None).unwrap()).unwrap();
    assert_eq!(stats["total"]["uncached"], 3);
    assert_eq!(stats["sessions"], 1);
    assert_eq!(stats["progress"]["files_total"], 1);
}

#[test]
fn claude_info_reports_the_cli_and_serves_it_from_memory() {
    let fixture = fixture();
    let first = fixture.core.claude_info().unwrap();
    assert_eq!(first.version, "2.1.326");
    assert_eq!(fixture.core.claude_info().unwrap(), first);
}

fn finished_progress_count(notices: &Notices, total: usize) -> (usize, usize) {
    let seen: Vec<_> = notices
        .lock()
        .unwrap()
        .iter()
        .filter_map(|notice| match notice {
            Notice::StatsProgress(p) if p.files_total == total => Some(p.files_done),
            _ => None,
        })
        .collect();
    (
        seen.iter().filter(|done| **done < total).count(),
        seen.iter().filter(|done| **done == total).count(),
    )
}

#[test]
fn the_first_index_reports_progress_while_it_reads() {
    let fixture = fixture();
    for n in 0..20 {
        fs::write(
            fixture.transcripts.join(format!("f{n}.jsonl")),
            usage_line("s1", &format!("m{n}"), 1, 0, 1) + "\n",
        )
        .unwrap();
    }
    fixture.core.claude_stats(None).unwrap();
    wait_for("finished progress", || {
        (finished_progress_count(&fixture.notices, 20).1 > 0).then_some(())
    });
    assert!(finished_progress_count(&fixture.notices, 20).0 > 0);
}

#[test]
fn session_tokens_ignores_transcripts_of_other_sessions() {
    let fixture = fixture();
    let unreadable = fixture.transcripts.join("other.jsonl");
    fs::write(&unreadable, usage_line("other", "m1", 1, 0, 1) + "\n").unwrap();
    fs::set_permissions(&unreadable, fs::Permissions::from_mode(0o000)).unwrap();
    let result = fixture.core.session_tokens("no-such-job");
    fs::set_permissions(&unreadable, fs::Permissions::from_mode(0o644)).unwrap();
    assert!(result.is_ok(), "{result:?}");
}

#[test]
fn search_sessions_reads_new_transcript_text_and_names_the_job_and_agent() {
    let fixture = fixture();
    let job = new_job(&fixture, JobMode::Solo);
    let agent = agents(&fixture.core, &job)[0].clone();
    let session = agent["session_id"].as_str().unwrap();
    fs::write(
        fixture.transcripts.join(format!("{session}.jsonl")),
        json!({
            "type": "user", "sessionId": session, "timestamp": "2026-01-01T10:00:00.000Z",
            "message": {"role": "user", "content": "please frobnicate the widget"}
        })
        .to_string()
            + "\n",
    )
    .unwrap();
    let hits = serde_json::to_value(fixture.core.search_sessions("frobnic").unwrap()).unwrap();
    assert_eq!(
        hits,
        json!([{
            "job_id": job,
            "agent_id": agent["id"],
            "title": listed(&fixture.core, &job).unwrap()["title"],
            "role": "user",
            "text": "please frobnicate the widget",
            "snippet": "please frobnicate the widget",
            "seq": 0
        }])
    );
}

#[test]
fn searches_typed_quickly_all_succeed_while_the_transcript_grows() {
    let fixture = fixture();
    let job = new_job(&fixture, JobMode::Solo);
    let session = agents(&fixture.core, &job)[0]["session_id"]
        .as_str()
        .unwrap()
        .to_string();
    let transcript = fixture.transcripts.join(format!("{session}.jsonl"));
    let line = |n: usize| {
        json!({
            "type": "user", "sessionId": session, "timestamp": "2026-01-01T10:00:00.000Z",
            "message": {"role": "user", "content": format!("pelikaan number {n}")}
        })
        .to_string()
            + "\n"
    };
    let query = "pelikaan";
    let searches: Vec<_> = (1..=query.len())
        .map(|typed| {
            let core = Arc::clone(&fixture.core);
            let transcript = transcript.clone();
            let lines: String = (0..200).map(|n| line(typed * 1000 + n)).collect();
            std::thread::spawn(move || {
                fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&transcript)
                    .unwrap()
                    .write_all(lines.as_bytes())
                    .unwrap();
                core.search_sessions(&query[..typed]).map(|_| ())
            })
        })
        .collect();
    let failures: Vec<_> = searches
        .into_iter()
        .filter_map(|search| search.join().unwrap().err())
        .map(|error| format!("{error:?}"))
        .collect();
    assert!(failures.is_empty(), "{failures:?}");
}

#[test]
fn an_archived_session_is_listed_as_archived_until_it_is_unarchived() {
    let fixture = fixture();
    let job_id = new_job(&fixture, JobMode::Solo);
    let archived = || listed(&fixture.core, &job_id).unwrap()["archived"].clone();
    assert_eq!(archived(), false);
    fixture.core.archive_job(&job_id, true).unwrap();
    assert_eq!(archived(), true);
    fixture.core.archive_job(&job_id, false).unwrap();
    assert_eq!(archived(), false);
}

#[test]
fn a_pinned_session_is_listed_as_pinned_until_it_is_unpinned() {
    let fixture = fixture();
    let job_id = new_job(&fixture, JobMode::Solo);
    let pinned = || listed(&fixture.core, &job_id).unwrap()["pinned"].clone();
    assert_eq!(pinned(), false);
    fixture.core.pin_job(&job_id, true).unwrap();
    assert_eq!(pinned(), true);
    fixture.core.pin_job(&job_id, false).unwrap();
    assert_eq!(pinned(), false);
}

#[test]
fn a_renamed_session_is_listed_with_its_first_line_cut_to_sixty_characters() {
    let fixture = fixture();
    let job_id = new_job(&fixture, JobMode::Solo);
    let long = "word ".repeat(20);
    fixture
        .core
        .rename_job(&job_id, &format!("\n  {long}\nsecond line"))
        .unwrap();
    let title = listed(&fixture.core, &job_id).unwrap()["title"].clone();
    assert_eq!(title, "word ".repeat(12).trim_end());
}

#[test]
fn a_session_renamed_to_blank_text_keeps_its_title_and_is_refused() {
    let fixture = fixture();
    let job_id = new_job(&fixture, JobMode::Solo);
    let before = listed(&fixture.core, &job_id).unwrap()["title"].clone();
    let error = fixture.core.rename_job(&job_id, " \n\t ").unwrap_err();
    assert_eq!(error.to_string(), "a session needs a title");
    assert_eq!(listed(&fixture.core, &job_id).unwrap()["title"], before);
}

#[test]
fn resume_command_quotes_the_worktree_and_flags_a_running_lead() {
    let fixture = fixture_in(tempfile::Builder::new().prefix("it's").tempdir().unwrap());
    let job_id = new_job(&fixture, JobMode::Solo);
    let lead = agents(&fixture.core, &job_id).remove(0);
    let worktree = lead["worktree"].as_str().unwrap();
    assert!(worktree.contains('\''), "{worktree}");

    let resume = serde_json::to_value(fixture.core.resume_command(&job_id).unwrap()).unwrap();

    assert_eq!(
        resume,
        json!({
            "command": format!(
                "cd '{}' && claude --resume {}",
                worktree.replace('\'', "'\\''"),
                lead["session_id"].as_str().unwrap()
            ),
            "running": true
        })
    );
}

#[test]
fn the_permission_modes_come_from_claude() {
    let fixture = fixture();
    assert_eq!(fixture.core.permission_modes().unwrap(), ["acceptEdits", "plan"]);
}

#[test]
fn a_rejected_permission_mode_is_not_stored() {
    let fixture = fixture();
    let job_id = new_job(&fixture, JobMode::Solo);
    wait_for_echo(&fixture.notices, "Add login");
    let lead = agents(&fixture.core, &job_id).remove(0);
    let lead_id = lead["id"].as_str().unwrap();
    assert!(fixture.core.set_permission_mode(lead_id, "invalid").is_err());
    assert_eq!(agents(&fixture.core, &job_id)[0]["permission_mode"], "");
}

#[test]
fn a_lead_keeps_its_permission_mode_in_its_row_and_across_a_restart() {
    let fixture = fixture();
    let job_id = new_job(&fixture, JobMode::Solo);
    wait_for_echo(&fixture.notices, "Add login");
    let lead = agents(&fixture.core, &job_id).remove(0);
    let lead_id = lead["id"].as_str().unwrap();
    assert_eq!(lead["permission_mode"], "");
    fixture.core.set_permission_mode(lead_id, "manual").unwrap();
    assert_eq!(agents(&fixture.core, &job_id)[0]["permission_mode"], "manual");
    fixture
        .core
        .set_agent_model(lead_id, "claude-sonnet-5-5", "medium")
        .unwrap();
    fixture.core.send_message(lead_id, "again").unwrap();
    let echoed = wait_for_echo(&fixture.notices, "again");
    let argv: Value = serde_json::from_str(&echoed).unwrap();
    let argv: Vec<&str> = argv["argv"]
        .as_array()
        .unwrap()
        .iter()
        .map(|arg| arg.as_str().unwrap())
        .collect();
    assert!(argv.windows(2).any(|w| w == ["--permission-mode", "manual"]), "{argv:?}");
}

#[test]
fn a_new_job_starts_its_lead_in_the_chosen_permission_mode() {
    let fixture = fixture();
    let job_id = fixture
        .core
        .create_job(NewJob {
            account_id: None,
            project_path: fixture.repo.clone(),
            prompt: "Add login".into(),
            mode: JobMode::Solo,
            model: None,
            effort: None,
            permission_mode: Some("plan".into()),
        })
        .unwrap()
        .id;
    let echoed = wait_for_echo(&fixture.notices, "Add login");
    let argv: Value = serde_json::from_str(&echoed).unwrap();
    let argv: Vec<&str> = argv["argv"]
        .as_array()
        .unwrap()
        .iter()
        .map(|arg| arg.as_str().unwrap())
        .collect();
    assert!(argv.windows(2).any(|w| w == ["--permission-mode", "plan"]), "{argv:?}");
    assert_eq!(agents(&fixture.core, &job_id)[0]["permission_mode"], "plan");
}

#[test]
fn the_default_permission_mode_comes_from_claude_settings() {
    let (data, local, claude) = (TempDir::new().unwrap(), TempDir::new().unwrap(), TempDir::new().unwrap());
    let paths = Paths {
        data: data.path().into(),
        local: local.path().into(),
        kit: KIT.into(),
    };
    let (emit, _) = collecting();
    let core = Core::open_with_dirs(paths, emit, claude.path().into()).unwrap();
    assert_eq!(core.claude_permission_mode(), "");
    fs::write(claude.path().join("settings.json"), r#"{"permissions":{"defaultMode":"bypassPermissions"}}"#).unwrap();
    assert_eq!(core.claude_permission_mode(), "bypassPermissions");
    fs::write(claude.path().join("settings.json"), r#"{"permissions":{"defaultMode":"default"}}"#).unwrap();
    assert_eq!(core.claude_permission_mode(), "manual");
}

#[test]
fn an_open_permission_request_comes_back_with_the_history() {
    let fixture = fixture();
    let job_id = new_job(&fixture, JobMode::Solo);
    wait_for_echo(&fixture.notices, "Add login");
    let lead_id = agents(&fixture.core, &job_id)[0]["id"]
        .as_str()
        .unwrap()
        .to_string();
    fixture.core.send_message(&lead_id, "ask permission").unwrap();
    wait_for("the lead's permission request", || {
        fixture.notices.lock().unwrap().iter().find_map(|notice| {
            matches!(notice, Notice::AgentEvent(p) if matches!(p.event, StreamEvent::ControlRequest { .. }))
                .then_some(())
        })
    });
    let history = serde_json::to_value(fixture.core.agent_history(&lead_id).unwrap()).unwrap();
    assert_eq!(
        history.as_array().unwrap().last().unwrap()["Event"]["ControlRequest"]["request_id"],
        "req_team"
    );
}

#[test]
fn resume_command_names_the_newest_lead_and_refuses_a_cleaned_up_session() {
    let fixture = fixture();
    let job_id = new_job(&fixture, JobMode::Solo);
    wait_for_echo(&fixture.notices, "Add login");
    let planner = agents(&fixture.core, &job_id).remove(0);
    commit_file(Path::new(planner["worktree"].as_str().unwrap()), "login.txt");
    plan_ready(&fixture, &job_id, "claude-sonnet-5-5", "medium");
    fixture.core.approve_plan(&job_id).unwrap();
    wait_for_status(&fixture.core, &job_id, "done");
    fixture.core.merge_job(&job_id).unwrap();
    let builder = agents(&fixture.core, &job_id).remove(0);

    let resume = serde_json::to_value(fixture.core.resume_command(&job_id).unwrap()).unwrap();
    assert_eq!(
        resume,
        json!({
            "command": format!(
                "cd '{}' && claude --resume {}",
                builder["worktree"].as_str().unwrap(),
                builder["session_id"].as_str().unwrap()
            ),
            "running": false
        })
    );

    fixture.core.clean_up_job(&job_id).unwrap();
    let error = fixture.core.resume_command(&job_id).unwrap_err();
    assert_eq!(
        error.to_string(),
        "the worktree of this session was cleaned up, so it cannot be resumed"
    );
}

fn lines(text: String) -> Vec<String> {
    let mut lines: Vec<String> = text.lines().map(String::from).collect();
    lines.sort();
    lines
}

#[test]
fn deleting_a_session_removes_only_its_own_worktrees_branches_and_rows() {
    let fixture = fixture();
    git(&fixture.repo, &["branch", "keep"]);
    let main = git(&fixture.repo, &["branch", "--show-current"]).trim().to_string();
    let kept = new_job(&fixture, JobMode::Solo);
    let job_id = new_job(&fixture, JobMode::Team);
    wait_for_echo(&fixture.notices, "orchestrator");
    call_bus(
        &fixture.paths,
        &job_id,
        "spawn_agent",
        json!({
            "role": "builder", "name": "worker-1", "task": "write the form", "kind": "build",
            "model": "claude-sonnet-5-5", "effort": "medium", "why": "A clear task.",
        }),
    );
    wait_for_echo(&fixture.notices, "worker-1 done");
    let worktrees: Vec<PathBuf> = agents(&fixture.core, &job_id)
        .iter()
        .map(|row| PathBuf::from(row["worktree"].as_str().unwrap()))
        .collect();
    assert_eq!(worktrees.len(), 2);
    fs::write(worktrees[1].join("draft.txt"), "unsaved\n").unwrap();

    let job_dir = fixture.paths.data.join("jobs").join(&job_id);
    assert!(job_dir.is_dir());

    fixture.core.delete_job(&job_id).unwrap();

    assert!(listed(&fixture.core, &job_id).is_none());
    assert!(!job_dir.exists());
    assert!(fixture.core.list_agents(&job_id).unwrap().is_empty());
    for worktree in &worktrees {
        assert!(!worktree.exists(), "{} is left", worktree.display());
    }
    let kept_worktree = agents(&fixture.core, &kept)[0]["worktree"].clone();
    assert!(Path::new(kept_worktree.as_str().unwrap()).join("base.txt").is_file());
    assert!(fixture.repo.join("base.txt").is_file());
    assert_eq!(
        lines(git(&fixture.repo, &["branch", "--format=%(refname:short)"])),
        lines(format!("{main}\nkeep\n{}", job_branch(&fixture.core, &kept)))
    );
    let listed_worktrees = git(&fixture.repo, &["worktree", "list", "--porcelain"]);
    assert_eq!(
        listed_worktrees
            .lines()
            .filter(|line| line.starts_with("worktree "))
            .count(),
        2,
        "{listed_worktrees}"
    );
}

#[test]
fn attachments_are_saved_in_the_folder_every_agent_may_read() {
    let fixture = fixture();
    new_job(&fixture, JobMode::Solo);
    let first: Value = serde_json::from_str(&wait_for_echo(&fixture.notices, "Add login")).unwrap();
    let argv: Vec<&str> = first["argv"]
        .as_array()
        .unwrap()
        .iter()
        .map(|arg| arg.as_str().unwrap())
        .collect();
    let at = argv.iter().position(|arg| *arg == "--add-dir").unwrap();
    let folder = fixture.paths.data.join("attachments");
    assert_eq!(argv[at + 1], folder.to_str().unwrap());

    let pasted = fixture.core.save_attachment("shot.png", "aGVsbG8=").unwrap();
    assert_eq!(pasted.name, "shot.png");
    assert!(pasted.path.starts_with(&folder));
    assert_eq!(fs::read_to_string(&pasted.path).unwrap(), "hello");

    let dropped = fixture.core.attach_path(&fixture.repo.join("base.txt")).unwrap();
    assert_eq!(dropped.name, "base.txt");
    assert!(dropped.path.starts_with(&folder));
    assert_eq!(fs::read_to_string(&dropped.path).unwrap(), "base.txt\n");
}
