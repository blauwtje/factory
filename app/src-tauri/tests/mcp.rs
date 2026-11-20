use std::path::PathBuf;
use std::time::Duration;

use factory_lib::agent::{Agent, AgentSpec};
use serde_json::{json, Value};

const FAKE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fake-claude.mjs");

fn agent() -> Agent {
    std::env::set_var("FACTORY_CLAUDE_BIN", FAKE);
    Agent::spawn(AgentSpec {
        config_dir: None,
        role: "builder".into(),
        name: "builder-1".into(),
        model: "claude-sonnet-5-5".into(),
        effort: "medium".into(),
        cwd: std::env::temp_dir(),
        session_id: "11111111-2222-3333-4444-555555555555".into(),
        resume: false,
        plugin_dir: PathBuf::from("kit"),
        add_dir: std::env::temp_dir(),
        mcp_config: None,
        permission_mode: String::new(),
        allowed_tools: Default::default(),
    })
    .unwrap()
}

fn status(agent: &mut Agent) -> Value {
    let reply = agent.mcp_status().unwrap();
    reply.recv_timeout(Duration::from_secs(10)).unwrap()["mcpServers"].clone()
}

#[test]
fn mcp_status_lists_the_failed_server_and_reconnect_brings_it_up() {
    let mut agent = agent();
    assert_eq!(
        status(&mut agent),
        json!([{ "name": "notes", "status": "failed", "error": "Connection closed" }])
    );
    let reconnected = agent.mcp_reconnect("notes").unwrap();
    reconnected.recv_timeout(Duration::from_secs(10)).unwrap();
    assert_eq!(
        status(&mut agent),
        json!([{ "name": "notes", "status": "connected" }])
    );
}

#[test]
fn mcp_reconnect_of_an_unknown_server_gets_an_empty_reply() {
    let mut agent = agent();
    let reply = agent.mcp_reconnect("missing").unwrap();
    assert_eq!(
        reply.recv_timeout(Duration::from_secs(10)).unwrap(),
        Value::Null
    );
    assert_eq!(status(&mut agent)[0]["status"], "failed");
}
