use factory_lib::accounts::UsageLimit;
use factory_lib::store::{
    AccountRow, Agent, Job, JobStatus, Message, Project, Store, StoreError, StoredMeasurement, SCHEMA_VERSION,
};
use factory_lib::transcripts::Index;
use rusqlite::Connection;
use serde_json::json;
use tempfile::TempDir;

const UNDO_HOOK_COMMANDS: &str = "DROP TABLE customize_measurements;
     DROP TABLE transcript_hook_commands;
     DROP INDEX transcript_uses_target;
     ALTER TABLE transcript_uses DROP COLUMN command_id;
     ";

fn project() -> Project {
    Project {
        id: "p1".into(),
        path: "repo".into(),
        name: "repo".into(),
    }
}

fn job(status: JobStatus) -> Job {
    Job {
        id: "j1".into(),
        project_id: "p1".into(),
        title: "add login".into(),
        kind: "build".into(),
        mode: "auto".into(),
        branch: "factory/add-login".into(),
        status,
        created_at: 1_700_000_000,
        archived: false,
        pinned: false,
    }
}

fn agent() -> Agent {
    Agent {
        id: "a1".into(),
        job_id: "j1".into(),
        role: "builder".into(),
        name: "builder-1".into(),
        kind: "writer".into(),
        model: "claude-sonnet-5-5".into(),
        effort: "medium".into(),
        why: "builds the plan".into(),
        attempt: 1,
        cli_version: "2.1.326".into(),
        session_id: "11111111-2222-3333-4444-555555555555".into(),
        worktree: "wt/ab12".into(),
        status: "running".into(),
        permission_mode: String::new(),
    }
}

fn message(id: &str, created_at: i64) -> Message {
    Message {
        id: id.into(),
        agent_id: "a1".into(),
        sender: "user".into(),
        kind: "text".into(),
        body: json!({"text": id}),
        created_at,
    }
}

fn seeded(dir: &TempDir) -> Store {
    let store = Store::open(&dir.path().join("factory.db")).unwrap();
    store.add_project(&project()).unwrap();
    store.add_job(&job(JobStatus::Planning)).unwrap();
    store.add_agent(&agent()).unwrap();
    store
}

#[test]
fn new_database_has_schema_version_eleven() {
    let dir = TempDir::new().unwrap();
    let store = Store::open(&dir.path().join("factory.db")).unwrap();
    assert_eq!(SCHEMA_VERSION, 12);
    assert_eq!(store.schema_version().unwrap(), 12);
}

#[test]
fn rows_survive_reopening_and_reopening_keeps_them() {
    let dir = TempDir::new().unwrap();
    drop(seeded(&dir));
    let store = Store::open(&dir.path().join("factory.db")).unwrap();
    assert_eq!(store.projects().unwrap(), vec![project()]);
    assert_eq!(store.jobs("p1").unwrap(), vec![job(JobStatus::Planning)]);
    assert_eq!(store.agents("j1").unwrap(), vec![agent()]);
}

#[test]
fn every_job_status_round_trips_and_is_stored_in_english() {
    let dir = TempDir::new().unwrap();
    let store = seeded(&dir);
    let expected = [
        (JobStatus::Planning, "planning"),
        (JobStatus::AwaitingApproval, "awaiting_approval"),
        (JobStatus::Building, "building"),
        (JobStatus::Done, "done"),
        (JobStatus::Merged, "merged"),
        (JobStatus::Failed, "failed"),
    ];
    let raw = Connection::open(dir.path().join("factory.db")).unwrap();
    for (status, text) in expected {
        store.set_job_status("j1", status).unwrap();
        assert_eq!(store.jobs("p1").unwrap()[0].status, status);
        let stored: String = raw
            .query_row("SELECT status FROM jobs WHERE id = 'j1'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(stored, text);
    }
}

#[test]
fn agent_status_updates() {
    let dir = TempDir::new().unwrap();
    let store = seeded(&dir);
    store.set_agent_status("a1", "stopped").unwrap();
    assert_eq!(store.agents("j1").unwrap()[0].status, "stopped");
}

#[test]
fn messages_come_back_in_the_order_they_were_added_with_their_json() {
    let dir = TempDir::new().unwrap();
    let store = seeded(&dir);
    let sent = [message("m2", 20), message("m1", 10)];
    for m in &sent {
        store.add_message(m).unwrap();
    }
    assert_eq!(store.messages("a1").unwrap(), sent);
}

#[test]
fn a_job_needs_an_existing_project() {
    let dir = TempDir::new().unwrap();
    let store = Store::open(&dir.path().join("factory.db")).unwrap();
    assert!(store.add_job(&job(JobStatus::Planning)).is_err());
}

#[test]
fn a_newer_schema_version_is_refused() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("factory.db");
    drop(Store::open(&path).unwrap());
    Connection::open(&path)
        .unwrap()
        .pragma_update(None, "user_version", 13)
        .unwrap();
    assert_eq!(
        Store::open(&path).err(),
        Some(StoreError::UnsupportedSchema(13))
    );
}

#[test]
fn a_version_four_database_gets_the_uses_table_and_rereads_its_transcripts() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("factory.db");
    drop(Store::open(&path).unwrap());
    Connection::open(&path)
        .unwrap()
        .execute_batch(
            "DROP TABLE project_accounts;
             DROP TABLE accounts;
             ALTER TABLE jobs DROP COLUMN account_id;
             ALTER TABLE agents DROP COLUMN permission_mode;
             DROP TABLE customize_measurements;
             DROP TABLE transcript_hook_commands;
             DROP INDEX transcript_uses_target;
             ALTER TABLE transcript_uses DROP COLUMN command_id;
             DROP TABLE transcript_uses;
             DROP TABLE transcript_text;
             ALTER TABLE jobs DROP COLUMN pinned;
             ALTER TABLE transcript_messages DROP COLUMN project;
             INSERT INTO transcript_files VALUES ('~/code/app/s.jsonl', 10, 1, 10);
             PRAGMA user_version = 4;",
        )
        .unwrap();
    assert_eq!(Store::open(&path).unwrap().schema_version().unwrap(), 12);
    let raw = Connection::open(&path).unwrap();
    let count = |table: &str| -> i64 {
        raw.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
            row.get(0)
        })
        .unwrap()
    };
    assert_eq!(count("transcript_files"), 0);
    assert_eq!(count("transcript_uses"), 0);
}

#[test]
fn a_version_five_database_gets_the_project_column_and_rereads_its_transcripts() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("factory.db");
    drop(Store::open(&path).unwrap());
    Connection::open(&path)
        .unwrap()
        .execute_batch(
            "DROP TABLE project_accounts;
             DROP TABLE accounts;
             ALTER TABLE jobs DROP COLUMN account_id;
             ALTER TABLE agents DROP COLUMN permission_mode;
             DROP TABLE customize_measurements;
             DROP TABLE transcript_hook_commands;
             DROP INDEX transcript_uses_target;
             ALTER TABLE transcript_uses DROP COLUMN command_id;
             DROP TABLE transcript_text;
             ALTER TABLE jobs DROP COLUMN pinned;
             ALTER TABLE transcript_messages DROP COLUMN project;
             INSERT INTO transcript_messages VALUES ('m|r', 's', 'm', 't', 0, 1, 0, 0, 1, 0);
             INSERT INTO transcript_files VALUES ('~/code/app/s.jsonl', 10, 1, 10);
             PRAGMA user_version = 5;",
        )
        .unwrap();
    assert_eq!(Store::open(&path).unwrap().schema_version().unwrap(), 12);
    let raw = Connection::open(&path).unwrap();
    let files: i64 = raw
        .query_row("SELECT COUNT(*) FROM transcript_files", [], |row| row.get(0))
        .unwrap();
    let project: String = raw
        .query_row("SELECT project FROM transcript_messages", [], |row| row.get(0))
        .unwrap();
    assert_eq!((files, project), (0, String::new()));
}

#[test]
fn a_version_six_database_gets_pinned_jobs_and_the_text_table_and_rereads_its_transcripts() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("factory.db");
    drop(seeded(&dir));
    Connection::open(&path)
        .unwrap()
        .execute_batch(
            "DROP TABLE project_accounts;
             DROP TABLE accounts;
             ALTER TABLE jobs DROP COLUMN account_id;
             ALTER TABLE agents DROP COLUMN permission_mode;
             DROP TABLE customize_measurements;
             DROP TABLE transcript_hook_commands;
             DROP INDEX transcript_uses_target;
             ALTER TABLE transcript_uses DROP COLUMN command_id;
             DROP TABLE transcript_text;
             ALTER TABLE jobs DROP COLUMN pinned;
             INSERT INTO transcript_files VALUES ('~/code/app/s.jsonl', 10, 1, 10);
             PRAGMA user_version = 6;",
        )
        .unwrap();
    let store = Store::open(&path).unwrap();
    assert_eq!(store.schema_version().unwrap(), 12);
    assert_eq!(store.jobs("p1").unwrap(), vec![job(JobStatus::Planning)]);
    let raw = Connection::open(&path).unwrap();
    let files: i64 = raw
        .query_row("SELECT COUNT(*) FROM transcript_files", [], |row| row.get(0))
        .unwrap();
    assert_eq!(files, 0);
    raw.execute(
        "INSERT INTO transcript_text (session_id, seq, role, text) VALUES ('s', 0, 'user', 'hi')",
        [],
    )
    .unwrap();
}

#[test]
fn a_version_seven_database_keeps_hook_uses_but_stores_each_command_once() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("factory.db");
    drop(Store::open(&path).unwrap());
    Connection::open(&path)
        .unwrap()
        .execute_batch(&format!(
            "DROP TABLE project_accounts;
             DROP TABLE accounts;
             ALTER TABLE jobs DROP COLUMN account_id;
             ALTER TABLE agents DROP COLUMN permission_mode;{}INSERT INTO transcript_uses VALUES ('a', 's', '2026-01-02', 'hook', 'Stop', 'npm test');
             INSERT INTO transcript_uses VALUES ('b', 's', '2026-01-03', 'hook', 'Stop', 'npm test');
             PRAGMA user_version = 7;",
            UNDO_HOOK_COMMANDS
        ))
        .unwrap();
    assert_eq!(Store::open(&path).unwrap().schema_version().unwrap(), 12);
    let uses = Index::open(&path).unwrap().uses("2026-01-01").unwrap();
    let found: Vec<_> = uses
        .iter()
        .map(|count| (count.name.as_str(), count.detail.as_deref(), count.uses))
        .collect();
    assert_eq!(found, vec![("Stop", Some("npm test"), 2)]);
    let commands: i64 = Connection::open(&path)
        .unwrap()
        .query_row("SELECT COUNT(*) FROM transcript_hook_commands", [], |row| row.get(0))
        .unwrap();
    assert_eq!(commands, 1);
}

#[test]
fn a_version_eight_database_gets_the_measurement_table_and_keeps_its_data() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("factory.db");
    drop(seeded(&dir));
    Connection::open(&path)
        .unwrap()
        .execute_batch(
            "DROP TABLE project_accounts;
             DROP TABLE accounts;
             ALTER TABLE jobs DROP COLUMN account_id;
             ALTER TABLE agents DROP COLUMN permission_mode;
             DROP TABLE customize_measurements;
             INSERT INTO transcript_files VALUES ('~/code/app/s.jsonl', 10, 1, 10);
             PRAGMA user_version = 8;",
        )
        .unwrap();
    let store = Store::open(&path).unwrap();
    assert_eq!(store.schema_version().unwrap(), 12);
    assert_eq!(store.jobs("p1").unwrap(), vec![job(JobStatus::Planning)]);
    let files: i64 = Connection::open(&path)
        .unwrap()
        .query_row("SELECT COUNT(*) FROM transcript_files", [], |row| row.get(0))
        .unwrap();
    assert_eq!(files, 1);
    let measurement = StoredMeasurement {
        project: "~/code/app".into(),
        report: json!({"totalTokens": 1200}),
        fingerprint: "18446744073709551615".into(),
        measured_at: "2026-01-02T03:04:05Z".into(),
    };
    store.save_measurement(&measurement).unwrap();
    assert_eq!(store.measurement("~/code/app").unwrap(), Some(measurement));
    assert_eq!(store.measurement("").unwrap(), None);
}

#[test]
fn a_pinned_job_stays_pinned_after_reopening() {
    let dir = TempDir::new().unwrap();
    let store = seeded(&dir);
    store.set_job_pinned("j1", true).unwrap();
    drop(store);
    let store = Store::open(&dir.path().join("factory.db")).unwrap();
    assert!(store.jobs("p1").unwrap()[0].pinned);
    store.set_job_pinned("j1", false).unwrap();
    assert!(!store.jobs("p1").unwrap()[0].pinned);
}

#[test]
fn a_job_added_pinned_is_listed_pinned() {
    let dir = TempDir::new().unwrap();
    let store = Store::open(&dir.path().join("factory.db")).unwrap();
    store.add_project(&project()).unwrap();
    let pinned = Job {
        pinned: true,
        ..job(JobStatus::Planning)
    };
    store.add_job(&pinned).unwrap();
    assert_eq!(store.jobs("p1").unwrap(), vec![pinned]);
}

#[test]
fn a_job_title_can_be_changed() {
    let dir = TempDir::new().unwrap();
    let store = seeded(&dir);
    store.set_job_title("j1", "sign in with a passkey").unwrap();
    assert_eq!(store.jobs("p1").unwrap()[0].title, "sign in with a passkey");
}

#[test]
fn deleting_a_job_deletes_the_text_of_its_sessions_only() {
    let dir = TempDir::new().unwrap();
    let store = seeded(&dir);
    let raw = Connection::open(dir.path().join("factory.db")).unwrap();
    raw.execute_batch(
        "INSERT INTO transcript_text (session_id, seq, role, text)
             VALUES ('11111111-2222-3333-4444-555555555555', 0, 'user', 'add login');
         INSERT INTO transcript_text (session_id, seq, role, text)
             VALUES ('other-session', 0, 'user', 'keep me');",
    )
    .unwrap();
    store.delete_job("j1").unwrap();
    let left: Vec<String> = raw
        .prepare("SELECT session_id FROM transcript_text")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(left, ["other-session"]);
}

#[test]
fn a_version_one_database_is_migrated_and_keeps_its_projects_and_jobs() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("factory.db");
    let raw = Connection::open(&path).unwrap();
    raw.execute_batch(
        "CREATE TABLE projects (id TEXT PRIMARY KEY, path TEXT NOT NULL, name TEXT NOT NULL);
         INSERT INTO projects VALUES ('p1', 'repo', 'repo');
         CREATE TABLE jobs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL,
             kind TEXT NOT NULL, mode TEXT NOT NULL, branch TEXT NOT NULL, status TEXT NOT NULL,
             created_at INTEGER NOT NULL);
         INSERT INTO jobs VALUES ('j1', 'p1', 'add login', 'build', 'auto', 'factory/add-login',
             'planning', 1700000000);
         CREATE TABLE agents (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, role TEXT NOT NULL,
             name TEXT NOT NULL, kind TEXT NOT NULL, model TEXT NOT NULL, effort TEXT NOT NULL,
             why TEXT NOT NULL, attempt INTEGER NOT NULL, cli_version TEXT NOT NULL,
             session_id TEXT NOT NULL, worktree TEXT NOT NULL, status TEXT NOT NULL);
         PRAGMA user_version = 1;",
    )
    .unwrap();
    drop(raw);
    let store = Store::open(&path).unwrap();
    assert_eq!(store.schema_version().unwrap(), 12);
    assert_eq!(store.projects().unwrap(), vec![project()]);
    assert_eq!(store.jobs("p1").unwrap(), vec![job(JobStatus::Planning)]);
    let recent = store.recent_projects().unwrap();
    assert_eq!(
        (recent[0].path.clone(), recent[0].last_used),
        ("repo".into(), 0)
    );
}

#[test]
fn recent_projects_come_newest_first() {
    let dir = TempDir::new().unwrap();
    let store = Store::open(&dir.path().join("factory.db")).unwrap();
    for (id, name) in [("a", "alpha"), ("b", "beta"), ("c", "gamma")] {
        store
            .add_project(&Project {
                id: id.into(),
                path: name.into(),
                name: name.into(),
            })
            .unwrap();
    }
    store.touch_project("a", 300).unwrap();
    store.touch_project("c", 200).unwrap();
    store.touch_project("b", 100).unwrap();
    let names: Vec<String> = store
        .recent_projects()
        .unwrap()
        .into_iter()
        .map(|recent| recent.name)
        .collect();
    assert_eq!(names, ["alpha", "gamma", "beta"]);
    assert_eq!(store.recent_projects().unwrap()[0].last_used, 300);
}

#[test]
fn a_version_nine_database_gets_the_permission_mode_column_and_keeps_its_agents() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("factory.db");
    drop(seeded(&dir));
    Connection::open(&path)
        .unwrap()
        .execute_batch(
            "DROP TABLE project_accounts;
             DROP TABLE accounts;
             ALTER TABLE jobs DROP COLUMN account_id;
             ALTER TABLE agents DROP COLUMN permission_mode;
             PRAGMA user_version = 9;",
        )
        .unwrap();
    let store = Store::open(&path).unwrap();
    assert_eq!(store.schema_version().unwrap(), 12);
    assert_eq!(store.agents("j1").unwrap(), vec![agent()]);
}

#[test]
fn a_permission_mode_is_stored_on_the_agent() {
    let dir = TempDir::new().unwrap();
    let store = seeded(&dir);
    store.set_agent_permission_mode("a1", "plan").unwrap();
    let agents = store.agents("j1").unwrap();
    assert_eq!(agents[0].permission_mode, "plan");
}

fn limit(kind: &str, percent: f64) -> UsageLimit {
    UsageLimit {
        kind: kind.into(),
        label: "Weekly".into(),
        percent,
        resets_at: Some(1_800_000_000),
        severity: "normal".into(),
        active: true,
    }
}

fn account(id: &str) -> AccountRow {
    AccountRow {
        id: id.into(),
        label: "jane@example.com".into(),
        email: Some("jane@example.com".into()),
        plan: Some("max".into()),
        org_id: Some("org-1".into()),
        config_dir: None,
        manual: false,
        hidden: false,
        is_default: false,
        limits: vec![limit("weekly_all", 55.0)],
        updated_at: Some(1_700_000_000),
        error: None,
    }
}

#[test]
fn a_version_ten_database_gets_the_account_tables_and_keeps_its_jobs() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("factory.db");
    drop(seeded(&dir));
    Connection::open(&path)
        .unwrap()
        .execute_batch(
            "DROP TABLE project_accounts;
             DROP TABLE accounts;
             ALTER TABLE jobs DROP COLUMN account_id;
             PRAGMA user_version = 10;",
        )
        .unwrap();
    let store = Store::open(&path).unwrap();
    assert_eq!(store.schema_version().unwrap(), 12);
    assert_eq!(store.jobs("p1").unwrap(), vec![job(JobStatus::Planning)]);
    assert_eq!(store.accounts().unwrap(), vec![]);
}

#[test]
fn an_account_keeps_its_last_usage_after_reopening_the_store() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("factory.db");
    Store::open(&path).unwrap().save_account(&account("default")).unwrap();
    assert_eq!(Store::open(&path).unwrap().accounts().unwrap(), vec![account("default")]);
}

#[test]
fn saving_usage_leaves_a_label_renamed_in_the_meantime_alone() {
    let dir = TempDir::new().unwrap();
    let store = seeded(&dir);
    store.save_account(&account("default")).unwrap();
    let stale = account("default");
    store.save_account(&AccountRow { label: "Work".into(), ..account("default") }).unwrap();
    store
        .save_account_usage(&AccountRow { limits: vec![limit("weekly_all", 70.0)], ..stale })
        .unwrap();
    let saved = store.accounts().unwrap().remove(0);
    assert_eq!(saved.label, "Work");
    assert_eq!(saved.limits, vec![limit("weekly_all", 70.0)]);
}

#[test]
fn a_project_and_a_job_remember_their_account() {
    let dir = TempDir::new().unwrap();
    let store = seeded(&dir);
    store.save_account(&account("default")).unwrap();
    store.set_project_account("repo", Some("default")).unwrap();
    store.set_job_account("j1", "default").unwrap();
    assert_eq!(store.project_accounts().unwrap()["repo"], "default");
    assert_eq!(store.job_accounts().unwrap()["j1"], "default");
    store.set_project_account("repo", None).unwrap();
    assert!(store.project_accounts().unwrap().is_empty());
}
