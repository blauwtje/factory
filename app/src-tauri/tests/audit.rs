use factory_lib::audit::{self, AuditEntry};
use factory_lib::permission::Decision;
use serde_json::{json, Value};
use tempfile::TempDir;

#[test]
fn append_writes_one_json_line_per_answer_in_a_new_folder() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("audit").join("p1.jsonl");
    let input = json!({"command": "npm test"});

    audit::append(
        &path,
        &AuditEntry::new("j1", "a1", "Bash", input.clone(), &Decision::AllowOnce, 100),
    )
    .unwrap();
    audit::append(
        &path,
        &AuditEntry::new(
            "j1",
            "a2",
            "Bash",
            input.clone(),
            &Decision::AllowAlways,
            101,
        ),
    )
    .unwrap();
    let deny = Decision::Deny {
        reason: "not now".into(),
    };
    audit::append(
        &path,
        &AuditEntry::new("j2", "a1", "Read", json!({"file_path": ".env"}), &deny, 102),
    )
    .unwrap();

    let text = std::fs::read_to_string(&path).unwrap();
    let lines: Vec<Value> = text
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(
        lines,
        vec![
            json!({"time": 100, "job_id": "j1", "agent_id": "a1", "tool_name": "Bash", "input": input, "decision": "allow_once"}),
            json!({"time": 101, "job_id": "j1", "agent_id": "a2", "tool_name": "Bash", "input": input, "decision": "allow_always"}),
            json!({"time": 102, "job_id": "j2", "agent_id": "a1", "tool_name": "Read", "input": {"file_path": ".env"}, "decision": "deny", "reason": "not now"}),
        ]
    );
}

#[test]
fn read_returns_the_entries_in_file_order() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("audit").join("p1.jsonl");
    let deny = Decision::Deny {
        reason: "no".into(),
    };
    audit::append(
        &path,
        &AuditEntry::new(
            "j1",
            "a1",
            "Bash",
            json!({"command": "ls"}),
            &Decision::AllowOnce,
            1,
        ),
    )
    .unwrap();
    audit::append(
        &path,
        &AuditEntry::new("j1", "a1", "Bash", json!({"command": "rm"}), &deny, 2),
    )
    .unwrap();

    let entries = audit::read(&path).unwrap();

    assert_eq!(entries.len(), 2);
    assert_eq!(
        (
            entries[0].time,
            entries[0].decision.as_str(),
            entries[0].reason.as_deref()
        ),
        (1, "allow_once", None)
    );
    assert_eq!(
        (
            entries[1].time,
            entries[1].decision.as_str(),
            entries[1].reason.as_deref()
        ),
        (2, "deny", Some("no"))
    );
    assert_eq!(entries[1].input, json!({"command": "rm"}));
}

#[test]
fn read_returns_nothing_for_a_missing_file() {
    let dir = TempDir::new().unwrap();

    assert!(audit::read(&dir.path().join("audit").join("none.jsonl"))
        .unwrap()
        .is_empty());
}

#[test]
fn read_skips_lines_it_cannot_parse() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("p1.jsonl");
    std::fs::write(&path, "not json\n{\"time\":5}\n").unwrap();
    audit::append(
        &path,
        &AuditEntry::new("j1", "a1", "Bash", json!({}), &Decision::AllowOnce, 7),
    )
    .unwrap();

    let entries = audit::read(&path).unwrap();

    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].time, 7);
}
