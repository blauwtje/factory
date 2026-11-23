use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::agent::{account_env, no_window, resolve_claude, spawn_group, Env};
use crate::protocol::Window;
use crate::store::AccountRow;
use crate::transcripts::epoch_seconds;

pub const DEFAULT_ID: &str = "default";
pub const PROBE_TIMEOUT: Duration = Duration::from_secs(20);
pub const PROBE_RETRY: Duration = Duration::from_secs(2);
const PROBE_REQUEST_ID: &str = "u1";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UsageLimit {
    pub kind: String,
    pub label: String,
    pub percent: f64,
    pub resets_at: Option<i64>,
    pub severity: String,
    pub active: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Account {
    pub id: String,
    pub label: String,
    pub email: Option<String>,
    pub plan: Option<String>,
    pub config_dir: Option<String>,
    pub is_default: bool,
    pub limits: Vec<UsageLimit>,
    pub updated_at: Option<i64>,
    pub error: Option<String>,
    pub refreshing: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Login {
    pub id: String,
    pub email: Option<String>,
    pub plan: Option<String>,
    pub org_id: Option<String>,
    pub config_dir: Option<PathBuf>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Usage {
    pub plan: Option<String>,
    pub limits: Vec<UsageLimit>,
}

pub fn config_dir_of(account_id: &str) -> Option<PathBuf> {
    (account_id != DEFAULT_ID).then(|| PathBuf::from(account_id))
}

pub fn account_id_of(config_dir: Option<&Path>) -> String {
    config_dir.map_or_else(|| DEFAULT_ID.into(), |dir| dir.to_string_lossy().into())
}

fn humanize(kind: &str) -> String {
    let words = kind.replace('_', " ");
    let mut chars = words.chars();
    chars
        .next()
        .map(|first| first.to_uppercase().chain(chars).collect())
        .unwrap_or_default()
}

fn label(kind: &str, scope: &Value) -> String {
    match (kind, scope["model"]["display_name"].as_str()) {
        ("session", _) => "5-hour".into(),
        ("weekly_all", _) => "Weekly".into(),
        ("weekly_scoped", Some(model)) => format!("{model} weekly"),
        _ => humanize(kind),
    }
}

fn parse_limit(entry: &Value) -> Option<UsageLimit> {
    let kind = entry["kind"].as_str()?;
    Some(UsageLimit {
        kind: kind.into(),
        label: label(kind, &entry["scope"]),
        percent: entry["percent"].as_f64()?,
        resets_at: entry["resets_at"].as_str().and_then(epoch_seconds),
        severity: entry["severity"].as_str().unwrap_or("normal").into(),
        active: entry["is_active"].as_bool().unwrap_or(false),
    })
}

pub fn plan_name(tier: Option<&str>, subscription: Option<&str>) -> Option<String> {
    match tier {
        Some("max_20x") => Some("Ultra".into()),
        Some("max_5x") => Some("Max".into()),
        _ => subscription.map(humanize),
    }
}

fn orgs_of<'a>(rows: &'a [AccountRow], email: &str) -> HashSet<&'a str> {
    rows.iter()
        .filter(|row| {
            !row.hidden
                && row
                    .email
                    .as_deref()
                    .is_some_and(|other| other.eq_ignore_ascii_case(email))
        })
        .filter_map(|row| row.org_id.as_deref())
        .collect()
}

fn same_login(rows: &[AccountRow], a: &AccountRow, b: &AccountRow) -> bool {
    if a.id == b.id {
        return true;
    }
    let (Some(email), Some(other_email)) = (&a.email, &b.email) else {
        return false;
    };
    email.eq_ignore_ascii_case(other_email)
        && match (&a.org_id, &b.org_id) {
            (Some(org), Some(other_org)) => org == other_org,
            _ => orgs_of(rows, email).len() <= 1,
        }
}

fn has_limits(row: &AccountRow) -> bool {
    row.error.is_none() && !row.limits.is_empty()
}

fn primary_of<'a>(rows: &'a [AccountRow], row: &AccountRow) -> &'a AccountRow {
    let members: Vec<&AccountRow> = rows
        .iter()
        .filter(|other| !other.hidden && same_login(rows, row, other))
        .collect();
    members
        .iter()
        .find(|member| has_limits(member))
        .or_else(|| members.iter().find(|member| member.id == DEFAULT_ID))
        .or(members.first())
        .copied()
        .expect("a visible row is a member of its own login")
}

pub fn primaries(rows: &[AccountRow]) -> HashMap<String, String> {
    rows.iter()
        .filter(|row| !row.hidden)
        .map(|row| (row.id.clone(), primary_of(rows, row).id.clone()))
        .collect()
}

pub fn merged(rows: &[AccountRow]) -> Vec<AccountRow> {
    let primary = primaries(rows);
    rows.iter()
        .filter(|row| primary.get(&row.id) == Some(&row.id))
        .map(|row| AccountRow {
            is_default: rows
                .iter()
                .any(|other| other.is_default && primary.get(&other.id) == Some(&row.id)),
            ..row.clone()
        })
        .collect()
}

pub fn probe_ids(rows: &[AccountRow]) -> Vec<String> {
    rows.iter()
        .filter(|row| !row.hidden)
        .filter(|row| {
            let primary = primary_of(rows, row);
            primary.id == row.id || !has_limits(primary)
        })
        .map(|row| row.id.clone())
        .collect()
}

pub fn folder_account<'a>(rules: &'a HashMap<String, String>, folder: &Path) -> Option<&'a str> {
    rules
        .iter()
        .filter(|(rule, _)| folder.starts_with(rule))
        .max_by_key(|(rule, _)| Path::new(rule).components().count())
        .map(|(_, account)| account.as_str())
}

pub fn parse_usage(response: &Value) -> Result<Usage, String> {
    let Some(limits) = response["rate_limits"]["limits"].as_array() else {
        return Err("claude reported no usage limits for this account".into());
    };
    Ok(Usage {
        plan: response["subscription_type"].as_str().map(String::from),
        limits: limits.iter().filter_map(parse_limit).collect(),
    })
}

pub fn apply_rate_limits(limits: &mut Vec<UsageLimit>, windows: &BTreeMap<String, Window>) {
    for (name, window) in windows {
        let (kind, label) = match name.as_str() {
            "five_hour" => ("session", "5-hour"),
            "seven_day" => ("weekly_all", "Weekly"),
            _ => continue,
        };
        let updated = UsageLimit {
            kind: kind.into(),
            label: label.into(),
            percent: window.utilization * 100.0,
            resets_at: Some(window.resets_at as i64),
            severity: "normal".into(),
            active: false,
        };
        match limits.iter_mut().find(|limit| limit.kind == kind) {
            Some(limit) => {
                limit.percent = updated.percent;
                limit.resets_at = updated.resets_at;
            }
            None => limits.push(updated),
        }
    }
}

pub fn parse_login(id: String, config_dir: Option<PathBuf>, status: &str) -> Option<Login> {
    let status: Value = serde_json::from_str(status).ok()?;
    if status["loggedIn"] != true {
        return None;
    }
    let text = |field: &str| status[field].as_str().map(String::from);
    Some(Login {
        id,
        email: text("email"),
        plan: plan_name(text("planTier").as_deref(), text("subscriptionType").as_deref()),
        org_id: text("orgId"),
        config_dir,
    })
}

pub fn login(env: &Env, config_dir: Option<PathBuf>) -> Option<Login> {
    let (mut command, _) = resolve_claude(env).ok()?;
    no_window(&mut command)
        .args(["auth", "status"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    account_env(&mut command, env, config_dir.as_deref());
    let mut child = spawn_group(&mut command).ok()?;
    let mut stdout = child.inner().stdout.take().expect("stdout is piped");
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut text = String::new();
        let _ = stdout.read_to_string(&mut text);
        let _ = sender.send(text);
    });
    let status = receiver.recv_timeout(PROBE_TIMEOUT);
    let _ = child.kill();
    let _ = child.wait();
    parse_login(account_id_of(config_dir.as_deref()), config_dir, &status.ok()?)
}

pub fn discover(env: &Env, profiles: &Path) -> Vec<Login> {
    let mut dirs: Vec<PathBuf> = fs::read_dir(profiles)
        .into_iter()
        .flatten()
        .flatten()
        .map(|profile| profile.path().join("home"))
        .filter(|home| home.is_dir())
        .collect();
    dirs.sort();
    thread::scope(|scope| {
        let attempts: Vec<_> = std::iter::once(None)
            .chain(dirs.into_iter().map(Some))
            .map(|dir| scope.spawn(move || login(env, dir)))
            .collect();
        attempts
            .into_iter()
            .filter_map(|attempt| attempt.join().ok().flatten())
            .collect()
    })
}

pub fn probe(env: &Env, config_dir: Option<&Path>) -> Result<Value, String> {
    let dir = std::env::temp_dir().join(format!("factory-usage-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&dir).map_err(|error| format!("create {}: {error}", dir.display()))?;
    let reply = ask_usage(env, config_dir, &dir);
    let _ = fs::remove_dir_all(&dir);
    reply
}

fn ask_usage(env: &Env, config_dir: Option<&Path>, cwd: &Path) -> Result<Value, String> {
    let (mut command, _) = resolve_claude(env).map_err(|error| error.to_string())?;
    no_window(&mut command)
        .args([
            "-p",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--verbose",
            "--setting-sources",
            "",
            "--strict-mcp-config",
        ])
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    account_env(&mut command, env, config_dir);
    let mut child = spawn_group(&mut command).map_err(|error| format!("start claude: {error}"))?;
    let mut stdin = child.inner().stdin.take().expect("stdin is piped");
    let stdout = child.inner().stdout.take().expect("stdout is piped");
    let request = json!({
        "type": "control_request",
        "request_id": PROBE_REQUEST_ID,
        "request": {"subtype": "get_usage"},
    });
    let written = writeln!(stdin, "{request}").and_then(|()| stdin.flush());
    let (lines, replies) = mpsc::channel();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if lines.send(line).is_err() {
                return;
            }
        }
    });
    let reply = written
        .map_err(|error| format!("ask claude for usage: {error}"))
        .and_then(|()| await_usage(&replies));
    let _ = child.kill();
    let _ = child.wait();
    reply
}

fn await_usage(lines: &mpsc::Receiver<String>) -> Result<Value, String> {
    let deadline = Instant::now() + PROBE_TIMEOUT;
    loop {
        let wait = deadline.saturating_duration_since(Instant::now());
        let line = lines.recv_timeout(wait).map_err(|_| {
            format!(
                "claude did not report usage within {} s",
                PROBE_TIMEOUT.as_secs()
            )
        })?;
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let response = &value["response"];
        if value["type"] != "control_response" || response["request_id"] != PROBE_REQUEST_ID {
            continue;
        }
        if response["subtype"] == "success" {
            return Ok(response["response"].clone());
        }
        let reason = response["error"].as_str().unwrap_or("no reason given");
        return Err(format!("claude refused to report usage: {reason}"));
    }
}
