use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub enum Decision {
    AllowOnce,
    AllowAlways,
    Deny { reason: String },
    Answer { answers: serde_json::Map<String, Value> },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    pub tool_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rule_content: Option<String>,
}

impl Rule {
    pub fn allowed_tool(&self) -> String {
        match &self.rule_content {
            Some(content) => format!("{}({content})", self.tool_name),
            None => self.tool_name.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Pending {
    pub tool_name: String,
    pub input: Value,
    pub rules: Vec<Rule>,
}

pub type PendingRequests = Arc<Mutex<HashMap<String, Pending>>>;

pub type AllowedTools = Arc<Mutex<Vec<String>>>;

pub fn control_response(request_id: &str, pending: Pending, decision: &Decision) -> Value {
    let response = match decision {
        Decision::AllowAlways if !pending.rules.is_empty() => json!({
            "behavior": "allow",
            "updatedInput": pending.input,
            "updatedPermissions": [{
                "type": "addRules",
                "rules": pending.rules,
                "behavior": "allow",
                "destination": "session",
            }],
        }),
        Decision::AllowOnce | Decision::AllowAlways => {
            json!({"behavior": "allow", "updatedInput": pending.input})
        }
        Decision::Deny { reason } => json!({"behavior": "deny", "message": reason}),
        Decision::Answer { answers } => {
            let mut input = pending.input;
            input["answers"] = Value::Object(answers.clone());
            json!({"behavior": "allow", "updatedInput": input})
        }
    };
    json!({
        "type": "control_response",
        "response": {"subtype": "success", "request_id": request_id, "response": response},
    })
}
