use std::io::{self, Write};
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::permission::Decision;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AuditEntry {
    pub time: i64,
    pub job_id: String,
    pub agent_id: String,
    pub tool_name: String,
    pub input: Value,
    pub decision: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl AuditEntry {
    pub fn new(
        job_id: &str,
        agent_id: &str,
        tool_name: &str,
        input: Value,
        decision: &Decision,
        time: i64,
    ) -> AuditEntry {
        let (decision, reason) = match decision {
            Decision::AllowOnce => ("allow_once", None),
            Decision::AllowAlways => ("allow_always", None),
            Decision::Deny { reason } => ("deny", Some(reason.clone())),
            Decision::Answer { .. } => ("answer", None),
        };
        AuditEntry {
            time,
            job_id: job_id.to_string(),
            agent_id: agent_id.to_string(),
            tool_name: tool_name.to_string(),
            input,
            decision: decision.to_string(),
            reason,
        }
    }
}

pub fn append(path: &Path, entry: &AuditEntry) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let mut line = serde_json::to_string(entry)?;
    line.push('\n');
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?
        .write_all(line.as_bytes())
}

pub fn read(path: &Path) -> io::Result<Vec<AuditEntry>> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error),
    };
    Ok(text
        .lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect())
}
