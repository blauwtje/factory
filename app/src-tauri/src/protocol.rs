use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::permission::Rule;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub enum StreamEvent {
    Init {
        session_id: String,
        api_key_source: String,
        model: String,
    },
    TextDelta {
        text: String,
    },
    Assistant {
        content: String,
    },
    ToolUse {
        id: String,
        name: String,
        input: Value,
    },
    ToolResult {
        id: String,
        output: String,
        is_error: bool,
    },
    RateLimit {
        windows: BTreeMap<String, Window>,
    },
    ControlRequest {
        request_id: String,
        tool_name: String,
        input: Value,
        rules: Vec<Rule>,
    },
    Result {
        session_id: String,
        outcome: Outcome,
        queued: bool,
    },
    Failure {
        message: String,
    },
    Compacted {
        trigger: String,
        pre_tokens: u64,
    },
    Tasks {
        tasks: Vec<Task>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Task {
    pub task_id: String,
    pub task_type: String,
    pub description: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Outcome {
    Finished,
    Failed,
    Stopped,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Line {
    System(System),
    StreamEvent {
        event: Delta,
    },
    Assistant {
        message: Message,
    },
    User {
        message: Message,
    },
    RateLimitEvent {
        rate_limit_info: RateLimitInfo,
    },
    ControlRequest {
        request_id: String,
        request: Request,
    },
    Result {
        session_id: String,
        is_error: bool,
        #[serde(default)]
        terminal_reason: String,
    },
    #[serde(other)]
    Other,
}

#[derive(Deserialize)]
#[serde(tag = "subtype", rename_all = "snake_case")]
enum System {
    Init {
        session_id: String,
        #[serde(rename = "apiKeySource")]
        api_key_source: String,
        model: String,
    },
    CompactBoundary {
        compact_metadata: CompactMetadata,
    },
    BackgroundTasksChanged {
        tasks: Vec<Task>,
    },
    #[serde(other)]
    Other,
}

#[derive(Deserialize)]
struct CompactMetadata {
    trigger: String,
    #[serde(alias = "preTokens")]
    pre_tokens: u64,
}

impl CompactMetadata {
    fn into_event(self) -> StreamEvent {
        StreamEvent::Compacted {
            trigger: self.trigger,
            pre_tokens: self.pre_tokens,
        }
    }
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Delta {
    ContentBlockDelta {
        delta: BlockDelta,
    },
    #[serde(other)]
    Other,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum BlockDelta {
    TextDelta {
        text: String,
    },
    #[serde(other)]
    Other,
}

#[derive(Deserialize)]
struct Message {
    content: Vec<Block>,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Block {
    Text {
        text: String,
    },
    ToolUse {
        id: String,
        name: String,
        input: Value,
    },
    ToolResult {
        tool_use_id: String,
        content: ToolOutput,
        #[serde(default)]
        is_error: bool,
    },
    #[serde(other)]
    Other,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum ToolOutput {
    Text(String),
    Parts(Vec<Part>),
}

#[derive(Deserialize)]
struct Part {
    #[serde(default)]
    text: String,
}

#[derive(Deserialize)]
struct RateLimitInfo {
    #[serde(rename = "unifiedWindows")]
    windows: BTreeMap<String, Window>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Window {
    pub utilization: f64,
    #[serde(rename(deserialize = "resetsAt"))]
    pub resets_at: u64,
}

#[derive(Deserialize)]
#[serde(tag = "subtype", rename_all = "snake_case")]
enum Request {
    CanUseTool {
        tool_name: String,
        input: Value,
        #[serde(default)]
        permission_suggestions: Vec<Suggestion>,
    },
    #[serde(other)]
    Other,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum Suggestion {
    AddRules {
        rules: Vec<Rule>,
    },
    #[serde(other)]
    Other,
}

impl ToolOutput {
    fn into_text(self) -> String {
        match self {
            ToolOutput::Text(text) => text,
            ToolOutput::Parts(parts) => parts.into_iter().map(|part| part.text).collect(),
        }
    }
}

impl Block {
    fn into_event(self) -> Option<StreamEvent> {
        match self {
            Block::Text { text } => Some(StreamEvent::Assistant { content: text }),
            Block::ToolUse { id, name, input } => Some(StreamEvent::ToolUse { id, name, input }),
            Block::ToolResult {
                tool_use_id,
                content,
                is_error,
            } => Some(StreamEvent::ToolResult {
                id: tool_use_id,
                output: content.into_text(),
                is_error,
            }),
            Block::Other => None,
        }
    }
}

impl Line {
    fn into_event(self) -> Option<StreamEvent> {
        match self {
            Line::System(System::Init {
                session_id,
                api_key_source,
                model,
            }) => Some(StreamEvent::Init {
                session_id,
                api_key_source,
                model,
            }),
            Line::System(System::CompactBoundary { compact_metadata }) => {
                Some(compact_metadata.into_event())
            }
            Line::System(System::BackgroundTasksChanged { tasks }) => {
                Some(StreamEvent::Tasks { tasks })
            }
            Line::StreamEvent {
                event:
                    Delta::ContentBlockDelta {
                        delta: BlockDelta::TextDelta { text },
                    },
            } => Some(StreamEvent::TextDelta { text }),
            Line::Assistant { message } => message.content.into_iter().find_map(Block::into_event),
            Line::User { message } => message
                .content
                .into_iter()
                .find_map(Block::into_event)
                .filter(|event| matches!(event, StreamEvent::ToolResult { .. })),
            Line::RateLimitEvent { rate_limit_info } => Some(StreamEvent::RateLimit {
                windows: rate_limit_info.windows,
            }),
            Line::ControlRequest {
                request_id,
                request:
                    Request::CanUseTool {
                        tool_name,
                        input,
                        permission_suggestions,
                    },
            } => Some(StreamEvent::ControlRequest {
                request_id,
                tool_name,
                input,
                rules: permission_suggestions
                    .into_iter()
                    .flat_map(|suggestion| match suggestion {
                        Suggestion::AddRules { rules } => rules,
                        Suggestion::Other => Vec::new(),
                    })
                    .collect(),
            }),
            Line::Result {
                session_id,
                is_error,
                terminal_reason,
            } => Some(StreamEvent::Result {
                session_id,
                outcome: if terminal_reason.starts_with("aborted") {
                    Outcome::Stopped
                } else if is_error {
                    Outcome::Failed
                } else {
                    Outcome::Finished
                },
                queued: false,
            }),
            _ => None,
        }
    }
}

#[derive(Deserialize)]
struct ResultLine {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    is_error: bool,
    #[serde(default)]
    subtype: String,
    #[serde(default)]
    result: Option<Value>,
    #[serde(default)]
    errors: Vec<Value>,
    #[serde(default)]
    terminal_reason: String,
}

pub fn failure_reason(line: &str) -> Option<String> {
    let line: ResultLine = serde_json::from_str(line).ok()?;
    if line.kind != "result" || !line.is_error || line.terminal_reason.starts_with("aborted") {
        return None;
    }
    let errors: Vec<String> = line
        .errors
        .iter()
        .map(|error| error.as_str().map_or_else(|| error.to_string(), str::to_string))
        .filter(|error| !error.trim().is_empty())
        .collect();
    if !errors.is_empty() {
        return Some(errors.join("\n"));
    }
    if let Some(text) = line.result.as_ref().and_then(Value::as_str).map(str::trim).filter(|text| !text.is_empty()) {
        return Some(text.into());
    }
    Some(match line.subtype.as_str() {
        "error_max_turns" => "Claude stopped at its turn limit.".into(),
        "error_max_budget_usd" => "Claude stopped at its spending limit.".into(),
        "error_during_execution" => "Claude stopped with an error during the turn.".into(),
        "" | "success" => "Claude ended the turn with an error.".into(),
        other => format!("Claude ended the turn with an error ({other})."),
    })
}

pub fn parse_line(line: &str) -> Option<StreamEvent> {
    serde_json::from_str::<Line>(line).ok()?.into_event()
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub enum Turn {
    User { text: String },
    Event(StreamEvent),
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Prompt {
    Text(String),
    Blocks(Vec<Block>),
}

#[derive(Deserialize)]
struct PromptMessage {
    content: Prompt,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Entry {
    User {
        message: PromptMessage,
        #[serde(default, rename = "isSidechain")]
        sidechain: bool,
        #[serde(default, rename = "isMeta")]
        meta: bool,
        #[serde(default, rename = "isCompactSummary")]
        compact_summary: bool,
    },
    Assistant {
        message: Message,
        #[serde(default, rename = "isSidechain")]
        sidechain: bool,
    },
    System(TranscriptSystem),
    #[serde(other)]
    Other,
}

#[derive(Deserialize)]
#[serde(tag = "subtype", rename_all = "snake_case")]
enum TranscriptSystem {
    CompactBoundary {
        #[serde(rename = "compactMetadata")]
        compact_metadata: CompactMetadata,
    },
    #[serde(other)]
    Other,
}

fn events(blocks: Vec<Block>) -> Vec<Turn> {
    blocks
        .into_iter()
        .filter_map(Block::into_event)
        .map(Turn::Event)
        .collect()
}

pub fn parse_transcript_line(line: &str) -> Vec<Turn> {
    match serde_json::from_str::<Entry>(line) {
        Ok(Entry::User {
            message,
            sidechain: false,
            meta: false,
            compact_summary: false,
        }) => match message.content {
            Prompt::Text(text) => vec![Turn::User { text }],
            Prompt::Blocks(blocks) => blocks
                .into_iter()
                .filter_map(|block| match block {
                    Block::Text { text } => Some(Turn::User { text }),
                    other => other.into_event().map(Turn::Event),
                })
                .collect(),
        },
        Ok(Entry::Assistant {
            message,
            sidechain: false,
        }) => events(message.content),
        Ok(Entry::System(TranscriptSystem::CompactBoundary { compact_metadata })) => {
            vec![Turn::Event(compact_metadata.into_event())]
        }
        _ => Vec::new(),
    }
}

#[derive(Deserialize)]
struct ControlResponse {
    response: Reply,
}

#[derive(Deserialize)]
struct Reply {
    request_id: String,
    #[serde(default)]
    response: Value,
}

pub fn parse_control_response(line: &str) -> Option<(String, Value)> {
    let value: Value = serde_json::from_str(line).ok()?;
    if value.get("type")? != "control_response" {
        return None;
    }
    let reply = serde_json::from_value::<ControlResponse>(value)
        .ok()?
        .response;
    Some((reply.request_id, reply.response))
}
