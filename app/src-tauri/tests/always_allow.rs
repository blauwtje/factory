use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::thread::sleep;
use std::time::Duration;

use factory_lib::commands::{Core, Emit, JobMode, NewJob, Notice, Paths};
use factory_lib::permission::Decision;
use factory_lib::protocol::StreamEvent;
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

fn echoed(notices: &Notices, text: &str) -> bool {
    notices.lock().unwrap().iter().any(|notice| {
        matches!(notice, Notice::AgentEvent(p)
            if matches!(&p.event, StreamEvent::Assistant { content } if content.contains(text)))
    })
}

#[test]
fn always_allow_on_one_bash_command_does_not_allow_a_different_bash_command() {
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
    core.answer_permission(&agent_id, "r1", &Decision::AllowAlways)
        .unwrap();
    wait_for("the answer to ls", || echoed(&notices, "answered r1 allow"));

    core.send_message(&agent_id, "ask r2 rm -rf x").unwrap();
    wait_for("a prompt or an automatic answer for rm", || {
        asked(&notices, "r2") || echoed(&notices, "answered r2")
    });
    assert!(
        asked(&notices, "r2"),
        "rm -rf x was answered without a prompt"
    );
}
