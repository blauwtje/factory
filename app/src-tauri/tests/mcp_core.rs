use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;

use factory_lib::commands::{Core, Emit, JobMode, NewJob, Paths};
use serde_json::json;
use tempfile::TempDir;

const FAKE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fake-claude.mjs");
const KIT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../kit");

fn git(dir: &Path, args: &[&str]) {
    let output = Command::new("git")
        .current_dir(dir)
        .args(["-c", "user.name=Test", "-c", "user.email=test@example.com"])
        .args(args)
        .output()
        .unwrap();
    assert!(output.status.success(), "git {args:?}: {output:?}");
}

#[test]
fn mcp_status_and_reconnect_reach_the_lead() {
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
    let emit: Emit = Arc::new(|_| {});
    let paths = Paths {
        data: data.path().into(),
        local: local.path().into(),
        kit: PathBuf::from(KIT),
    };
    let core = Core::open_with_dirs(paths, emit, claude_dir).unwrap();
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

    assert_eq!(
        core.mcp_status(&agent.id).unwrap(),
        json!([{ "name": "notes", "status": "failed", "error": "Connection closed" }])
    );

    core.mcp_reconnect(&agent.id, "ghost").unwrap();
    core.mcp_reconnect(&agent.id, "notes").unwrap();

    assert_eq!(
        core.mcp_status(&agent.id).unwrap(),
        json!([{ "name": "notes", "status": "connected" }])
    );
}
