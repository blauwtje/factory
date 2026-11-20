use std::path::PathBuf;
use std::thread;
use std::time::{Duration, Instant};

use factory_lib::agent::{Agent, AgentSpec};
use factory_lib::protocol::StreamEvent;

const FAKE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fake-claude.mjs");

fn spec() -> AgentSpec {
    std::env::set_var("FACTORY_CLAUDE_BIN", FAKE);
    AgentSpec {
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
    }
}

#[test]
fn a_result_read_after_the_next_turn_ended_still_says_a_turn_was_queued_behind_it() {
    let mut agent = Agent::spawn(spec()).unwrap();
    let events = agent.events().unwrap();
    agent.send("hold").unwrap();
    agent.send("go on").unwrap();
    agent.send("release").unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    while agent.busy() && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(10));
    }
    let queued: Vec<bool> = events
        .try_iter()
        .filter_map(|event| match event {
            StreamEvent::Result { queued, .. } => Some(queued),
            _ => None,
        })
        .collect();
    assert_eq!(queued, [true, false]);
}
