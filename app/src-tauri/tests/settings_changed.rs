use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::thread::sleep;
use std::time::Duration;

use factory_lib::commands::{Core, Emit, JobMode, NewJob, Notice, Paths};
use factory_lib::protocol::StreamEvent;
use tempfile::TempDir;

const FAKE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fake-claude.mjs");
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

fn inits(notices: &Notices, agent_id: &str) -> usize {
    notices
        .lock()
        .unwrap()
        .iter()
        .filter(|notice| {
            matches!(notice, Notice::AgentEvent(p)
                if p.agent_id == agent_id && matches!(p.event, StreamEvent::Init { .. }))
        })
        .count()
}

#[test]
fn settings_changed_turns_true_after_a_new_user_skill_and_false_after_a_restart() {
    std::env::set_var("FACTORY_CLAUDE_BIN", FAKE);
    let repo = TempDir::new().unwrap();
    let data = TempDir::new().unwrap();
    let local = TempDir::new().unwrap();
    let home = TempDir::new().unwrap();
    let claude_dir = home.path().join(".claude");
    std::fs::create_dir_all(&claude_dir).unwrap();
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
    let core = Core::open_with_dirs(paths, emit, claude_dir.clone()).unwrap();
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
    let agent = core.list_agents(&job_id).unwrap().remove(0);

    core.send_message(&agent.id, "hello").unwrap();
    wait_for("the first Init", || inits(&notices, &agent.id) >= 1);
    assert!(!core.settings_changed(&agent.id).unwrap());

    let skill = claude_dir.join("skills").join("fresh");
    std::fs::create_dir_all(&skill).unwrap();
    std::fs::write(
        skill.join("SKILL.md"),
        "---\nname: fresh\ndescription: A new skill\n---\nBody\n",
    )
    .unwrap();
    assert!(core.settings_changed(&agent.id).unwrap());

    let seen = inits(&notices, &agent.id);
    core.set_agent_model(&agent.id, &agent.model, &agent.effort)
        .unwrap();
    core.send_message(&agent.id, "again").unwrap();
    wait_for("the Init after the restart", || {
        inits(&notices, &agent.id) > seen
    });
    assert!(!core.settings_changed(&agent.id).unwrap());
}
