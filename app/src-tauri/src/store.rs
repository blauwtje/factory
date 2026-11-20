use std::collections::HashMap;
use std::fmt;
use std::path::{Path, PathBuf};

use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSql, ToSqlOutput, ValueRef};
use rusqlite::{params, Connection, Row};
use serde::Serialize;
use serde_json::Value;

use crate::accounts::UsageLimit;

pub const SCHEMA_VERSION: u32 = 12;

const ADD_LAST_USED: &str = "ALTER TABLE projects ADD COLUMN last_used INTEGER NOT NULL DEFAULT 0";
const ADD_ARCHIVED: &str = "ALTER TABLE jobs ADD COLUMN archived INTEGER NOT NULL DEFAULT 0";
const ADD_PINNED: &str = "ALTER TABLE jobs ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0";

const ADD_PERMISSION_MODE: &str =
    "ALTER TABLE agents ADD COLUMN permission_mode TEXT NOT NULL DEFAULT ''";

const TRANSCRIPT_TABLES: &str = "
CREATE TABLE transcript_files (
    path TEXT PRIMARY KEY,
    size INTEGER NOT NULL,
    mtime INTEGER NOT NULL,
    offset INTEGER NOT NULL
);
CREATE TABLE transcript_messages (
    key TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    model TEXT NOT NULL,
    ts TEXT NOT NULL,
    hour INTEGER NOT NULL,
    input INTEGER NOT NULL,
    cache_write INTEGER NOT NULL,
    cache_read INTEGER NOT NULL,
    output INTEGER NOT NULL,
    tool_calls INTEGER NOT NULL
);
CREATE INDEX transcript_messages_session ON transcript_messages(session_id);
";

const TRANSCRIPT_USES: &str = "
CREATE TABLE transcript_uses (
    key TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    ts TEXT NOT NULL,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    detail TEXT
);
";
const ADD_PROJECT: &str =
    "ALTER TABLE transcript_messages ADD COLUMN project TEXT NOT NULL DEFAULT ''";
const REREAD_TRANSCRIPTS: &str = "DELETE FROM transcript_files";
const HOOK_COMMANDS: &str = "
CREATE TABLE transcript_hook_commands (id INTEGER PRIMARY KEY, command TEXT NOT NULL UNIQUE);
ALTER TABLE transcript_uses ADD COLUMN command_id INTEGER;
INSERT OR IGNORE INTO transcript_hook_commands (command)
    SELECT DISTINCT detail FROM transcript_uses WHERE detail IS NOT NULL;
UPDATE transcript_uses
    SET command_id = (SELECT id FROM transcript_hook_commands WHERE command = detail), detail = NULL
    WHERE detail IS NOT NULL;
CREATE INDEX transcript_uses_target ON transcript_uses (kind, name, command_id, ts);
";
const TRANSCRIPT_TEXT: &str = "
CREATE VIRTUAL TABLE transcript_text USING fts5(
    session_id UNINDEXED,
    seq UNINDEXED,
    role UNINDEXED,
    text,
    tokenize = 'unicode61 remove_diacritics 2'
);
";

const CUSTOMIZE_MEASUREMENTS: &str = "
CREATE TABLE customize_measurements (
    project TEXT PRIMARY KEY,
    report TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    measured_at TEXT NOT NULL
);
";

const ACCOUNTS: &str = "
CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    email TEXT,
    plan TEXT,
    config_dir TEXT,
    manual INTEGER NOT NULL DEFAULT 0,
    hidden INTEGER NOT NULL DEFAULT 0,
    is_default INTEGER NOT NULL DEFAULT 0,
    limits TEXT NOT NULL DEFAULT '[]',
    updated_at INTEGER,
    error TEXT
);
CREATE TABLE project_accounts (
    project_path TEXT PRIMARY KEY,
    account_id TEXT NOT NULL
);
ALTER TABLE jobs ADD COLUMN account_id TEXT;
";

const ADD_ORG_ID: &str = "ALTER TABLE accounts ADD COLUMN org_id TEXT;";

const SCHEMA: &str = "
CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    name TEXT NOT NULL,
    last_used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    title TEXT NOT NULL,
    kind TEXT NOT NULL,
    mode TEXT NOT NULL,
    branch TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN
        ('planning', 'awaiting_approval', 'building', 'done', 'merged', 'failed')),
    created_at INTEGER NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE agents (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES jobs(id),
    role TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    model TEXT NOT NULL,
    effort TEXT NOT NULL,
    why TEXT NOT NULL,
    attempt INTEGER NOT NULL,
    cli_version TEXT NOT NULL,
    session_id TEXT NOT NULL,
    worktree TEXT NOT NULL,
    status TEXT NOT NULL
);
CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agents(id),
    sender TEXT NOT NULL,
    kind TEXT NOT NULL,
    body_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Planning,
    AwaitingApproval,
    Building,
    Done,
    Merged,
    Failed,
}

impl JobStatus {
    fn as_str(self) -> &'static str {
        match self {
            JobStatus::Planning => "planning",
            JobStatus::AwaitingApproval => "awaiting_approval",
            JobStatus::Building => "building",
            JobStatus::Done => "done",
            JobStatus::Merged => "merged",
            JobStatus::Failed => "failed",
        }
    }
}

impl ToSql for JobStatus {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        self.as_str().to_sql()
    }
}

impl FromSql for JobStatus {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        match value.as_str()? {
            "planning" => Ok(JobStatus::Planning),
            "awaiting_approval" => Ok(JobStatus::AwaitingApproval),
            "building" => Ok(JobStatus::Building),
            "done" => Ok(JobStatus::Done),
            "merged" => Ok(JobStatus::Merged),
            "failed" => Ok(JobStatus::Failed),
            other => Err(FromSqlError::Other(
                format!("unknown job status {other:?}").into(),
            )),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Project {
    pub id: String,
    pub path: PathBuf,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RecentProject {
    pub path: PathBuf,
    pub name: String,
    pub last_used: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Job {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub kind: String,
    pub mode: String,
    pub branch: String,
    pub status: JobStatus,
    pub created_at: i64,
    pub archived: bool,
    pub pinned: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Agent {
    pub id: String,
    pub job_id: String,
    pub role: String,
    pub name: String,
    pub kind: String,
    pub model: String,
    pub effort: String,
    pub why: String,
    pub attempt: u32,
    pub cli_version: String,
    pub session_id: String,
    pub worktree: PathBuf,
    pub status: String,
    pub permission_mode: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AccountRow {
    pub id: String,
    pub label: String,
    pub email: Option<String>,
    pub plan: Option<String>,
    pub org_id: Option<String>,
    pub config_dir: Option<String>,
    pub manual: bool,
    pub hidden: bool,
    pub is_default: bool,
    pub limits: Vec<UsageLimit>,
    pub updated_at: Option<i64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Message {
    pub id: String,
    pub agent_id: String,
    pub sender: String,
    pub kind: String,
    pub body: Value,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct StoredMeasurement {
    pub project: String,
    pub report: Value,
    pub fingerprint: String,
    pub measured_at: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum StoreError {
    UnsupportedSchema(u32),
    Database(String),
}

impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            StoreError::UnsupportedSchema(found) => {
                write!(f, "database schema version {found} is not {SCHEMA_VERSION}")
            }
            StoreError::Database(message) => write!(f, "{message}"),
        }
    }
}

impl std::error::Error for StoreError {}

impl From<rusqlite::Error> for StoreError {
    fn from(error: rusqlite::Error) -> Self {
        StoreError::Database(error.to_string())
    }
}

pub struct Store {
    connection: Connection,
}

impl Store {
    pub fn open(path: &Path) -> Result<Store, StoreError> {
        let connection = Connection::open(path)?;
        connection.pragma_update(None, "foreign_keys", true)?;
        let store = Store { connection };
        match store.schema_version()? {
            0 => store.create_schema()?,
            found if found > SCHEMA_VERSION => return Err(StoreError::UnsupportedSchema(found)),
            found => store.migrate_from(found)?,
        }
        Ok(store)
    }

    pub fn schema_version(&self) -> Result<u32, StoreError> {
        Ok(self
            .connection
            .pragma_query_value(None, "user_version", |row| row.get(0))?)
    }

    fn create_schema(&self) -> Result<(), StoreError> {
        let transaction = self.connection.unchecked_transaction()?;
        transaction.execute_batch(SCHEMA)?;
        transaction.execute_batch(TRANSCRIPT_TABLES)?;
        transaction.execute_batch(ADD_PROJECT)?;
        transaction.execute_batch(TRANSCRIPT_USES)?;
        transaction.execute_batch(ADD_PINNED)?;
        transaction.execute_batch(TRANSCRIPT_TEXT)?;
        transaction.execute_batch(HOOK_COMMANDS)?;
        transaction.execute_batch(CUSTOMIZE_MEASUREMENTS)?;
        transaction.execute_batch(ADD_PERMISSION_MODE)?;
        transaction.execute_batch(ACCOUNTS)?;
        transaction.execute_batch(ADD_ORG_ID)?;
        transaction.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        Ok(transaction.commit()?)
    }

    fn migrate_from(&self, found: u32) -> Result<(), StoreError> {
        let steps: [&[&str]; 11] = [
            &[ADD_LAST_USED],
            &[TRANSCRIPT_TABLES],
            &[ADD_ARCHIVED],
            &[TRANSCRIPT_USES, REREAD_TRANSCRIPTS],
            &[ADD_PROJECT, REREAD_TRANSCRIPTS],
            &[ADD_PINNED, TRANSCRIPT_TEXT, REREAD_TRANSCRIPTS],
            &[HOOK_COMMANDS],
            &[CUSTOMIZE_MEASUREMENTS],
            &[ADD_PERMISSION_MODE],
            &[ACCOUNTS],
            &[ADD_ORG_ID],
        ];
        for (version, step) in (2..).zip(steps).skip(found as usize - 1) {
            let transaction = self.connection.unchecked_transaction()?;
            for sql in step {
                transaction.execute_batch(sql)?;
            }
            transaction.pragma_update(None, "user_version", version)?;
            transaction.commit()?;
        }
        if found < SCHEMA_VERSION {
            self.connection.execute_batch("VACUUM")?;
        }
        Ok(())
    }

    pub fn add_project(&self, project: &Project) -> Result<(), StoreError> {
        self.connection.execute(
            "INSERT INTO projects (id, path, name) VALUES (?1, ?2, ?3)",
            params![project.id, project.path.to_string_lossy(), project.name],
        )?;
        Ok(())
    }

    pub fn projects(&self) -> Result<Vec<Project>, StoreError> {
        self.query(
            "SELECT id, path, name FROM projects ORDER BY rowid",
            [],
            |row| {
                Ok(Project {
                    id: row.get(0)?,
                    path: PathBuf::from(row.get::<_, String>(1)?),
                    name: row.get(2)?,
                })
            },
        )
    }

    pub fn touch_project(&self, id: &str, last_used: i64) -> Result<(), StoreError> {
        self.connection.execute(
            "UPDATE projects SET last_used = ?2 WHERE id = ?1",
            params![id, last_used],
        )?;
        Ok(())
    }

    pub fn recent_projects(&self) -> Result<Vec<RecentProject>, StoreError> {
        self.query(
            "SELECT path, name, last_used FROM projects ORDER BY last_used DESC, rowid DESC",
            [],
            |row| {
                Ok(RecentProject {
                    path: PathBuf::from(row.get::<_, String>(0)?),
                    name: row.get(1)?,
                    last_used: row.get(2)?,
                })
            },
        )
    }

    pub fn add_job(&self, job: &Job) -> Result<(), StoreError> {
        self.connection.execute(
            "INSERT INTO jobs (id, project_id, title, kind, mode, branch, status, created_at,
                               archived, pinned)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                job.id,
                job.project_id,
                job.title,
                job.kind,
                job.mode,
                job.branch,
                job.status,
                job.created_at,
                job.archived,
                job.pinned
            ],
        )?;
        Ok(())
    }

    pub fn set_job_status(&self, id: &str, status: JobStatus) -> Result<(), StoreError> {
        self.connection.execute(
            "UPDATE jobs SET status = ?2 WHERE id = ?1",
            params![id, status],
        )?;
        Ok(())
    }

    pub fn set_job_archived(&self, id: &str, archived: bool) -> Result<(), StoreError> {
        self.connection.execute(
            "UPDATE jobs SET archived = ?2 WHERE id = ?1",
            params![id, archived],
        )?;
        Ok(())
    }

    pub fn set_job_pinned(&self, id: &str, pinned: bool) -> Result<(), StoreError> {
        self.connection.execute(
            "UPDATE jobs SET pinned = ?2 WHERE id = ?1",
            params![id, pinned],
        )?;
        Ok(())
    }

    pub fn set_job_title(&self, id: &str, title: &str) -> Result<(), StoreError> {
        self.connection.execute(
            "UPDATE jobs SET title = ?2 WHERE id = ?1",
            params![id, title],
        )?;
        Ok(())
    }

    pub fn delete_job(&self, id: &str) -> Result<(), StoreError> {
        let transaction = self.connection.unchecked_transaction()?;
        transaction.execute(
            "DELETE FROM transcript_text
             WHERE session_id IN (SELECT session_id FROM agents WHERE job_id = ?1)",
            [id],
        )?;
        transaction.execute(
            "DELETE FROM messages WHERE agent_id IN (SELECT id FROM agents WHERE job_id = ?1)",
            [id],
        )?;
        transaction.execute("DELETE FROM agents WHERE job_id = ?1", [id])?;
        transaction.execute("DELETE FROM jobs WHERE id = ?1", [id])?;
        Ok(transaction.commit()?)
    }

    pub fn jobs(&self, project_id: &str) -> Result<Vec<Job>, StoreError> {
        self.query(
            "SELECT id, project_id, title, kind, mode, branch, status, created_at, archived,
                    pinned
             FROM jobs WHERE project_id = ?1 ORDER BY rowid",
            [project_id],
            |row| {
                Ok(Job {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    title: row.get(2)?,
                    kind: row.get(3)?,
                    mode: row.get(4)?,
                    branch: row.get(5)?,
                    status: row.get(6)?,
                    created_at: row.get(7)?,
                    archived: row.get(8)?,
                    pinned: row.get(9)?,
                })
            },
        )
    }

    pub fn add_agent(&self, agent: &Agent) -> Result<(), StoreError> {
        self.connection.execute(
            "INSERT INTO agents (id, job_id, role, name, kind, model, effort, why, attempt,
                                 cli_version, session_id, worktree, status, permission_mode)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                agent.id,
                agent.job_id,
                agent.role,
                agent.name,
                agent.kind,
                agent.model,
                agent.effort,
                agent.why,
                agent.attempt,
                agent.cli_version,
                agent.session_id,
                agent.worktree.to_string_lossy(),
                agent.status,
                agent.permission_mode
            ],
        )?;
        Ok(())
    }

    pub fn set_agent_status(&self, id: &str, status: &str) -> Result<(), StoreError> {
        self.connection.execute(
            "UPDATE agents SET status = ?2 WHERE id = ?1",
            params![id, status],
        )?;
        Ok(())
    }

    pub fn set_agent_permission_mode(&self, id: &str, mode: &str) -> Result<(), StoreError> {
        self.connection.execute(
            "UPDATE agents SET permission_mode = ?2 WHERE id = ?1",
            params![id, mode],
        )?;
        Ok(())
    }

    pub fn set_agent_model(
        &self,
        id: &str,
        model: &str,
        effort: &str,
        why: &str,
    ) -> Result<(), StoreError> {
        self.connection.execute(
            "UPDATE agents SET model = ?2, effort = ?3, why = ?4 WHERE id = ?1",
            params![id, model, effort, why],
        )?;
        Ok(())
    }

    pub fn agents(&self, job_id: &str) -> Result<Vec<Agent>, StoreError> {
        self.query(
            "SELECT id, job_id, role, name, kind, model, effort, why, attempt,
                    cli_version, session_id, worktree, status, permission_mode
             FROM agents WHERE job_id = ?1 ORDER BY rowid",
            [job_id],
            |row| {
                Ok(Agent {
                    id: row.get(0)?,
                    job_id: row.get(1)?,
                    role: row.get(2)?,
                    name: row.get(3)?,
                    kind: row.get(4)?,
                    model: row.get(5)?,
                    effort: row.get(6)?,
                    why: row.get(7)?,
                    attempt: row.get(8)?,
                    cli_version: row.get(9)?,
                    session_id: row.get(10)?,
                    worktree: PathBuf::from(row.get::<_, String>(11)?),
                    status: row.get(12)?,
                    permission_mode: row.get(13)?,
                })
            },
        )
    }

    pub fn add_message(&self, message: &Message) -> Result<(), StoreError> {
        self.connection.execute(
            "INSERT INTO messages (id, agent_id, sender, kind, body_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                message.id,
                message.agent_id,
                message.sender,
                message.kind,
                message.body.to_string(),
                message.created_at
            ],
        )?;
        Ok(())
    }

    pub fn messages(&self, agent_id: &str) -> Result<Vec<Message>, StoreError> {
        self.query(
            "SELECT id, agent_id, sender, kind, body_json, created_at
             FROM messages WHERE agent_id = ?1 ORDER BY rowid",
            [agent_id],
            |row| {
                let body: String = row.get(4)?;
                Ok(Message {
                    id: row.get(0)?,
                    agent_id: row.get(1)?,
                    sender: row.get(2)?,
                    kind: row.get(3)?,
                    body: serde_json::from_str(&body)
                        .map_err(|error| FromSqlError::Other(Box::new(error)))?,
                    created_at: row.get(5)?,
                })
            },
        )
    }

    pub fn save_measurement(&self, measurement: &StoredMeasurement) -> Result<(), StoreError> {
        self.connection.execute(
            "INSERT OR REPLACE INTO customize_measurements (project, report, fingerprint, measured_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                measurement.project,
                measurement.report.to_string(),
                measurement.fingerprint,
                measurement.measured_at
            ],
        )?;
        Ok(())
    }

    pub fn measurement(&self, project: &str) -> Result<Option<StoredMeasurement>, StoreError> {
        let found = self.query(
            "SELECT project, report, fingerprint, measured_at
             FROM customize_measurements WHERE project = ?1",
            [project],
            |row| {
                let report: String = row.get(1)?;
                let (project, fingerprint, measured_at) = (row.get(0)?, row.get(2)?, row.get(3)?);
                Ok(serde_json::from_str(&report)
                    .ok()
                    .map(|report| StoredMeasurement {
                        project,
                        report,
                        fingerprint,
                        measured_at,
                    }))
            },
        )?;
        Ok(found.into_iter().next().flatten())
    }

    pub fn accounts(&self) -> Result<Vec<AccountRow>, StoreError> {
        self.query(
            "SELECT id, label, email, plan, config_dir, manual, hidden, is_default, limits,
                    updated_at, error, org_id
             FROM accounts ORDER BY rowid",
            [],
            |row| {
                let limits: String = row.get(8)?;
                Ok(AccountRow {
                    id: row.get(0)?,
                    label: row.get(1)?,
                    email: row.get(2)?,
                    plan: row.get(3)?,
                    config_dir: row.get(4)?,
                    manual: row.get(5)?,
                    hidden: row.get(6)?,
                    is_default: row.get(7)?,
                    limits: serde_json::from_str(&limits)
                        .map_err(|error| FromSqlError::Other(Box::new(error)))?,
                    updated_at: row.get(9)?,
                    error: row.get(10)?,
                    org_id: row.get(11)?,
                })
            },
        )
    }

    pub fn save_account(&self, account: &AccountRow) -> Result<(), StoreError> {
        let limits = serde_json::to_string(&account.limits)
            .map_err(|error| StoreError::Database(error.to_string()))?;
        self.connection.execute(
            "INSERT INTO accounts (id, label, email, plan, config_dir, manual, hidden, is_default,
                                   limits, updated_at, error, org_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
             ON CONFLICT(id) DO UPDATE SET
                 label = ?2, email = ?3, plan = ?4, config_dir = ?5, manual = ?6, hidden = ?7,
                 is_default = ?8, limits = ?9, updated_at = ?10, error = ?11, org_id = ?12",
            params![
                account.id,
                account.label,
                account.email,
                account.plan,
                account.config_dir,
                account.manual,
                account.hidden,
                account.is_default,
                limits,
                account.updated_at,
                account.error,
                account.org_id
            ],
        )?;
        Ok(())
    }

    pub fn save_account_usage(&self, account: &AccountRow) -> Result<(), StoreError> {
        let limits = serde_json::to_string(&account.limits)
            .map_err(|error| StoreError::Database(error.to_string()))?;
        self.connection.execute(
            "UPDATE accounts SET plan = ?2, limits = ?3, updated_at = ?4, error = ?5 WHERE id = ?1",
            params![
                account.id,
                account.plan,
                limits,
                account.updated_at,
                account.error
            ],
        )?;
        Ok(())
    }

    pub fn delete_account(&self, id: &str) -> Result<(), StoreError> {
        let transaction = self.connection.unchecked_transaction()?;
        transaction.execute("DELETE FROM project_accounts WHERE account_id = ?1", [id])?;
        transaction.execute("DELETE FROM accounts WHERE id = ?1", [id])?;
        Ok(transaction.commit()?)
    }

    pub fn set_default_account(&self, id: &str) -> Result<(), StoreError> {
        self.connection
            .execute("UPDATE accounts SET is_default = (id = ?1)", [id])?;
        Ok(())
    }

    pub fn project_accounts(&self) -> Result<HashMap<String, String>, StoreError> {
        Ok(self
            .query(
                "SELECT project_path, account_id FROM project_accounts",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?
            .into_iter()
            .collect())
    }

    pub fn set_project_account(
        &self,
        project_path: &str,
        account_id: Option<&str>,
    ) -> Result<(), StoreError> {
        match account_id {
            Some(account_id) => self.connection.execute(
                "INSERT OR REPLACE INTO project_accounts (project_path, account_id)
                 VALUES (?1, ?2)",
                params![project_path, account_id],
            )?,
            None => self.connection.execute(
                "DELETE FROM project_accounts WHERE project_path = ?1",
                [project_path],
            )?,
        };
        Ok(())
    }

    pub fn set_job_account(&self, job_id: &str, account_id: &str) -> Result<(), StoreError> {
        self.connection.execute(
            "UPDATE jobs SET account_id = ?2 WHERE id = ?1",
            params![job_id, account_id],
        )?;
        Ok(())
    }

    pub fn job_accounts(&self) -> Result<HashMap<String, String>, StoreError> {
        Ok(self
            .query(
                "SELECT id, account_id FROM jobs WHERE account_id IS NOT NULL",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?
            .into_iter()
            .collect())
    }

    fn query<T>(
        &self,
        sql: &str,
        params: impl rusqlite::Params,
        map: impl FnMut(&Row) -> rusqlite::Result<T>,
    ) -> Result<Vec<T>, StoreError> {
        let mut statement = self.connection.prepare(sql)?;
        let rows = statement.query_map(params, map)?;
        Ok(rows.collect::<rusqlite::Result<Vec<T>>>()?)
    }
}
