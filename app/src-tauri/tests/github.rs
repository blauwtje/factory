use factory_lib::github::{checks_of, pull_request_of, repo_of, Checks, Issue, PullRequest};
use serde_json::json;

#[test]
fn a_github_remote_names_its_repository_in_every_url_form() {
    for remote in [
        "https://github.com/acme/app.git",
        "https://github.com/acme/app",
        "git@github.com:acme/app.git",
        "ssh://git@github.com/acme/app.git",
    ] {
        assert_eq!(repo_of(remote).as_deref(), Some("acme/app"), "{remote}");
    }
    assert_eq!(repo_of("https://gitlab.com/acme/app.git"), None);
}

#[test]
fn checks_fail_on_any_failure_wait_on_any_running_and_pass_otherwise() {
    let passed = json!({"__typename": "CheckRun", "status": "COMPLETED", "conclusion": "SUCCESS"});
    let skipped = json!({"__typename": "CheckRun", "status": "COMPLETED", "conclusion": "SKIPPED"});
    let running = json!({"__typename": "CheckRun", "status": "IN_PROGRESS", "conclusion": ""});
    let failed = json!({"__typename": "CheckRun", "status": "COMPLETED", "conclusion": "FAILURE"});
    let context = json!({"__typename": "StatusContext", "state": "PENDING"});
    assert_eq!(checks_of(&json!([passed, skipped])), Some(Checks::Passing));
    assert_eq!(checks_of(&json!([passed, running])), Some(Checks::Pending));
    assert_eq!(checks_of(&json!([passed, context])), Some(Checks::Pending));
    assert_eq!(checks_of(&json!([running, failed])), Some(Checks::Failing));
    assert_eq!(checks_of(&json!([])), None);
}

#[test]
fn the_newest_pull_request_of_the_branch_carries_its_state_checks_and_linked_issues() {
    let list = json!([{
        "number": 12,
        "title": "Add login",
        "url": "https://github.com/acme/app/pull/12",
        "state": "OPEN",
        "isDraft": true,
        "statusCheckRollup": [{"__typename": "CheckRun", "status": "COMPLETED", "conclusion": "SUCCESS"}],
        "closingIssuesReferences": [{"number": 4, "url": "https://github.com/acme/app/issues/4"}]
    }]);
    assert_eq!(
        pull_request_of(&list),
        Some(PullRequest {
            number: 12,
            title: "Add login".into(),
            url: "https://github.com/acme/app/pull/12".into(),
            state: "draft".into(),
            checks: Some(Checks::Passing),
            issues: vec![Issue { number: 4, url: "https://github.com/acme/app/issues/4".into() }],
        })
    );
    assert_eq!(pull_request_of(&json!([])), None);
}
