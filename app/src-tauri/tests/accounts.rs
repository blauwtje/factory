use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::thread::sleep;
use std::time::Duration;

use factory_lib::accounts::{
    apply_rate_limits, folder_account, merged, parse_usage, plan_name, Account, UsageLimit,
};
use factory_lib::commands::{Core, Emit, JobMode, NewJob, Notice, Paths};
use factory_lib::protocol::{StreamEvent, Window};
use factory_lib::store::AccountRow;
use serde_json::{json, Value};
use tempfile::TempDir;

const FAKE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fake-claude.mjs");
const KIT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../kit");

type Notices = Arc<Mutex<Vec<Notice>>>;

struct Fixture {
    home: TempDir,
    repo: TempDir,
    _data: TempDir,
    _local: TempDir,
    paths: Paths,
    core: Arc<Core>,
    notices: Notices,
}

impl Fixture {
    fn claude_dir(&self) -> PathBuf {
        self.home.path().join(".claude")
    }

    fn profile(&self, name: &str) -> PathBuf {
        let home = self
            .home
            .path()
            .join("Library/Application Support/orca/claude-profiles")
            .join(name)
            .join("home");
        fs::create_dir_all(&home).unwrap();
        home
    }

    fn reopen(&self) -> Arc<Core> {
        let (emit, _) = collecting();
        Core::open_with_dirs(self.paths.clone(), emit, self.claude_dir()).unwrap()
    }
}

fn git(dir: &Path, args: &[&str]) {
    let output = Command::new("git")
        .current_dir(dir)
        .args(["-c", "user.name=Test", "-c", "user.email=test@example.com"])
        .args(args)
        .output()
        .unwrap();
    assert!(output.status.success(), "git {args:?}: {output:?}");
}

fn collecting() -> (Emit, Notices) {
    let notices = Notices::default();
    let sink = Arc::clone(&notices);
    let emit: Emit = Arc::new(move |notice| sink.lock().unwrap().push(notice));
    (emit, notices)
}

fn fixture() -> Fixture {
    std::env::set_var("FACTORY_CLAUDE_BIN", FAKE);
    let (home, repo, data, local) = (
        TempDir::new().unwrap(),
        TempDir::new().unwrap(),
        TempDir::new().unwrap(),
        TempDir::new().unwrap(),
    );
    git(repo.path(), &["init", "-q"]);
    fs::write(repo.path().join("base.txt"), "base\n").unwrap();
    git(repo.path(), &["add", "base.txt"]);
    git(repo.path(), &["commit", "-m", "add base"]);
    let paths = Paths {
        data: data.path().into(),
        local: local.path().into(),
        kit: KIT.into(),
    };
    let (emit, notices) = collecting();
    let core = Core::open_with_dirs(paths.clone(), emit, home.path().join(".claude")).unwrap();
    Fixture {
        home,
        repo,
        _data: data,
        _local: local,
        paths,
        core,
        notices,
    }
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

fn new_job(fixture: &Fixture, prompt: &str, account_id: Option<&str>) -> String {
    fixture
        .core
        .create_job(NewJob {
            account_id: account_id.map(String::from),
            project_path: fixture.repo.path().into(),
            prompt: prompt.into(),
            mode: JobMode::Solo,
            model: None,
            effort: None,
            permission_mode: None,
        })
        .unwrap()
        .id
}

fn account<'a>(accounts: &'a [Account], id: &str) -> &'a Account {
    accounts.iter().find(|account| account.id == id).unwrap()
}

fn row(fixture: &Fixture, job_id: &str) -> Value {
    let jobs = serde_json::to_value(fixture.core.list_jobs().unwrap()).unwrap();
    jobs.as_array()
        .unwrap()
        .iter()
        .find(|job| job["id"] == job_id)
        .cloned()
        .unwrap()
}

fn echoed_config_dir(fixture: &Fixture, job_id: &str) -> Value {
    wait_for("the echo of the first message", || {
        fixture
            .notices
            .lock()
            .unwrap()
            .iter()
            .find_map(|notice| match notice {
                Notice::AgentEvent(payload) if payload.job_id == job_id => match &payload.event {
                    StreamEvent::Assistant { content } => {
                        serde_json::from_str::<Value>(content).ok()
                    }
                    _ => None,
                },
                _ => None,
            })
    })["configDir"]
        .clone()
}

fn usage_line(session: &str, input: i64, cache_read: i64) -> String {
    json!({
        "type": "assistant", "sessionId": session, "requestId": "r1",
        "timestamp": "2026-01-01T00:00:00.000Z", "cwd": "~/code/app",
        "message": {"id": "m1", "model": "claude-opus-x", "content": [],
            "usage": {"input_tokens": input, "cache_creation_input_tokens": 7,
                "cache_read_input_tokens": cache_read, "output_tokens": 1}}
    })
    .to_string()
}

fn limit_kinds(account: &Account) -> Vec<(&str, &str)> {
    account
        .limits
        .iter()
        .map(|limit| (limit.kind.as_str(), limit.label.as_str()))
        .collect()
}

#[test]
fn get_usage_becomes_limits_with_plain_labels_and_unix_reset_times() {
    let response = json!({"subscription_type": "max", "rate_limits": {"limits": [
        {"kind": "session", "percent": 36, "severity": "normal",
         "resets_at": "2026-11-20T15:00:00+02:00", "scope": null, "is_active": false},
        {"kind": "weekly_all", "percent": 55, "severity": "warning",
         "resets_at": "2026-11-20T13:00:00.076020+00:00", "scope": null, "is_active": true},
        {"kind": "weekly_scoped", "percent": 35, "severity": "normal", "resets_at": null,
         "scope": {"model": {"id": null, "display_name": "Fable"}, "surface": null},
         "is_active": false},
        {"kind": "extra_usage", "percent": 1, "severity": "normal", "resets_at": null,
         "scope": null, "is_active": false}
    ]}});
    let usage = parse_usage(&response).unwrap();
    assert_eq!(usage.plan.as_deref(), Some("max"));
    let labels: Vec<&str> = usage
        .limits
        .iter()
        .map(|limit| limit.label.as_str())
        .collect();
    assert_eq!(labels, ["5-hour", "Weekly", "Fable weekly", "Extra usage"]);
    assert_eq!(usage.limits[0].resets_at, Some(1_795_179_600));
    assert_eq!(usage.limits[1].resets_at, Some(1_795_179_600));
    assert_eq!(usage.limits[2].resets_at, None);
    assert_eq!(
        (usage.limits[1].percent, usage.limits[1].active),
        (55.0, true)
    );
    assert_eq!(usage.limits[1].severity, "warning");
}

#[test]
fn an_account_without_a_session_limit_has_no_five_hour_limit() {
    let response = json!({"subscription_type": "max", "rate_limits": {"limits": [
        {"kind": "weekly_all", "percent": 12, "severity": "normal", "resets_at": null,
         "scope": null, "is_active": true}
    ]}});
    let usage = parse_usage(&response).unwrap();
    assert!(usage.limits.iter().all(|limit| limit.label != "5-hour"));
    assert!(parse_usage(&json!({})).is_err());
}

#[test]
fn a_rate_limit_event_updates_the_matching_limit_and_adds_a_missing_one() {
    let limit = |kind: &str, percent: f64| UsageLimit {
        kind: kind.into(),
        label: "Weekly".into(),
        percent,
        resets_at: Some(1),
        severity: "normal".into(),
        active: true,
    };
    let mut limits = vec![limit("weekly_all", 10.0)];
    let windows = BTreeMap::from([
        (
            "seven_day".into(),
            Window {
                utilization: 0.5,
                resets_at: 200,
            },
        ),
        (
            "five_hour".into(),
            Window {
                utilization: 0.25,
                resets_at: 100,
            },
        ),
    ]);
    apply_rate_limits(&mut limits, &windows);
    assert_eq!((limits[0].percent, limits[0].resets_at), (50.0, Some(200)));
    assert_eq!(
        (limits[1].label.as_str(), limits[1].percent),
        ("5-hour", 25.0)
    );
}

#[test]
fn a_refresh_finds_every_login_and_probes_each_with_its_own_config_dir() {
    let fixture = fixture();
    fixture.profile("ultra");
    fixture.core.refresh_accounts_now();
    let accounts = fixture.core.list_accounts().unwrap();
    assert_eq!(accounts.len(), 2);
    let default = account(&accounts, "default");
    assert_eq!(default.label, "default@example.com");
    assert_eq!(default.plan.as_deref(), Some("Max"));
    assert!(default.is_default && !default.refreshing && default.updated_at.is_some());
    assert_eq!(
        limit_kinds(default),
        [("session", "5-hour"), ("weekly_all", "Weekly")]
    );
    let ultra = accounts
        .iter()
        .find(|account| account.id != "default")
        .unwrap();
    assert_eq!(ultra.email.as_deref(), Some("ultra@example.com"));
    assert_eq!(
        limit_kinds(ultra),
        [("weekly_all", "Weekly"), ("weekly_scoped", "Fable weekly")]
    );
    let announced = fixture.notices.lock().unwrap().iter().any(|notice| {
        matches!(notice, Notice::Accounts(all) if all.len() == 2 && all.iter().all(|a| !a.refreshing))
    });
    assert!(announced);
}

#[test]
fn the_last_usage_is_answered_from_the_store_after_a_restart() {
    let fixture = fixture();
    fixture.core.refresh_accounts_now();
    let before = fixture.core.list_accounts().unwrap();
    let after = fixture.reopen().list_accounts().unwrap();
    assert_eq!(after, before);
    assert!(!after[0].limits.is_empty());
}

#[test]
fn a_failed_probe_sets_the_error_and_keeps_the_old_limits() {
    let fixture = fixture();
    let profile = fixture.profile("work");
    fixture.core.refresh_accounts_now();
    let id = profile.to_string_lossy().to_string();
    let first = fixture.core.list_accounts().unwrap();
    let limits = account(&first, &id).limits.clone();
    assert!(!limits.is_empty());
    fs::write(profile.join("fail"), "").unwrap();
    fixture.core.refresh_accounts_now();
    let failed = fixture.core.list_accounts().unwrap();
    assert_eq!(account(&failed, &id).limits, limits);
    assert!(account(&failed, &id)
        .error
        .as_deref()
        .unwrap()
        .contains("Not logged in"));
    assert_eq!(account(&failed, "default").error, None);
}

#[test]
fn removing_hides_a_found_account_and_deletes_an_added_one() {
    let fixture = fixture();
    let found = fixture.profile("found");
    fixture.core.refresh_accounts_now();
    let found_id = found.to_string_lossy().to_string();
    fixture.core.remove_account(&found_id).unwrap();
    fixture.core.refresh_accounts_now();
    let ids: Vec<String> = fixture
        .core
        .list_accounts()
        .unwrap()
        .into_iter()
        .map(|a| a.id)
        .collect();
    assert_eq!(ids, ["default"]);
    let added = TempDir::new().unwrap();
    let account = fixture.core.add_account(added.path()).unwrap();
    assert_eq!(account.id, added.path().to_string_lossy());
    fixture
        .core
        .rename_account(&account.id, "Side project")
        .unwrap();
    fixture.core.remove_account(&account.id).unwrap();
    let ids: Vec<String> = fixture
        .core
        .list_accounts()
        .unwrap()
        .into_iter()
        .map(|a| a.id)
        .collect();
    assert_eq!(ids, ["default"]);
}

#[test]
fn a_session_runs_with_the_config_dir_of_its_account_and_default_removes_it() {
    let fixture = fixture();
    let profile = fixture.profile("work");
    fixture.core.refresh_accounts_now();
    let work = new_job(&fixture, "Add login", Some(&profile.to_string_lossy()));
    let plain = new_job(&fixture, "Add search", Some("default"));
    assert_eq!(
        echoed_config_dir(&fixture, &work),
        json!(profile.to_string_lossy())
    );
    assert_eq!(echoed_config_dir(&fixture, &plain), Value::Null);
}

#[test]
fn a_new_session_takes_the_project_account_and_a_project_can_go_back_to_default() {
    let fixture = fixture();
    let profile = fixture.profile("work");
    fixture.core.refresh_accounts_now();
    let id = profile.to_string_lossy().to_string();
    fixture
        .core
        .set_project_account(fixture.repo.path(), Some(&id))
        .unwrap();
    let job = new_job(&fixture, "Add login", None);
    assert_eq!(row(&fixture, &job)["account_id"], id);
    fixture
        .core
        .set_project_account(fixture.repo.path(), None)
        .unwrap();
    fixture.core.set_default_account(&id).unwrap();
    let second = new_job(&fixture, "Add search", None);
    assert_eq!(row(&fixture, &second)["account_id"], id);
    assert!(fixture
        .core
        .list_accounts()
        .unwrap()
        .iter()
        .all(|a| a.is_default == (a.id == id)));
}

#[test]
fn a_session_waits_for_a_reply_after_its_turn_but_not_while_it_runs() {
    let fixture = fixture();
    let job = new_job(&fixture, "Add login", None);
    wait_for("a lead waiting for the user", || {
        (row(&fixture, &job)["needs_reply"] == true).then_some(())
    });
    fixture
        .core
        .send_message(&lead(&fixture, &job), "hold")
        .unwrap();
    assert_eq!(row(&fixture, &job)["needs_reply"], false);
}

#[test]
fn a_session_with_an_open_permission_request_needs_a_reply() {
    let fixture = fixture();
    let job = new_job(&fixture, "ask permission", None);
    wait_for("an open permission request", || {
        (row(&fixture, &job)["needs_reply"] == true).then_some(())
    });
}

#[test]
fn a_session_reports_its_worktree_and_the_context_of_its_agents() {
    let fixture = fixture();
    let job = new_job(&fixture, "Add login", None);
    let listed = row(&fixture, &job);
    assert_eq!(listed["context_tokens"], Value::Null);
    let worktree = listed["worktree"].as_str().unwrap();
    assert!(Path::new(worktree).is_dir());
    let session = fixture.core.list_agents(&job).unwrap().remove(0).session_id;
    let projects = fixture.claude_dir().join("projects");
    fs::create_dir_all(&projects).unwrap();
    fs::write(
        projects.join(format!("{session}.jsonl")),
        usage_line(&session, 10, 5000) + "\n",
    )
    .unwrap();
    assert_eq!(row(&fixture, &job)["context_tokens"], 5017);
    assert!(
        row(&fixture, &job)["last_active_at"].as_i64().unwrap()
            >= listed["created_at"].as_i64().unwrap()
    );
}

fn lead(fixture: &Fixture, job_id: &str) -> String {
    fixture.core.list_agents(job_id).unwrap().remove(0).id
}

fn login_row(id: &str, limits: bool) -> AccountRow {
    AccountRow {
        id: id.into(),
        label: id.into(),
        email: Some("jane@example.com".into()),
        plan: None,
        org_id: Some("org-1".into()),
        config_dir: None,
        manual: false,
        hidden: false,
        is_default: id == "default",
        limits: if limits {
            vec![UsageLimit {
                kind: "weekly_all".into(),
                label: "Weekly".into(),
                percent: 10.0,
                resets_at: None,
                severity: "normal".into(),
                active: false,
            }]
        } else {
            Vec::new()
        },
        updated_at: None,
        error: None,
    }
}

#[test]
fn the_plan_is_named_after_the_tier_before_the_subscription() {
    assert_eq!(plan_name(Some("max_20x"), Some("max")).as_deref(), Some("Ultra"));
    assert_eq!(plan_name(Some("max_5x"), Some("team")).as_deref(), Some("Max"));
    assert_eq!(plan_name(None, Some("team")).as_deref(), Some("Team"));
    assert_eq!(plan_name(None, Some("pro")).as_deref(), Some("Pro"));
    assert_eq!(plan_name(None, None), None);
}

#[test]
fn accounts_with_the_same_email_and_org_merge_into_the_one_that_reports_limits() {
    let rows = vec![login_row("default", false), login_row("/profiles/a", true)];
    let kept = merged(&rows);
    assert_eq!(kept.len(), 1);
    assert_eq!(kept[0].id, "/profiles/a");
    assert!(kept[0].is_default);
    let none_report = vec![login_row("/profiles/a", false), login_row("default", false)];
    assert_eq!(merged(&none_report)[0].id, "default");
    let other_org = AccountRow { org_id: Some("org-2".into()), ..login_row("/profiles/b", true) };
    assert_eq!(merged(&[login_row("default", true), other_org]).len(), 2);
}

#[test]
fn the_longest_folder_rule_wins_and_covers_every_folder_below() {
    let rules = std::collections::HashMap::from([
        ("/code".to_string(), "work".to_string()),
        ("/code/app".to_string(), "home".to_string()),
    ]);
    assert_eq!(folder_account(&rules, Path::new("/code/app/web/src")), Some("home"));
    assert_eq!(folder_account(&rules, Path::new("/code/other")), Some("work"));
    assert_eq!(folder_account(&rules, Path::new("/code/application")), Some("work"));
    assert_eq!(folder_account(&rules, Path::new("/elsewhere")), None);
}

#[test]
fn a_duplicate_login_is_listed_once_and_its_sessions_use_the_primary_config_dir() {
    let fixture = fixture();
    let duplicate = fixture.profile("default");
    fixture.core.refresh_accounts_now();
    let accounts = fixture.core.list_accounts().unwrap();
    assert_eq!(accounts.len(), 1);
    assert_eq!(accounts[0].id, "default");
    let job = new_job(&fixture, "Add login", Some(&duplicate.to_string_lossy()));
    assert_eq!(echoed_config_dir(&fixture, &job), Value::Null);
}

#[test]
fn a_folder_rule_for_a_duplicate_login_is_listed_with_the_primary_account() {
    let fixture = fixture();
    let duplicate = fixture.profile("default");
    fixture.core.refresh_accounts_now();
    fixture
        .core
        .set_project_account(fixture.repo.path(), Some(&duplicate.to_string_lossy()))
        .unwrap();
    let rules = fixture.core.project_accounts().unwrap();
    assert_eq!(rules[&fixture.repo.path().to_string_lossy().to_string()], "default");
}

#[test]
fn a_folder_rule_covers_the_folders_below_it() {
    let fixture = fixture();
    let profile = fixture.profile("work");
    fixture.core.refresh_accounts_now();
    let id = profile.to_string_lossy().to_string();
    fixture
        .core
        .set_project_account(fixture.repo.path().parent().unwrap(), Some(&id))
        .unwrap();
    let job = new_job(&fixture, "Add login", None);
    assert_eq!(row(&fixture, &job)["account_id"], id);
}
