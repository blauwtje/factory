use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::thread::sleep;
use std::time::Duration;

use factory_lib::audit::{self, AuditEntry};
use factory_lib::commands::{Core, Emit, JobMode, NewJob, Notice, Paths};
use factory_lib::permission::Decision;
use factory_lib::protocol::StreamEvent;
use factory_lib::store::Store;
use serde_json::json;
use tempfile::TempDir;

const FAKE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/ask-claude.mjs");
const KIT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../kit");

type Notices = Arc<Mutex<Vec<Notice>>>;

fn git(dir: &Path, args: &[&str]) {
    let output = Command::new("git")
        .current_dir(dir)
        .args(["-c", "user.name=Test", "-c", "user.email=test@example.com"])
        .args(args)
        .output()
        .unwrap();
    assert!(output.status.success(), "git {args:?}: {output:?}");
}

fn wait_for(what: &str, mut seen: impl FnMut() -> bool) {
    for _ in 0..50 {
        if seen() {
            return;
        }
        sleep(Duration::from_millis(100));
    }
    panic!("never saw {what}");
}

fn asked(notices: &Notices, id: &str) -> bool {
    notices.lock().unwrap().iter().any(|notice| {
        matches!(notice, Notice::AgentEvent(p)
            if matches!(&p.event, StreamEvent::ControlRequest { request_id, .. } if request_id == id))
    })
}

#[test]
fn each_permission_answer_is_logged_for_its_project_newest_first() {
    std::env::set_var("FACTORY_CLAUDE_BIN", FAKE);
    let repo = TempDir::new().unwrap();
    let data = TempDir::new().unwrap();
    let local = TempDir::new().unwrap();
    git(repo.path(), &["init", "-q"]);
    std::fs::write(repo.path().join("base.txt"), "base\n").unwrap();
    git(repo.path(), &["add", "base.txt"]);
    git(repo.path(), &["commit", "-m", "base"]);
    let notices = Notices::default();
    let sink = Arc::clone(&notices);
    let emit: Emit = Arc::new(move |notice| sink.lock().unwrap().push(notice));
    let paths = Paths {
        data: data.path().into(),
        local: local.path().into(),
        kit: PathBuf::from(KIT),
    };
    let core = Core::open(paths, emit).unwrap();
    let job_id = core
        .create_job(NewJob {
            account_id: None,
            project_path: repo.path().into(),
            prompt: "Add login".into(),
            mode: JobMode::Solo,
            model: None,
            effort: None,
            permission_mode: None,
        })
        .unwrap()
        .id;
    let agent_id = core.list_agents(&job_id).unwrap().remove(0).id;

    core.send_message(&agent_id, "ask r1 ls").unwrap();
    wait_for("the prompt for ls", || asked(&notices, "r1"));
    core.answer_permission(&agent_id, "r1", &Decision::AllowOnce)
        .unwrap();
    core.send_message(&agent_id, "ask r2 rm -rf x").unwrap();
    wait_for("the prompt for rm", || asked(&notices, "r2"));
    core.answer_permission(
        &agent_id,
        "r2",
        &Decision::Deny {
            reason: "too risky".into(),
        },
    )
    .unwrap();

    let log = core.permission_log(Some(repo.path())).unwrap();
    let rows: Vec<_> = log
        .iter()
        .map(|entry| {
            (
                entry.job_id.as_str(),
                entry.agent_id.as_str(),
                entry.tool_name.as_str(),
                entry.input.clone(),
                entry.decision.as_str(),
                entry.reason.as_deref(),
            )
        })
        .collect();
    assert_eq!(
        rows,
        vec![
            (
                job_id.as_str(),
                agent_id.as_str(),
                "Bash",
                json!({"command": "rm -rf x"}),
                "deny",
                Some("too risky"),
            ),
            (
                job_id.as_str(),
                agent_id.as_str(),
                "Bash",
                json!({"command": "ls"}),
                "allow_once",
                None,
            ),
        ]
    );
    assert!(log.iter().all(|entry| entry.time > 0));

    let unknown = TempDir::new().unwrap();
    assert!(core
        .permission_log(Some(unknown.path()))
        .unwrap()
        .is_empty());
}

#[test]
fn without_a_project_the_log_merges_every_project_newest_first() {
    let data = TempDir::new().unwrap();
    let local = TempDir::new().unwrap();
    let emit: Emit = Arc::new(|_| {});
    let paths = Paths {
        data: data.path().into(),
        local: local.path().into(),
        kit: PathBuf::from(KIT),
    };
    let core = Core::open(paths, emit).unwrap();
    let mut repos = Vec::new();
    for (time, name) in [(10, "first"), (30, "second"), (20, "third")] {
        let repo = TempDir::new().unwrap();
        git(repo.path(), &["init", "-q"]);
        std::fs::write(repo.path().join("base.txt"), name).unwrap();
        git(repo.path(), &["add", "base.txt"]);
        git(repo.path(), &["commit", "-m", "base"]);
        std::env::set_var("FACTORY_CLAUDE_BIN", FAKE);
        let job = core
            .create_job(NewJob {
                account_id: None,
                project_path: repo.path().into(),
                prompt: name.into(),
                mode: JobMode::Solo,
                model: None,
                effort: None,
                permission_mode: None,
            })
            .unwrap();
        let project = Store::open(&data.path().join("factory.db"))
            .unwrap()
            .projects()
            .unwrap()
            .into_iter()
            .find(|project| project.path == repo.path())
            .unwrap();
        let entry = AuditEntry::new(
            &job.id,
            "lead",
            "Bash",
            json!({}),
            &Decision::AllowOnce,
            time,
        );
        let file = data
            .path()
            .join("audit")
            .join(format!("{}.jsonl", project.id));
        audit::append(&file, &entry).unwrap();
        repos.push(repo);
    }
    let merged: Vec<_> = core
        .permission_log(None)
        .unwrap()
        .iter()
        .map(|e| e.time)
        .collect();
    assert_eq!(merged, vec![30, 20, 10]);
}
