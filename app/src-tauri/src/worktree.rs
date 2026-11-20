use std::fmt;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::thread::sleep;
use std::time::Duration;

use serde::Serialize;

use crate::agent::no_window;

const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const REMOVE_ATTEMPTS: u32 = if cfg!(windows) { 3 } else { 1 };
const REMOVE_RETRY_DELAY: Duration = Duration::from_millis(200);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Worktree {
    pub path: PathBuf,
    pub branch: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub enum MergeOutcome {
    Merged { commit: String },
    Conflict { files: Vec<String> },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub enum MergeForecast {
    Clean,
    Conflict { files: Vec<String> },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub enum ChangeStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FileChange {
    pub path: String,
    pub old_path: Option<String>,
    pub status: ChangeStatus,
    pub binary: bool,
    pub before: String,
    pub after: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CommitRow {
    pub sha: String,
    pub subject: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MergeRefusal {
    DetachedHead,
    MergeInProgress,
    RebaseInProgress,
    DirtyCheckout { files: Vec<String> },
    NothingToMerge,
}

impl fmt::Display for MergeRefusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            MergeRefusal::DetachedHead => write!(
                f,
                "The project checkout has no branch checked out (detached HEAD); check out a branch, then merge again."
            ),
            MergeRefusal::MergeInProgress => write!(
                f,
                "The project checkout is in the middle of a merge; finish or abort it, then merge again."
            ),
            MergeRefusal::RebaseInProgress => write!(
                f,
                "The project checkout is in the middle of a rebase; finish or abort it, then merge again."
            ),
            MergeRefusal::DirtyCheckout { files } => write!(
                f,
                "The project checkout has uncommitted changes in {}; commit or stash them, then merge again.",
                files.join(", ")
            ),
            MergeRefusal::NothingToMerge => write!(
                f,
                "This branch has nothing to merge, its commits are already in the project branch; let the session commit its work, then merge again."
            ),
        }
    }
}

#[derive(Debug)]
pub enum WorktreeError {
    Git { command: String, stderr: String },
    Io(String),
    Refused(MergeRefusal),
}

impl fmt::Display for WorktreeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            WorktreeError::Git { command, stderr } => write!(f, "git {command} failed: {stderr}"),
            WorktreeError::Io(message) => write!(f, "{message}"),
            WorktreeError::Refused(refusal) => write!(f, "{refusal}"),
        }
    }
}

impl std::error::Error for WorktreeError {}

impl From<std::io::Error> for WorktreeError {
    fn from(error: std::io::Error) -> Self {
        WorktreeError::Io(error.to_string())
    }
}

pub fn ensure_repo(path: &Path) -> Result<bool, WorktreeError> {
    if git(path, &["rev-parse", "--verify", "--quiet", "HEAD"]).is_ok() {
        return Ok(false);
    }
    git(path, &["init", "-q"])?;
    let commit = git(
        path,
        &[
            "-c",
            "user.name=Factory",
            "-c",
            "user.email=factory@localhost",
            "commit-tree",
            EMPTY_TREE,
            "-m",
            "Initial commit",
        ],
    )?;
    git(path, &["update-ref", "HEAD", commit.trim()])?;
    Ok(true)
}

pub fn job_worktree(root: &Path, repo: &Path, slug: &str) -> Result<Worktree, WorktreeError> {
    add(root, repo, format!("factory/{slug}"))
}

pub fn agent_branch(job_branch: &str, agent: &str) -> String {
    let slug = job_branch.trim_start_matches("factory/");
    format!("factory-agent/{slug}/{agent}")
}

pub fn agent_worktree(root: &Path, job: &Worktree, agent: &str) -> Result<Worktree, WorktreeError> {
    add(root, &job.path, agent_branch(&job.branch, agent))
}

pub fn merge_agent(job: &Worktree, agent: &Worktree) -> Result<MergeOutcome, WorktreeError> {
    merge(&job.path, &agent.branch)
}

pub fn merge_job(repo: &Path, slug: &str) -> Result<MergeOutcome, WorktreeError> {
    let branch = format!("factory/{slug}");
    if let Some(refusal) = merge_refusal(repo, &branch)? {
        return Err(WorktreeError::Refused(refusal));
    }
    merge(repo, &branch)
}

pub fn current_branch(repo: &Path) -> Result<Option<String>, WorktreeError> {
    let args = ["symbolic-ref", "--quiet", "--short", "HEAD"];
    let output = run(repo, &args)?;
    match output.status.code() {
        Some(0) => Ok(Some(String::from_utf8_lossy(&output.stdout).trim().to_string())),
        Some(1) => Ok(None),
        _ => Err(WorktreeError::Git {
            command: args.join(" "),
            stderr: String::from_utf8_lossy(&output.stderr).trim().to_string(),
        }),
    }
}

fn merge_refusal(repo: &Path, branch: &str) -> Result<Option<MergeRefusal>, WorktreeError> {
    if git_path_exists(repo, "rebase-merge")? || git_path_exists(repo, "rebase-apply")? {
        return Ok(Some(MergeRefusal::RebaseInProgress));
    }
    if git_path_exists(repo, "MERGE_HEAD")? {
        return Ok(Some(MergeRefusal::MergeInProgress));
    }
    if current_branch(repo)?.is_none() {
        return Ok(Some(MergeRefusal::DetachedHead));
    }
    let dirty = git(repo, &["diff", "HEAD", "--name-only", "-z"])?;
    let files: Vec<String> = dirty.split_terminator('\0').map(str::to_string).collect();
    if !files.is_empty() {
        return Ok(Some(MergeRefusal::DirtyCheckout { files }));
    }
    if is_merged(repo, branch)? {
        return Ok(Some(MergeRefusal::NothingToMerge));
    }
    Ok(None)
}

fn git_path_exists(repo: &Path, name: &str) -> Result<bool, WorktreeError> {
    let path = git(repo, &["rev-parse", "--git-path", name])?;
    Ok(repo.join(path.trim()).exists())
}

pub fn forecast_job(repo: &Path, slug: &str) -> Result<MergeForecast, WorktreeError> {
    forecast_pair(repo, "HEAD", &format!("factory/{slug}"))
}

pub fn forecast_pair(repo: &Path, ours: &str, theirs: &str) -> Result<MergeForecast, WorktreeError> {
    let args = ["merge-tree", "--write-tree", "--name-only", "-z", ours, theirs];
    let output = run(repo, &args)?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    match output.status.code() {
        Some(0) => Ok(MergeForecast::Clean),
        Some(1) => Ok(MergeForecast::Conflict {
            files: stdout
                .split('\0')
                .skip(1)
                .take_while(|path| !path.is_empty())
                .map(str::to_string)
                .collect(),
        }),
        _ => Err(WorktreeError::Git {
            command: args.join(" "),
            stderr: String::from_utf8_lossy(&output.stderr).trim().to_string(),
        }),
    }
}

pub fn branch_changes(repo: &Path, slug: &str) -> Result<Vec<FileChange>, WorktreeError> {
    let branch = format!("factory/{slug}");
    let base = git(repo, &["merge-base", "HEAD", &branch])?;
    changes(repo, base.trim(), Some(&branch))
}

pub fn uncommitted_changes(worktree: &Path) -> Result<Vec<FileChange>, WorktreeError> {
    let mut changes = changes(worktree, "HEAD", None)?;
    let untracked = git(worktree, &["ls-files", "--others", "--exclude-standard", "-z"])?;
    for path in untracked.split_terminator('\0') {
        let after = std::fs::read(worktree.join(path))?;
        changes.push(file_change(path, None, ChangeStatus::Added, Vec::new(), after));
    }
    Ok(changes)
}

pub fn commit_changes(repo: &Path, sha: &str) -> Result<Vec<FileChange>, WorktreeError> {
    changes(repo, &format!("{sha}^"), Some(sha))
}

pub fn branch_commits(repo: &Path, slug: &str) -> Result<Vec<CommitRow>, WorktreeError> {
    let branch = format!("factory/{slug}");
    let base = git(repo, &["merge-base", "HEAD", &branch])?;
    let range = format!("{}..{branch}", base.trim());
    let log = git(repo, &["log", "--format=%H %s", &range])?;
    Ok(log
        .lines()
        .map(|line| {
            let (sha, subject) = line.split_once(' ').unwrap_or((line, ""));
            CommitRow {
                sha: sha.to_string(),
                subject: subject.to_string(),
            }
        })
        .collect())
}

fn changes(dir: &Path, from: &str, to: Option<&str>) -> Result<Vec<FileChange>, WorktreeError> {
    let mut args = vec![
        "diff",
        "--name-status",
        "-z",
        "-M",
        "--no-color",
        "--no-ext-diff",
        from,
    ];
    args.extend(to);
    let listing = git(dir, &args)?;
    let fields: Vec<&str> = listing.split_terminator('\0').collect();
    let mut rest = fields.as_slice();
    let mut changes = Vec::new();
    loop {
        let (status, old_path, path, tail) = match rest {
            [] => return Ok(changes),
            [code, old, new, tail @ ..] if code.starts_with('R') => {
                (ChangeStatus::Renamed, Some(*old), *new, tail)
            }
            [code, path, tail @ ..] => (change_status(code), None, *path, tail),
            [code] => {
                return Err(WorktreeError::Io(format!(
                    "git {} listed status {code} without a path",
                    args.join(" ")
                )))
            }
        };
        let before = match status {
            ChangeStatus::Added => Vec::new(),
            _ => blob(dir, from, old_path.unwrap_or(path))?,
        };
        let after = match (&status, to) {
            (ChangeStatus::Deleted, _) => Vec::new(),
            (_, Some(rev)) => blob(dir, rev, path)?,
            (_, None) => std::fs::read(dir.join(path))?,
        };
        changes.push(file_change(path, old_path, status, before, after));
        rest = tail;
    }
}

fn file_change(
    path: &str,
    old_path: Option<&str>,
    status: ChangeStatus,
    before: Vec<u8>,
    after: Vec<u8>,
) -> FileChange {
    let (binary, before, after) = match (text(before), text(after)) {
        (Some(before), Some(after)) => (false, before, after),
        _ => (true, String::new(), String::new()),
    };
    FileChange {
        path: path.to_string(),
        old_path: old_path.map(str::to_string),
        status,
        binary,
        before,
        after,
    }
}

fn change_status(code: &str) -> ChangeStatus {
    match code {
        "A" => ChangeStatus::Added,
        "D" => ChangeStatus::Deleted,
        _ => ChangeStatus::Modified,
    }
}

fn blob(dir: &Path, rev: &str, path: &str) -> Result<Vec<u8>, WorktreeError> {
    git_bytes(dir, &["show", &format!("{rev}:{path}")])
}

fn text(bytes: Vec<u8>) -> Option<String> {
    if bytes.iter().take(8000).any(|byte| *byte == 0) {
        return None;
    }
    String::from_utf8(bytes).ok()
}

pub fn remove(from: &Path, worktree: &Worktree) -> Result<(), WorktreeError> {
    let path = worktree.path.to_string_lossy();
    let mut attempt = 1;
    loop {
        match git(from, &["worktree", "remove", &path]) {
            Err(_) if attempt < REMOVE_ATTEMPTS => {
                attempt += 1;
                sleep(REMOVE_RETRY_DELAY);
            }
            result => return result.map(|_| ()),
        }
    }
}

pub fn delete(repo: &Path, worktrees: &[Worktree]) -> Result<(), WorktreeError> {
    discard(repo, worktrees, true)
}

pub fn clean_up(repo: &Path, worktrees: &[Worktree]) -> Result<(), WorktreeError> {
    for worktree in worktrees {
        if is_registered(repo, &worktree.path)?
            && !git(&worktree.path, &["status", "--porcelain"])?.is_empty()
        {
            return Err(WorktreeError::Io(format!(
                "worktree {} has uncommitted or untracked files",
                worktree.path.display()
            )));
        }
        if branch_exists(repo, &worktree.branch) && !is_merged(repo, &worktree.branch)? {
            return Err(WorktreeError::Io(format!(
                "branch {} is not merged",
                worktree.branch
            )));
        }
    }
    discard(repo, worktrees, false)
}

fn is_merged(repo: &Path, branch: &str) -> Result<bool, WorktreeError> {
    let output = run(repo, &["merge-base", "--is-ancestor", branch, "HEAD"])?;
    Ok(output.status.success())
}

fn discard(repo: &Path, worktrees: &[Worktree], force: bool) -> Result<(), WorktreeError> {
    let (remove_flags, branch_flag): (&[&str], &str) = match force {
        true => (&["--force"], "-D"),
        false => (&[], "-d"),
    };
    for worktree in worktrees {
        if is_registered(repo, &worktree.path)? {
            let path = worktree.path.to_string_lossy();
            let args = [&["worktree", "remove"], remove_flags, &[&*path]].concat();
            git(repo, &args)?;
        }
    }
    git(repo, &["worktree", "prune"])?;
    for worktree in worktrees {
        if branch_exists(repo, &worktree.branch) {
            git(repo, &["branch", branch_flag, &worktree.branch])?;
        }
    }
    Ok(())
}

pub fn same_path(a: &Path, b: &Path) -> bool {
    comparable(a) == comparable(b)
}

fn comparable(path: &Path) -> String {
    let text = path.to_string_lossy();
    let text = text
        .strip_prefix(r"\\?\")
        .unwrap_or(&text)
        .replace('\\', "/");
    if cfg!(windows) {
        text.to_lowercase()
    } else {
        text
    }
}

fn add(root: &Path, from: &Path, branch: String) -> Result<Worktree, WorktreeError> {
    let path = root.join("wt").join(short_id(&branch));
    let worktree = Worktree { path, branch };
    if is_registered(from, &worktree.path)? {
        return Ok(worktree);
    }
    std::fs::create_dir_all(root.join("wt"))?;
    let path = worktree.path.to_string_lossy();
    if branch_exists(from, &worktree.branch) {
        git(from, &["worktree", "add", &path, &worktree.branch])?;
    } else {
        git(from, &["worktree", "add", "-b", &worktree.branch, &path])?;
    }
    Ok(worktree)
}

fn is_registered(from: &Path, path: &Path) -> Result<bool, WorktreeError> {
    let Ok(path) = path.canonicalize() else {
        return Ok(false);
    };
    let listing = git(from, &["worktree", "list", "--porcelain"])?;
    Ok(listing
        .lines()
        .filter_map(|line| line.strip_prefix("worktree "))
        .any(|listed| same_path(Path::new(listed), &path)))
}

fn short_id(branch: &str) -> String {
    let hash = branch.bytes().fold(0xcbf29ce484222325u64, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3)
    });
    format!("{:08x}", hash & 0xffff_ffff)
}

pub fn branch_exists(from: &Path, branch: &str) -> bool {
    let reference = format!("refs/heads/{branch}");
    run(from, &["rev-parse", "--verify", "--quiet", &reference])
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn merge(dir: &Path, branch: &str) -> Result<MergeOutcome, WorktreeError> {
    let message = format!("merge {branch}");
    match git(dir, &["merge", "--no-ff", "-m", &message, branch]) {
        Ok(_) => Ok(MergeOutcome::Merged {
            commit: git(dir, &["rev-parse", "HEAD"])?.trim().to_string(),
        }),
        Err(error) => {
            let unmerged = git(dir, &["diff", "--name-only", "--diff-filter=U"])?;
            let files: Vec<String> = unmerged.lines().map(str::to_string).collect();
            if files.is_empty() {
                return Err(error);
            }
            git(dir, &["merge", "--abort"])?;
            Ok(MergeOutcome::Conflict { files })
        }
    }
}

fn git(dir: &Path, args: &[&str]) -> Result<String, WorktreeError> {
    Ok(String::from_utf8_lossy(&git_bytes(dir, args)?).into_owned())
}

fn git_bytes(dir: &Path, args: &[&str]) -> Result<Vec<u8>, WorktreeError> {
    let output = run(dir, args)?;
    if !output.status.success() {
        return Err(WorktreeError::Git {
            command: args.join(" "),
            stderr: String::from_utf8_lossy(&output.stderr).trim().to_string(),
        });
    }
    Ok(output.stdout)
}

fn run(dir: &Path, args: &[&str]) -> Result<Output, WorktreeError> {
    let mut command = Command::new("git");
    no_window(&mut command);
    if cfg!(windows) {
        command.args(["-c", "core.longpaths=true", "-c", "core.autocrlf=false"]);
    }
    Ok(command.current_dir(dir).args(args).output()?)
}
