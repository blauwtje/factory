use std::sync::mpsc::Receiver;
use std::time::Duration;

use factory_lib::agent::{Agent, AgentError, AgentSpec};
use factory_lib::permission::Decision;
use factory_lib::protocol::StreamEvent;
use serde_json::{json, Value};

const FAKE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/permission-claude.mjs"
);

fn asked() -> (Agent, Receiver<StreamEvent>) {
    std::env::set_var("FACTORY_CLAUDE_BIN", FAKE);
    let mut agent = Agent::spawn(AgentSpec {
        config_dir: None,
        role: "builder".into(),
        name: "builder-1".into(),
        model: "claude-sonnet-5-5".into(),
        effort: "medium".into(),
        cwd: std::env::temp_dir(),
        session_id: "11111111-2222-3333-4444-555555555555".into(),
        resume: false,
        plugin_dir: "kit".into(),
        add_dir: std::env::temp_dir(),
        mcp_config: None,
        permission_mode: String::new(),
        allowed_tools: Default::default(),
    })
    .unwrap();
    let events = agent.events().unwrap();
    agent.send("run ls").unwrap();
    loop {
        let event = events.recv_timeout(Duration::from_secs(10)).unwrap();
        if matches!(&event, StreamEvent::ControlRequest { request_id, .. } if request_id == "req_1")
        {
            return (agent, events);
        }
    }
}

fn written(events: &Receiver<StreamEvent>) -> Value {
    loop {
        if let StreamEvent::Assistant { content } =
            events.recv_timeout(Duration::from_secs(10)).unwrap()
        {
            return serde_json::from_str(&content).unwrap();
        }
    }
}

fn response(response: Value) -> Value {
    json!({
        "type": "control_response",
        "response": {"subtype": "success", "request_id": "req_1", "response": response},
    })
}

#[test]
fn allow_once_allows_the_asked_input() {
    let (mut agent, events) = asked();
    agent
        .answer_permission("req_1", &Decision::AllowOnce)
        .unwrap();
    assert_eq!(
        written(&events),
        response(json!({"behavior": "allow", "updatedInput": {"command": "ls"}}))
    );
}

#[test]
fn allow_always_adds_the_suggested_rule_for_the_session_and_later_starts() {
    let (mut agent, events) = asked();
    agent
        .answer_permission("req_1", &Decision::AllowAlways)
        .unwrap();
    assert_eq!(
        written(&events),
        response(json!({
            "behavior": "allow",
            "updatedInput": {"command": "ls"},
            "updatedPermissions": [{
                "type": "addRules",
                "rules": [{"toolName": "Bash", "ruleContent": "ls"}],
                "behavior": "allow",
                "destination": "session",
            }],
        }))
    );
    agent.set_model("claude-sonnet-5-5", "high").unwrap();
    agent.send("argv").unwrap();
    let argv = written(&events);
    let argv: Vec<&str> = argv
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a.as_str().unwrap())
        .collect();
    assert!(
        argv.windows(2).any(|w| w == ["--allowedTools", "Bash(ls)"]),
        "{argv:?}"
    );
}

#[test]
fn deny_sends_the_reason() {
    let (mut agent, events) = asked();
    agent
        .answer_permission(
            "req_1",
            &Decision::Deny {
                reason: "not in this repo".into(),
            },
        )
        .unwrap();
    assert_eq!(
        written(&events),
        response(json!({"behavior": "deny", "message": "not in this repo"}))
    );
}

#[test]
fn an_unknown_or_answered_request_is_an_error() {
    let (mut agent, _events) = asked();
    assert_eq!(
        agent.answer_permission("req_9", &Decision::AllowOnce),
        Err(AgentError::UnknownRequest("req_9".into()))
    );
    agent
        .answer_permission("req_1", &Decision::AllowOnce)
        .unwrap();
    assert_eq!(
        agent.answer_permission("req_1", &Decision::AllowOnce),
        Err(AgentError::UnknownRequest("req_1".into()))
    );
}

#[test]
fn an_answer_allows_the_asked_input_with_the_answers_added() {
    let (mut agent, events) = asked();
    let decision: Decision =
        serde_json::from_value(json!({"Answer": {"answers": {"Which port?": "3000"}}})).unwrap();
    agent.answer_permission("req_1", &decision).unwrap();
    assert_eq!(
        written(&events),
        response(json!({
            "behavior": "allow",
            "updatedInput": {"command": "ls", "answers": {"Which port?": "3000"}},
        }))
    );
}
