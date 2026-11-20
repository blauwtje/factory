use std::fs;
use std::path::Path;
use std::process::Command;
use std::sync::{Mutex, MutexGuard};

use factory_lib::worktree::{
    agent_worktree, branch_changes, branch_commits, branch_exists, clean_up, commit_changes,
    current_branch, ensure_repo, forecast_job, forecast_pair, job_worktree, merge_agent, merge_job, remove, same_path,
    uncommitted_changes, ChangeStatus, CommitRow, FileChange, MergeForecast, MergeOutcome,
    MergeRefusal, WorktreeError,
};
use tempfile::TempDir;

fn git(dir: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .current_dir(dir)
        .args(["-c", "user.name=Test", "-c", "user.email=test@example.com"])
        .args(args)
        .output()
        .unwrap();
    assert!(output.status.success(), "git {args:?}: {output:?}");
    String::from_utf8(output.stdout).unwrap()
}

fn commit_file(dir: &Path, name: &str, content: &str) {
    fs::write(dir.join(name), content).unwrap();
    git(dir, &["add", name]);
    git(dir, &["commit", "-m", name]);
}

fn repo() -> TempDir {
    let dir = TempDir::new().unwrap();
    git(dir.path(), &["init", "-q"]);
    commit_file(dir.path(), "shared.txt", "base\n");
    dir
}

static ENV: Mutex<()> = Mutex::new(());

fn identity() -> MutexGuard<'static, ()> {
    let guard = ENV.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    for (key, value) in [
        ("GIT_AUTHOR_NAME", "Test"),
        ("GIT_AUTHOR_EMAIL", "test@example.com"),
        ("GIT_COMMITTER_NAME", "Test"),
        ("GIT_COMMITTER_EMAIL", "test@example.com"),
    ] {
        std::env::set_var(key, value);
    }
    guard
}

#[test]
fn job_worktree_is_a_checkout_on_the_job_branch_under_the_root() {
    let (repo, root) = (repo(), TempDir::new().unwrap());
    let job = job_worktree(root.path(), repo.path(), "add-login").unwrap();
    assert_eq!(job.branch, "factory/add-login");
    assert!(job.path.starts_with(root.path().join("wt")));
    assert!(job.path.join("shared.txt").exists());
    assert_eq!(
        git(&job.path, &["branch", "--show-current"]).trim(),
        "factory/add-login"
    );
}

#[test]
fn creating_the_same_worktree_twice_returns_the_same_one() {
    let (repo, root) = (repo(), TempDir::new().unwrap());
    let first = job_worktree(root.path(), repo.path(), "add-login").unwrap();
    let second = job_worktree(root.path(), repo.path(), "add-login").unwrap();
    assert_eq!(first, second);
}

#[test]
fn agent_branch_lives_beside_the_job_branch() {
    let (repo, root) = (repo(), TempDir::new().unwrap());
    let job = job_worktree(root.path(), repo.path(), "add-login").unwrap();
    let agent = agent_worktree(root.path(), &job, "builder-1").unwrap();
    assert_eq!(agent.branch, "factory-agent/add-login/builder-1");
    assert_ne!(agent.path, job.path);
    assert_eq!(
        git(&agent.path, &["branch", "--show-current"]).trim(),
        "factory-agent/add-login/builder-1"
    );
}

#[test]
fn merge_agent_brings_the_agent_commits_into_the_job_branch() {
    let _env = identity();
    let (repo, root) = (repo(), TempDir::new().unwrap());
    let job = job_worktree(root.path(), repo.path(), "add-login").unwrap();
    let agent = agent_worktree(root.path(), &job, "builder-1").unwrap();
    commit_file(&agent.path, "login.rs", "fn login() {}\n");
    let outcome = merge_agent(&job, &agent).unwrap();
    let head = git(&job.path, &["rev-parse", "HEAD"]).trim().to_string();
    assert_eq!(outcome, MergeOutcome::Merged { commit: head });
    assert!(job.path.join("login.rs").exists());
}

#[test]
fn conflicting_agents_report_the_files_and_leave_the_job_clean() {
    let _env = identity();
    let (repo, root) = (repo(), TempDir::new().unwrap());
    let job = job_worktree(root.path(), repo.path(), "add-login").unwrap();
    let first = agent_worktree(root.path(), &job, "builder-1").unwrap();
    let second = agent_worktree(root.path(), &job, "builder-2").unwrap();
    commit_file(&first.path, "shared.txt", "one\n");
    commit_file(&second.path, "shared.txt", "two\n");
    assert!(matches!(
        merge_agent(&job, &first).unwrap(),
        MergeOutcome::Merged { .. }
    ));
    let outcome = merge_agent(&job, &second).unwrap();
    assert_eq!(
        outcome,
        MergeOutcome::Conflict {
            files: vec!["shared.txt".into()]
        }
    );
    assert_eq!(git(&job.path, &["status", "--porcelain"]), "");
    assert_eq!(
        fs::read_to_string(job.path.join("shared.txt")).unwrap(),
        "one\n"
    );
}

#[test]
fn merge_job_merges_the_job_branch_into_the_repo_checkout() {
    let _env = identity();
    let (repo, root) = (repo(), TempDir::new().unwrap());
    let job = job_worktree(root.path(), repo.path(), "add-login").unwrap();
    commit_file(&job.path, "login.rs", "fn login() {}\n");
    let outcome = merge_job(repo.path(), "add-login").unwrap();
    let head = git(repo.path(), &["rev-parse", "HEAD"]).trim().to_string();
    assert_eq!(outcome, MergeOutcome::Merged { commit: head });
    assert!(repo.path().join("login.rs").exists());
}

#[test]
fn merge_job_reports_conflicts_without_leaving_a_merge_behind() {
    let _env = identity();
    let (repo, root) = (repo(), TempDir::new().unwrap());
    let job = job_worktree(root.path(), repo.path(), "add-login").unwrap();
    commit_file(&job.path, "shared.txt", "job\n");
    commit_file(repo.path(), "shared.txt", "main\n");
    let outcome = merge_job(repo.path(), "add-login").unwrap();
    assert_eq!(
        outcome,
        MergeOutcome::Conflict {
            files: vec!["shared.txt".into()]
        }
    );
    assert_eq!(git(repo.path(), &["status", "--porcelain"]), "");
}

fn refusal(repo: &Path) -> MergeRefusal {
    match merge_job(repo, "add-login") {
        Err(WorktreeError::Refused(refusal)) => refusal,
        other => panic!("expected a refusal, got {other:?}"),
    }
}

fn repo_with_job_commit() -> (TempDir, TempDir) {
    let (repo, root) = (repo(), TempDir::new().unwrap());
    let job = job_worktree(root.path(), repo.path(), "add-login").unwrap();
    commit_file(&job.path, "login.rs", "fn login() {}\n");
    (repo, root)
}

#[test]
fn merge_refuses_a_detached_head() {
    let _env = identity();
    let (repo, _root) = repo_with_job_commit();
    let branch = git(repo.path(), &["branch", "--show-current"]).trim().to_string();
    assert_eq!(current_branch(repo.path()).unwrap(), Some(branch));
    git(repo.path(), &["checkout", "-q", "--detach"]);

    assert_eq!(current_branch(repo.path()).unwrap(), None);
    assert_eq!(refusal(repo.path()), MergeRefusal::DetachedHead);
    assert!(!repo.path().join("login.rs").exists());
}

#[test]
fn merge_refuses_while_a_merge_is_in_progress() {
    let _env = identity();
    let (repo, root) = repo_with_job_commit();
    let other = job_worktree(root.path(), repo.path(), "other").unwrap();
    commit_file(&other.path, "other.rs", "fn other() {}\n");
    git(repo.path(), &["merge", "--no-commit", "--no-ff", "factory/other"]);

    assert_eq!(refusal(repo.path()), MergeRefusal::MergeInProgress);
}

#[test]
fn merge_refuses_while_a_rebase_is_in_progress() {
    let _env = identity();
    let (repo, _root) = repo_with_job_commit();
    commit_file(repo.path(), "main.txt", "main\n");
    let stopped = Command::new("git")
        .current_dir(repo.path())
        .args(["rebase", "--exec", "false", "HEAD~1"])
        .output()
        .unwrap();
    assert!(!stopped.status.success());

    assert_eq!(refusal(repo.path()), MergeRefusal::RebaseInProgress);
}

#[test]
fn merge_refuses_tracked_uncommitted_changes_naming_the_files() {
    let _env = identity();
    let (repo, _root) = repo_with_job_commit();
    fs::write(repo.path().join("shared.txt"), "edited\n").unwrap();
    fs::write(repo.path().join("draft.txt"), "draft\n").unwrap();

    let refused = refusal(repo.path());
    assert_eq!(
        refused,
        MergeRefusal::DirtyCheckout {
            files: vec!["shared.txt".into()]
        }
    );
    assert!(refused.to_string().contains("shared.txt"), "{refused}");
}

#[test]
fn merge_refuses_nothing_for_untracked_files() {
    let _env = identity();
    let (repo, _root) = repo_with_job_commit();
    fs::write(repo.path().join("draft.txt"), "draft\n").unwrap();

    assert!(matches!(
        merge_job(repo.path(), "add-login").unwrap(),
        MergeOutcome::Merged { .. }
    ));
}

#[test]
fn merge_refuses_a_branch_with_nothing_to_merge() {
    let (repo, root) = (repo(), TempDir::new().unwrap());
    job_worktree(root.path(), repo.path(), "add-login").unwrap();

    assert_eq!(refusal(repo.path()), MergeRefusal::NothingToMerge);
}

#[test]
fn remove_deletes_the_worktree_directory() {
    let (repo, root) = (repo(), TempDir::new().unwrap());
    let job = job_worktree(root.path(), repo.path(), "add-login").unwrap();
    remove(repo.path(), &job).unwrap();
    assert!(!job.path.exists());
}

#[test]
fn paths_compare_without_the_extended_length_prefix() {
    assert!(same_path(
        Path::new(r"\\?\C:\wt\ab12"),
        Path::new(r"C:\wt\ab12")
    ));
    assert!(!same_path(Path::new("/wt/ab12"), Path::new("/wt/cd34")));
}

#[test]
fn canonical_windows_path_equals_git_listed_forward_slash_path() {
    assert!(same_path(
        Path::new("C:/Users/x/wt"),
        Path::new(r"\\?\C:\Users\x\wt")
    ));
}

#[cfg(windows)]
#[test]
fn paths_compare_case_insensitively_on_windows() {
    assert!(same_path(
        Path::new(r"C:\WT\ab12"),
        Path::new(r"c:\wt\AB12")
    ));
}

#[test]
fn a_plain_folder_becomes_a_repo_with_an_empty_first_commit() {
    let _env = identity();
    let dir = TempDir::new().unwrap();
    assert!(ensure_repo(dir.path()).unwrap());
    assert_eq!(
        git(dir.path(), &["log", "--format=%s"]).trim(),
        "Initial commit"
    );
    assert_eq!(
        git(dir.path(), &["rev-list", "--count", "HEAD"]).trim(),
        "1"
    );
}

#[test]
fn a_repo_without_commits_gets_the_first_commit() {
    let _env = identity();
    let dir = TempDir::new().unwrap();
    git(dir.path(), &["init", "-q"]);
    assert!(ensure_repo(dir.path()).unwrap());
    assert_eq!(
        git(dir.path(), &["rev-list", "--count", "HEAD"]).trim(),
        "1"
    );
}

#[test]
fn a_repo_with_history_is_left_alone() {
    let _env = identity();
    let dir = repo();
    assert!(!ensure_repo(dir.path()).unwrap());
    assert!(!ensure_repo(dir.path()).unwrap());
    assert_eq!(
        git(dir.path(), &["rev-list", "--count", "HEAD"]).trim(),
        "1"
    );
}

#[test]
fn a_plain_folder_becomes_a_repo_without_a_git_identity() {
    let _env = identity();
    for key in [
        "GIT_AUTHOR_NAME",
        "GIT_AUTHOR_EMAIL",
        "GIT_COMMITTER_NAME",
        "GIT_COMMITTER_EMAIL",
    ] {
        std::env::remove_var(key);
    }
    std::env::set_var("GIT_CONFIG_GLOBAL", "/dev/null");
    std::env::set_var("GIT_CONFIG_NOSYSTEM", "1");
    std::env::set_var("GIT_CONFIG_COUNT", "1");
    std::env::set_var("GIT_CONFIG_KEY_0", "user.useConfigOnly");
    std::env::set_var("GIT_CONFIG_VALUE_0", "true");
    let dir = TempDir::new().unwrap();
    let result = ensure_repo(dir.path());
    for key in [
        "GIT_CONFIG_GLOBAL",
        "GIT_CONFIG_NOSYSTEM",
        "GIT_CONFIG_COUNT",
    ] {
        std::env::remove_var(key);
    }
    assert!(result.unwrap());
}

#[test]
fn the_first_commit_leaves_staged_files_out() {
    let _env = identity();
    let dir = TempDir::new().unwrap();
    git(dir.path(), &["init", "-q"]);
    fs::write(dir.path().join("secret.txt"), "x").unwrap();
    git(dir.path(), &["add", "secret.txt"]);
    ensure_repo(dir.path()).unwrap();
    assert_eq!(
        git(dir.path(), &["ls-tree", "-r", "--name-only", "HEAD"]).trim(),
        ""
    );
}

#[test]
fn forecast_job_reports_a_clean_merge_and_changes_nothing() {
    let _env = identity();
    let (repo, root) = (repo(), TempDir::new().unwrap());
    let job = job_worktree(root.path(), repo.path(), "add-login").unwrap();
    commit_file(&job.path, "login.rs", "fn login() {}\n");
    let head = git(repo.path(), &["rev-parse", "HEAD"]);
    assert_eq!(
        forecast_job(repo.path(), "add-login").unwrap(),
        MergeForecast::Clean
    );
    assert_eq!(git(repo.path(), &["rev-parse", "HEAD"]), head);
    assert!(!repo.path().join("login.rs").exists());
    assert_eq!(git(repo.path(), &["status", "--porcelain"]), "");
}

#[test]
fn forecast_job_lists_the_files_that_would_conflict() {
    let _env = identity();
    let (repo, root) = (repo(), TempDir::new().unwrap());
    let job = job_worktree(root.path(), repo.path(), "add-login").unwrap();
    commit_file(&job.path, "shared.txt", "job\n");
    commit_file(repo.path(), "shared.txt", "main\n");
    assert_eq!(
        forecast_job(repo.path(), "add-login").unwrap(),
        MergeForecast::Conflict {
            files: vec!["shared.txt".into()]
        }
    );
    assert_eq!(git(repo.path(), &["status", "--porcelain"]), "");
}

#[test]
fn forecast_pair_lists_the_files_two_job_branches_would_conflict_in() {
    let _env = identity();
    let (repo, root) = (repo(), TempDir::new().unwrap());
    let login = job_worktree(root.path(), repo.path(), "add-login").unwrap();
    let logout = job_worktree(root.path(), repo.path(), "add-logout").unwrap();
    commit_file(&login.path, "shared.txt", "login\n");
    commit_file(&logout.path, "shared.txt", "logout\n");
    assert_eq!(
        forecast_pair(repo.path(), "factory/add-login", "factory/add-logout").unwrap(),
        MergeForecast::Conflict {
            files: vec!["shared.txt".into()]
        }
    );
    assert_eq!(git(repo.path(), &["status", "--porcelain"]), "");
}

#[test]
fn forecast_pair_reports_two_job_branches_with_separate_files_as_clean() {
    let _env = identity();
    let (repo, root) = (repo(), TempDir::new().unwrap());
    let login = job_worktree(root.path(), repo.path(), "add-login").unwrap();
    let logout = job_worktree(root.path(), repo.path(), "add-logout").unwrap();
    commit_file(&login.path, "login.rs", "fn login() {}\n");
    commit_file(&logout.path, "logout.rs", "fn logout() {}\n");
    assert_eq!(
        forecast_pair(repo.path(), "factory/add-login", "factory/add-logout").unwrap(),
        MergeForecast::Clean
    );
}

#[test]
fn branch_exists_tells_a_job_branch_from_a_missing_one() {
    let (repo, root) = (repo(), TempDir::new().unwrap());
    job_worktree(root.path(), repo.path(), "add-login").unwrap();
    assert!(branch_exists(repo.path(), "factory/add-login"));
    assert!(!branch_exists(repo.path(), "factory/missing"));
}

#[test]
fn clean_up_removes_merged_worktrees_and_branches_and_can_run_again() {
    let _env = identity();
    let (repo, root) = (repo(), TempDir::new().unwrap());
    let job = job_worktree(root.path(), repo.path(), "add-login").unwrap();
    commit_file(&job.path, "login.rs", "fn login() {}\n");
    merge_job(repo.path(), "add-login").unwrap();
    clean_up(repo.path(), &[job.clone()]).unwrap();
    assert!(!job.path.exists());
    assert_eq!(git(repo.path(), &["branch", "--list", &job.branch]), "");
    clean_up(repo.path(), &[job]).unwrap();
}

#[test]
fn clean_up_keeps_a_branch_with_unmerged_work() {
    let _env = identity();
    let (repo, root) = (repo(), TempDir::new().unwrap());
    let job = job_worktree(root.path(), repo.path(), "add-login").unwrap();
    commit_file(&job.path, "login.rs", "fn login() {}\n");
    assert!(clean_up(repo.path(), &[job.clone()]).is_err());
    assert!(!git(repo.path(), &["branch", "--list", &job.branch]).is_empty());
}

#[test]
fn clean_up_refuses_before_removing_anything_when_a_branch_is_unmerged() {
    let _env = identity();
    let (repo, root) = (repo(), TempDir::new().unwrap());
    let job = job_worktree(root.path(), repo.path(), "add-login").unwrap();
    let agent = agent_worktree(root.path(), &job, "alice").unwrap();
    commit_file(&job.path, "login.rs", "fn login() {}\n");
    commit_file(&agent.path, "extra.rs", "fn extra() {}\n");
    merge_job(repo.path(), "add-login").unwrap();
    let error = clean_up(repo.path(), &[job.clone(), agent.clone()]).unwrap_err();
    assert!(error.to_string().contains(&agent.branch), "{error}");
    assert!(job.path.exists() && agent.path.exists());
    assert!(!git(repo.path(), &["branch", "--list", &job.branch]).is_empty());
}

#[test]
fn clean_up_refuses_before_removing_anything_when_a_worktree_has_untracked_files() {
    let _env = identity();
    let (repo, root) = (repo(), TempDir::new().unwrap());
    let job = job_worktree(root.path(), repo.path(), "add-login").unwrap();
    let agent = agent_worktree(root.path(), &job, "alice").unwrap();
    commit_file(&job.path, "login.rs", "fn login() {}\n");
    merge_job(repo.path(), "add-login").unwrap();
    git(&agent.path, &["merge", "--ff-only", &job.branch]);
    fs::write(agent.path.join("notes.txt"), "draft\n").unwrap();
    let error = clean_up(repo.path(), &[job.clone(), agent.clone()]).unwrap_err();
    assert!(error.to_string().contains(&agent.path.to_string_lossy().to_string()), "{error}");
    assert!(job.path.exists() && agent.path.exists());
}

fn commit_bytes(dir: &Path, name: &str, content: &[u8]) {
    fs::write(dir.join(name), content).unwrap();
    git(dir, &["add", name]);
    git(dir, &["commit", "-m", name]);
}

fn change(path: &str, status: ChangeStatus, before: &str, after: &str) -> FileChange {
    FileChange {
        path: path.into(),
        old_path: None,
        status,
        binary: false,
        before: before.into(),
        after: after.into(),
    }
}

#[test]
fn branch_changes_lists_each_changed_file_against_the_merge_base() {
    let _env = identity();
    let (repo, root) = (repo(), TempDir::new().unwrap());
    commit_file(repo.path(), "gone.txt", "bye\n");
    commit_file(repo.path(), "old-name.txt", "one\ntwo\nthree\nfour\n");
    commit_bytes(repo.path(), "image.bin", b"\0\x01\x02");
    let job = job_worktree(root.path(), repo.path(), "add-login").unwrap();
    commit_file(&job.path, "shared.txt", "job\n");
    commit_file(&job.path, "added.txt", "new\n");
    commit_bytes(&job.path, "latin.txt", b"caf\xe9\n");
    commit_bytes(&job.path, "image.bin", b"\0\x03");
    git(&job.path, &["rm", "-q", "gone.txt"]);
    git(&job.path, &["mv", "old-name.txt", "new-name.txt"]);
    git(&job.path, &["commit", "-m", "delete and rename"]);
    commit_file(repo.path(), "main-only.txt", "main\n");

    let mut changes = branch_changes(repo.path(), "add-login").unwrap();
    changes.sort_by(|a, b| a.path.cmp(&b.path));

    let binary = |path: &str, status| FileChange {
        binary: true,
        ..change(path, status, "", "")
    };
    assert_eq!(
        changes,
        vec![
            change("added.txt", ChangeStatus::Added, "", "new\n"),
            change("gone.txt", ChangeStatus::Deleted, "bye\n", ""),
            binary("image.bin", ChangeStatus::Modified),
            binary("latin.txt", ChangeStatus::Added),
            FileChange {
                old_path: Some("old-name.txt".into()),
                ..change(
                    "new-name.txt",
                    ChangeStatus::Renamed,
                    "one\ntwo\nthree\nfour\n",
                    "one\ntwo\nthree\nfour\n"
                )
            },
            change("shared.txt", ChangeStatus::Modified, "base\n", "job\n"),
        ]
    );
}

#[test]
fn branch_changes_is_empty_for_a_branch_without_commits() {
    let (repo, root) = (repo(), TempDir::new().unwrap());
    job_worktree(root.path(), repo.path(), "add-login").unwrap();
    assert_eq!(branch_changes(repo.path(), "add-login").unwrap(), vec![]);
}

#[test]
fn scope_uncommitted_lists_tracked_edits_and_untracked_files_against_head() {
    let _env = identity();
    let (repo, root) = (repo(), TempDir::new().unwrap());
    commit_file(repo.path(), "gone.txt", "bye\n");
    let job = job_worktree(root.path(), repo.path(), "add-login").unwrap();
    commit_file(&job.path, "login.rs", "fn login() {}\n");
    fs::write(job.path.join("login.rs"), "fn login() { todo!() }\n").unwrap();
    fs::write(job.path.join("staged.txt"), "staged\n").unwrap();
    git(&job.path, &["add", "staged.txt"]);
    fs::write(job.path.join("draft.txt"), "draft\n").unwrap();
    fs::write(job.path.join("blob.bin"), b"\0\x01").unwrap();
    fs::remove_file(job.path.join("gone.txt")).unwrap();

    let mut changes = uncommitted_changes(&job.path).unwrap();
    changes.sort_by(|a, b| a.path.cmp(&b.path));

    assert_eq!(
        changes,
        vec![
            FileChange {
                binary: true,
                ..change("blob.bin", ChangeStatus::Added, "", "")
            },
            change("draft.txt", ChangeStatus::Added, "", "draft\n"),
            change("gone.txt", ChangeStatus::Deleted, "bye\n", ""),
            change(
                "login.rs",
                ChangeStatus::Modified,
                "fn login() {}\n",
                "fn login() { todo!() }\n"
            ),
            change("staged.txt", ChangeStatus::Added, "", "staged\n"),
        ]
    );
}

#[test]
fn scope_uncommitted_is_empty_for_a_clean_worktree() {
    let (repo, root) = (repo(), TempDir::new().unwrap());
    let job = job_worktree(root.path(), repo.path(), "add-login").unwrap();
    assert_eq!(uncommitted_changes(&job.path).unwrap(), vec![]);
}

#[test]
fn scope_commit_lists_one_commit_against_its_parent() {
    let _env = identity();
    let (repo, root) = (repo(), TempDir::new().unwrap());
    let job = job_worktree(root.path(), repo.path(), "add-login").unwrap();
    commit_file(&job.path, "shared.txt", "first\n");
    let first = git(&job.path, &["rev-parse", "HEAD"]).trim().to_string();
    commit_file(&job.path, "shared.txt", "second\n");
    commit_file(&job.path, "login.rs", "fn login() {}\n");

    assert_eq!(
        commit_changes(repo.path(), &first).unwrap(),
        vec![change("shared.txt", ChangeStatus::Modified, "base\n", "first\n")]
    );
}

#[test]
fn scope_branch_commits_lists_the_branch_commits_newest_first() {
    let _env = identity();
    let (repo, root) = (repo(), TempDir::new().unwrap());
    let job = job_worktree(root.path(), repo.path(), "add-login").unwrap();
    commit_file(&job.path, "login.rs", "fn login() {}\n");
    commit_file(&job.path, "logout.rs", "fn logout() {}\n");
    commit_file(repo.path(), "main-only.txt", "main\n");
    let sha = |rev: &str| git(&job.path, &["rev-parse", rev]).trim().to_string();

    assert_eq!(
        branch_commits(repo.path(), "add-login").unwrap(),
        vec![
            CommitRow {
                sha: sha("HEAD"),
                subject: "logout.rs".into()
            },
            CommitRow {
                sha: sha("HEAD~1"),
                subject: "login.rs".into()
            },
        ]
    );
}

#[test]
fn scope_branch_commits_is_empty_for_a_branch_without_commits() {
    let (repo, root) = (repo(), TempDir::new().unwrap());
    job_worktree(root.path(), repo.path(), "add-login").unwrap();
    assert_eq!(branch_commits(repo.path(), "add-login").unwrap(), vec![]);
}

#[test]
fn forecast_job_returns_non_ascii_conflict_paths_unquoted() {
    let _env = identity();
    let (repo, root) = (repo(), TempDir::new().unwrap());
    commit_file(repo.path(), "a\u{e9}.txt", "base\n");
    let job = job_worktree(root.path(), repo.path(), "add-login").unwrap();
    commit_file(&job.path, "a\u{e9}.txt", "job\n");
    commit_file(repo.path(), "a\u{e9}.txt", "main\n");
    assert_eq!(
        forecast_job(repo.path(), "add-login").unwrap(),
        MergeForecast::Conflict {
            files: vec!["a\u{e9}.txt".into()]
        }
    );
}
