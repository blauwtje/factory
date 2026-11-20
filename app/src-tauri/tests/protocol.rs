use std::fs;

use factory_lib::permission::Rule;
use factory_lib::protocol::{
    parse_line, parse_transcript_line, Outcome, StreamEvent, Turn, Window,
};
use serde_json::json;

const SESSION: &str = include_str!("fixtures/session.jsonl");
const CONTROL: &str = include_str!("fixtures/control-request.jsonl");
const SESSION_ID: &str = "cd30f059-8cb6-442a-b396-8b20301ce662";

#[test]
fn session_lines_become_events_and_the_rest_is_skipped() {
    let events: Vec<StreamEvent> = SESSION.lines().filter_map(parse_line).collect();
    assert_eq!(
        events,
        vec![
            StreamEvent::Init {
                session_id: SESSION_ID.into(),
                api_key_source: "none".into(),
                model: "claude-haiku-5-5".into(),
            },
            StreamEvent::TextDelta {
                text: "Hi. What do".into()
            },
            StreamEvent::Assistant {
                content: "Hi. What do you want to work on?".into()
            },
            StreamEvent::ToolUse {
                id: "toolu_01".into(),
                name: "Read".into(),
                input: json!({"file_path": "/tmp/work/a.txt"}),
            },
            StreamEvent::ToolResult {
                id: "toolu_01".into(),
                output: "1\thello\n2\t".into(),
                is_error: false,
            },
            StreamEvent::ToolResult {
                id: "toolu_02".into(),
                output: "no such file".into(),
                is_error: true,
            },
            StreamEvent::RateLimit {
                windows: [(
                    "seven_day".into(),
                    Window {
                        utilization: 0.39,
                        resets_at: 1795222800,
                    }
                )]
                .into(),
            },
            StreamEvent::Result {
                session_id: SESSION_ID.into(),
                outcome: Outcome::Finished,
                queued: false
            },
        ]
    );
}

#[test]
fn can_use_tool_requests_become_control_requests() {
    let events: Vec<StreamEvent> = CONTROL.lines().filter_map(parse_line).collect();
    assert_eq!(
        events,
        vec![StreamEvent::ControlRequest {
            request_id: "req_1".into(),
            tool_name: "Bash".into(),
            input: json!({"command": "ls"}),
            rules: vec![Rule {
                tool_name: "Bash".into(),
                rule_content: Some("ls".into()),
            }],
        }]
    );
}

#[test]
fn control_requests_serialize_their_suggested_rules() {
    let event = StreamEvent::ControlRequest {
        request_id: "req_1".into(),
        tool_name: "Bash".into(),
        input: json!({"command": "npm test"}),
        rules: vec![
            Rule {
                tool_name: "Bash".into(),
                rule_content: Some("npm test:*".into()),
            },
            Rule {
                tool_name: "Read".into(),
                rule_content: None,
            },
        ],
    };
    assert_eq!(
        serde_json::to_value(event).unwrap()["ControlRequest"]["rules"],
        json!([
            {"toolName": "Bash", "ruleContent": "npm test:*"},
            {"toolName": "Read"},
        ])
    );
}

#[test]
fn a_trailing_carriage_return_is_ignored() {
    let line = format!("{}\r", SESSION.lines().last().unwrap());
    assert_eq!(
        parse_line(&line),
        Some(StreamEvent::Result {
            session_id: SESSION_ID.into(),
            outcome: Outcome::Finished,
            queued: false
        })
    );
}

#[test]
fn a_turn_the_user_interrupted_is_stopped() {
    let fixture = fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/interrupt-mid-turn.jsonl"
    ))
    .unwrap();
    let interrupted = fixture
        .lines()
        .find(|line| line.contains("\"terminal_reason\":\"aborted_streaming\""))
        .unwrap();
    assert_eq!(
        parse_line(interrupted),
        Some(StreamEvent::Result {
            session_id: "00000000-0000-4000-8000-000000000001".into(),
            outcome: Outcome::Stopped,
            queued: false
        })
    );
}

#[test]
fn the_interruption_notice_is_not_assistant_text() {
    let fixture = fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/interrupt-mid-turn.jsonl"
    ))
    .unwrap();
    let notice = fixture
        .lines()
        .find(|line| {
            line.starts_with("{\"type\":\"user\"") && line.contains("[Request interrupted by user]")
        })
        .unwrap();
    assert_eq!(parse_line(notice), None);
}

#[test]
fn garbage_is_not_an_event() {
    assert_eq!(parse_line("not json"), None);
    assert_eq!(parse_line(""), None);
}

#[test]
fn transcript_lines_become_turns_and_side_and_meta_lines_are_skipped() {
    let lines = [
        r#"{"type":"user","message":{"role":"user","content":"what agents do you have?"}}"#,
        r#"{"type":"user","isMeta":true,"message":{"role":"user","content":"<local-command-caveat>"}}"#,
        r#"{"type":"assistant","message":{"content":[{"type":"thinking","thinking":""},{"type":"tool_use","id":"t1","name":"Read","input":{}}]}}"#,
        r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":[{"type":"text","text":"[]"}]}]}}"#,
        r#"{"type":"assistant","isSidechain":true,"message":{"content":[{"type":"text","text":"side"}]}}"#,
        r#"{"type":"assistant","message":{"content":[{"type":"text","text":"None are running."}]}}"#,
        r#"{"type":"attachment","attachment":{}}"#,
    ];
    let turns: Vec<Turn> = lines.into_iter().flat_map(parse_transcript_line).collect();
    assert_eq!(
        turns,
        vec![
            Turn::User {
                text: "what agents do you have?".into()
            },
            Turn::Event(StreamEvent::ToolUse {
                id: "t1".into(),
                name: "Read".into(),
                input: json!({})
            }),
            Turn::Event(StreamEvent::ToolResult {
                id: "t1".into(),
                output: "[]".into(),
                is_error: false
            }),
            Turn::Event(StreamEvent::Assistant {
                content: "None are running.".into()
            }),
        ]
    );
}

#[test]
fn a_live_compact_boundary_becomes_a_compacted_event() {
    let line = r#"{"type":"system","subtype":"compact_boundary","session_id":"s1","compact_metadata":{"trigger":"manual","pre_tokens":3550}}"#;
    let event = parse_line(line).unwrap();
    assert_eq!(
        serde_json::to_value(&event).unwrap(),
        json!({"Compacted": {"trigger": "manual", "pre_tokens": 3550}})
    );
}

#[test]
fn background_tasks_changed_becomes_a_tasks_event_and_an_empty_list_clears_them() {
    let line = r#"{"type":"system","subtype":"background_tasks_changed","tasks":[{"task_id":"b1","run_id":"r1","task_type":"local_bash","description":"npm run dev"}]}"#;
    assert_eq!(
        serde_json::to_value(parse_line(line).unwrap()).unwrap(),
        json!({"Tasks": {"tasks": [{"task_id": "b1", "task_type": "local_bash", "description": "npm run dev"}]}})
    );
    let empty = r#"{"type":"system","subtype":"background_tasks_changed","tasks":[]}"#;
    assert_eq!(
        serde_json::to_value(parse_line(empty).unwrap()).unwrap(),
        json!({"Tasks": {"tasks": []}})
    );
}

#[test]
fn a_transcript_compact_boundary_is_shown_and_its_summary_is_not() {
    let lines = [
        r#"{"type":"system","subtype":"compact_boundary","content":"Conversation compacted","compactMetadata":{"trigger":"auto","preTokens":167000}}"#,
        r#"{"type":"user","isCompactSummary":true,"message":{"role":"user","content":"This session is being continued from a previous conversation."}}"#,
        r#"{"type":"user","message":{"role":"user","content":"go on"}}"#,
    ];
    let turns: Vec<Turn> = lines.into_iter().flat_map(parse_transcript_line).collect();
    assert_eq!(
        turns,
        vec![
            Turn::Event(StreamEvent::Compacted {
                trigger: "auto".into(),
                pre_tokens: 167000
            }),
            Turn::User {
                text: "go on".into()
            },
        ]
    );
}
