use std::path::Path;
use std::process::Command;
use std::sync::OnceLock;

use serde::Serialize;
use serde_json::Value;

use crate::agent::{no_window, system_env, Env};

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct Links {
    pub repo_url: Option<String>,
    pub branch_url: Option<String>,
    pub pull_request: Option<PullRequest>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PullRequest {
    pub number: u64,
    pub title: String,
    pub url: String,
    pub state: String,
    pub checks: Option<Checks>,
    pub issues: Vec<Issue>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Checks {
    Passing,
    Failing,
    Pending,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Issue {
    pub number: u64,
    pub url: String,
}

const FAILED: [&str; 6] = ["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"];

pub fn repo_of(remote: &str) -> Option<String> {
    let path = ["https://github.com/", "git@github.com:", "ssh://git@github.com/"]
        .iter()
        .find_map(|prefix| remote.trim().strip_prefix(prefix))?;
    let path = path.trim_end_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);
    (path.split('/').count() == 2).then(|| path.to_string())
}

fn outcome(check: &Value) -> &str {
    check["conclusion"].as_str().filter(|value| !value.is_empty()).or(check["state"].as_str()).unwrap_or("")
}

pub fn checks_of(rollup: &Value) -> Option<Checks> {
    let checks = rollup.as_array().filter(|checks| !checks.is_empty())?;
    if checks.iter().any(|check| FAILED.contains(&outcome(check))) {
        return Some(Checks::Failing);
    }
    let running = |check: &Value| match check["status"].as_str() {
        Some(status) => status != "COMPLETED",
        None => matches!(outcome(check), "PENDING" | "EXPECTED" | ""),
    };
    Some(if checks.iter().any(running) { Checks::Pending } else { Checks::Passing })
}

pub fn pull_request_of(list: &Value) -> Option<PullRequest> {
    let pr = list.as_array()?.first()?;
    let state = match (pr["state"].as_str()?, pr["isDraft"].as_bool() == Some(true)) {
        ("OPEN", true) => "draft".to_string(),
        (state, _) => state.to_lowercase(),
    };
    Some(PullRequest {
        number: pr["number"].as_u64()?,
        title: pr["title"].as_str()?.into(),
        url: pr["url"].as_str()?.into(),
        state,
        checks: checks_of(&pr["statusCheckRollup"]),
        issues: pr["closingIssuesReferences"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|issue| Some(Issue { number: issue["number"].as_u64()?, url: issue["url"].as_str()?.into() }))
            .collect(),
    })
}

fn env() -> &'static Env {
    static ENV: OnceLock<Env> = OnceLock::new();
    ENV.get_or_init(system_env)
}

fn output(program: &str, dir: &Path, args: &[&str]) -> Option<String> {
    let mut command = Command::new(program);
    no_window(&mut command);
    let output = command.current_dir(dir).env_clear().envs(env()).args(args).output().ok()?;
    output.status.success().then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

pub fn links(project: &Path, branch: &str) -> Links {
    let remote = output("git", project, &["config", "--get", &format!("branch.{branch}.remote")]).unwrap_or_else(|| "origin".into());
    let Some(repo) = output("git", project, &["remote", "get-url", &remote]).as_deref().and_then(repo_of) else {
        return Links::default();
    };
    let pushed = output("git", project, &["rev-parse", "--verify", "--quiet", &format!("refs/remotes/{remote}/{branch}")]).is_some();
    let fields = "number,title,url,state,isDraft,statusCheckRollup,closingIssuesReferences";
    let pull_request = output("gh", project, &["pr", "list", "--repo", &repo, "--head", branch, "--state", "all", "--limit", "1", "--json", fields])
        .and_then(|text| serde_json::from_str(&text).ok())
        .and_then(|list: Value| pull_request_of(&list));
    let repo_url = format!("https://github.com/{repo}");
    Links {
        branch_url: pushed.then(|| format!("{repo_url}/tree/{branch}")),
        repo_url: Some(repo_url),
        pull_request,
    }
}
