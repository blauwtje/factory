use std::fs::{self, File};
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use rusqlite::{params, params_from_iter, Connection, TransactionBehavior};
use serde::Serialize;
use serde_json::Value;

use crate::protocol::{parse_transcript_line, StreamEvent, Turn};
use crate::store::{Store, StoreError};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
pub struct Tokens {
    pub input: i64,
    pub cache_write: i64,
    pub cache_read: i64,
    pub output: i64,
    pub uncached: i64,
}

impl Tokens {
    pub fn new(input: i64, cache_write: i64, cache_read: i64, output: i64) -> Tokens {
        Tokens {
            input,
            cache_write,
            cache_read,
            output,
            uncached: input + cache_write + output,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Progress {
    pub files_done: usize,
    pub files_total: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Stats {
    pub total: Tokens,
    pub by_model: Vec<(String, Tokens)>,
    pub by_hour: Vec<(i64, Tokens)>,
    pub by_project: Vec<(String, Tokens)>,
    pub sessions: i64,
    pub messages: i64,
    pub tool_calls: i64,
    pub first_session: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct UseCount {
    pub kind: String,
    pub name: String,
    pub detail: Option<String>,
    pub uses: i64,
    pub last_used: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SearchHit {
    pub job_id: String,
    pub agent_id: String,
    pub title: String,
    pub role: String,
    pub text: String,
    pub snippet: String,
    pub seq: i64,
}

pub struct Index {
    connection: Connection,
}

struct Message {
    key: String,
    session_id: String,
    project: String,
    model: String,
    ts: String,
    hour: i64,
    tokens: Tokens,
    tool_ids: Vec<String>,
}

struct Use {
    id: String,
    kind: &'static str,
    name: String,
    detail: Option<String>,
}

const INDEXED_MARKERS: [&str; 3] = ["\"usage\"", "<command-name>", "\"attachment\""];
const HOOK_ATTACHMENTS: [&str; 3] = [
    "hook_success",
    "hook_system_message",
    "hook_additional_context",
];

const IN_PROJECT: &str = "(?1 IS NULL OR project = ?1 OR substr(project, 1, length(?1) + 1) = ?1 || '/')";
const TOKEN_SUMS: &str = "SUM(input), SUM(cache_write), SUM(cache_read), SUM(output)";

fn io_error(path: &Path, error: std::io::Error) -> StoreError {
    StoreError::Database(format!("read {}: {error}", path.display()))
}

fn transcript_files(root: &Path) -> Result<Vec<PathBuf>, StoreError> {
    let mut files = Vec::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(dir) = pending.pop() {
        let entries = match fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(io_error(&dir, error)),
        };
        for entry in entries {
            let path = entry.map_err(|error| io_error(&dir, error))?.path();
            if path.is_dir() {
                pending.push(path);
            } else if path
                .extension()
                .is_some_and(|extension| extension == "jsonl")
            {
                files.push(path);
            }
        }
    }
    files.sort();
    Ok(files)
}

fn epoch_hour(ts: &str) -> Option<i64> {
    let number = |range: std::ops::Range<usize>| ts.get(range)?.parse::<i64>().ok();
    let (year, month, day, hour) = (
        number(0..4)?,
        number(5..7)?,
        number(8..10)?,
        number(11..13)?,
    );
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let shifted_month = (month + 9) % 12;
    let day_of_year = (153 * shifted_month + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    let days = era * 146097 + day_of_era - 719468;
    Some(days * 24 + hour)
}

pub fn epoch_seconds(ts: &str) -> Option<i64> {
    let number = |range: std::ops::Range<usize>| ts.get(range)?.parse::<i64>().ok();
    let local = epoch_hour(ts)? * 3600 + number(14..16)? * 60 + number(17..19)?;
    let zone = ts.get(19..)?.trim_start_matches(|c: char| c == '.' || c.is_ascii_digit());
    let offset = match zone {
        "" | "Z" => 0,
        _ => {
            let sign = if zone.starts_with('-') { -1 } else { 1 };
            let (hours, minutes) = (zone.get(1..3)?.parse::<i64>().ok()?, zone.get(4..6)?.parse::<i64>().ok()?);
            sign * (hours * 3600 + minutes * 60)
        }
    };
    Some(local - offset)
}

fn parse_line(line: &str) -> Option<Value> {
    if !INDEXED_MARKERS.iter().any(|marker| line.contains(marker)) {
        return None;
    }
    serde_json::from_str(line).ok()
}

fn parse_message(value: &Value) -> Option<Message> {
    if value["type"] != "assistant" {
        return None;
    }
    let message = &value["message"];
    let usage = message.get("usage")?;
    let count = |field: &str| usage[field].as_i64().unwrap_or(0);
    let ts = value["timestamp"].as_str()?;
    let tool_ids = message["content"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|block| block["type"] == "tool_use")
        .filter_map(|block| block["id"].as_str().map(str::to_string))
        .collect();
    Some(Message {
        key: format!(
            "{}|{}",
            message["id"].as_str()?,
            value["requestId"].as_str()?
        ),
        session_id: value["sessionId"].as_str()?.to_string(),
        project: value["cwd"].as_str().unwrap_or_default().to_string(),
        model: message["model"].as_str()?.to_string(),
        ts: ts.to_string(),
        hour: epoch_hour(ts)?,
        tokens: Tokens::new(
            count("input_tokens"),
            count("cache_creation_input_tokens"),
            count("cache_read_input_tokens"),
            count("output_tokens"),
        ),
        tool_ids,
    })
}

fn parse_uses(value: &Value) -> Vec<Use> {
    match value["type"].as_str() {
        Some("assistant") => tool_uses(value),
        Some("user") => command_use(value).into_iter().collect(),
        Some("attachment") => attachment_uses(value),
        _ => Vec::new(),
    }
}

fn tool_uses(value: &Value) -> Vec<Use> {
    value["message"]["content"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|block| block["type"] == "tool_use")
        .filter_map(|block| {
            let id = block["id"].as_str()?.to_string();
            let (kind, name) = tool_use_target(block["name"].as_str()?, &block["input"])?;
            Some(Use {
                id,
                kind,
                name,
                detail: None,
            })
        })
        .collect()
}

fn tool_use_target(tool: &str, input: &Value) -> Option<(&'static str, String)> {
    let text = |field: &str| input[field].as_str().map(str::to_string);
    match tool {
        "Skill" => Some(("skill", text("skill")?)),
        "Agent" | "Task" => Some(("agent", text("subagent_type")?)),
        _ => {
            let (server, _) = tool.strip_prefix("mcp__")?.split_once("__")?;
            Some(("mcp", server.to_string()))
        }
    }
}

fn command_use(value: &Value) -> Option<Use> {
    let content = value["message"]["content"].as_str()?;
    let (_, rest) = content.split_once("<command-name>")?;
    let (command, _) = rest.split_once("</command-name>")?;
    Some(Use {
        id: value["uuid"].as_str()?.to_string(),
        kind: "command",
        name: command.trim().trim_start_matches('/').to_string(),
        detail: None,
    })
}

fn attachment_uses(value: &Value) -> Vec<Use> {
    let attachment = &value["attachment"];
    let kind = attachment["type"].as_str().unwrap_or_default();
    if kind == "instructions" {
        return attachment["files"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|file| file["path"].as_str())
            .map(|path| Use {
                id: path.to_string(),
                kind: "instructions",
                name: path.to_string(),
                detail: None,
            })
            .collect();
    }
    if !HOOK_ATTACHMENTS.contains(&kind) {
        return Vec::new();
    }
    let hook = || {
        Some(Use {
            id: value["uuid"].as_str()?.to_string(),
            kind: "hook",
            name: attachment["hookEvent"].as_str()?.to_string(),
            detail: Some(attachment["command"].as_str()?.to_string()),
        })
    };
    hook().into_iter().collect()
}

fn text_turns(line: &str) -> Vec<(&'static str, String)> {
    parse_transcript_line(line)
        .into_iter()
        .filter_map(|turn| match turn {
            Turn::User { text } => Some(("user", text)),
            Turn::Event(StreamEvent::Assistant { content }) => Some(("assistant", content)),
            _ => None,
        })
        .collect()
}

fn match_query(query: &str) -> Option<String> {
    let phrases: Vec<String> = query
        .split_whitespace()
        .map(|word| word.replace('"', ""))
        .filter(|word| !word.is_empty())
        .map(|word| format!("\"{word}\"*"))
        .collect();
    (!phrases.is_empty()).then(|| phrases.join(" "))
}

fn tokens_from(row: &rusqlite::Row, first: usize) -> rusqlite::Result<Tokens> {
    Ok(Tokens::new(
        row.get::<_, Option<i64>>(first)?.unwrap_or(0),
        row.get::<_, Option<i64>>(first + 1)?.unwrap_or(0),
        row.get::<_, Option<i64>>(first + 2)?.unwrap_or(0),
        row.get::<_, Option<i64>>(first + 3)?.unwrap_or(0),
    ))
}

impl Index {
    pub fn open(database: &Path) -> Result<Index, StoreError> {
        drop(Store::open(database)?);
        let mut connection = Connection::open(database)?;
        connection.set_transaction_behavior(TransactionBehavior::Immediate);
        connection.execute(
            "CREATE TABLE IF NOT EXISTS transcript_tools (id TEXT PRIMARY KEY)",
            [],
        )?;
        Ok(Index { connection })
    }

    pub fn refresh(&self, root: &Path) -> Result<Progress, StoreError> {
        self.refresh_with(root, |_| {})
    }

    pub fn refresh_with(
        &self,
        root: &Path,
        mut on_progress: impl FnMut(Progress),
    ) -> Result<Progress, StoreError> {
        let files = transcript_files(root)?;
        let files_total = files.len();
        for (index, file) in files.iter().enumerate() {
            let changed = self.read_new_lines(file)?;
            if changed && index + 1 < files_total {
                on_progress(Progress {
                    files_done: index + 1,
                    files_total,
                });
            }
        }
        Ok(Progress {
            files_done: files_total,
            files_total,
        })
    }

    pub fn refresh_sessions(&self, root: &Path, ids: &[String]) -> Result<(), StoreError> {
        for file in transcript_files(root)? {
            let is_session = file
                .file_stem()
                .is_some_and(|stem| ids.iter().any(|id| stem == id.as_str()));
            if is_session {
                self.read_new_lines(&file)?;
            }
        }
        Ok(())
    }

    fn read_new_lines(&self, path: &Path) -> Result<bool, StoreError> {
        let metadata = fs::metadata(path).map_err(|error| io_error(path, error))?;
        let size = metadata.len() as i64;
        let mtime = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |duration| duration.as_secs() as i64);
        let key = path.to_string_lossy();
        let known: Option<(i64, i64, i64)> = self
            .connection
            .query_row(
                "SELECT size, mtime, offset FROM transcript_files WHERE path = ?1",
                [key.as_ref()],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .ok();
        let offset = match known {
            Some((known_size, known_mtime, _)) if known_size == size && known_mtime == mtime => {
                return Ok(false)
            }
            Some((_, _, offset)) if offset <= size => offset,
            _ => 0,
        };

        let mut reader = BufReader::new(File::open(path).map_err(|error| io_error(path, error))?);
        reader
            .seek(SeekFrom::Start(offset as u64))
            .map_err(|error| io_error(path, error))?;
        let transaction = self.connection.unchecked_transaction()?;
        let session = factory_session(&transaction, path)?;
        let mut seq = match &session {
            Some(session_id) => first_seq(&transaction, session_id, offset)?,
            None => 0,
        };
        let mut read_to = offset;
        let mut line = String::new();
        loop {
            line.clear();
            let bytes = reader
                .read_line(&mut line)
                .map_err(|error| io_error(path, error))?;
            if bytes == 0 || !line.ends_with('\n') {
                break;
            }
            read_to += bytes as i64;
            if let Some(session_id) = &session {
                seq = insert_text(&transaction, session_id, seq, &line)?;
            }
            let Some(value) = parse_line(&line) else {
                continue;
            };
            if let Some(message) = parse_message(&value) {
                upsert_message(&transaction, &message)?;
            }
            upsert_uses(&transaction, &value)?;
        }
        transaction.execute(
            "INSERT INTO transcript_files (path, size, mtime, offset) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(path) DO UPDATE SET size = ?2, mtime = ?3, offset = ?4",
            params![key.as_ref(), size, mtime, read_to],
        )?;
        transaction.commit()?;
        Ok(true)
    }

    pub fn stats(&self, project: Option<&str>) -> Result<Stats, StoreError> {
        let connection = &self.connection;
        let total = connection.query_row(
            &format!("SELECT {TOKEN_SUMS} FROM transcript_messages WHERE {IN_PROJECT}"),
            [project],
            |row| tokens_from(row, 0),
        )?;
        let (sessions, messages, tool_calls, first_session) = connection.query_row(
            &format!(
                "SELECT COUNT(DISTINCT session_id), COUNT(*), COALESCE(SUM(tool_calls), 0), MIN(ts)
                 FROM transcript_messages WHERE {IN_PROJECT}"
            ),
            [project],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )?;
        Ok(Stats {
            total,
            by_model: self.grouped("model", project, |row| row.get::<_, String>(0))?,
            by_hour: self.grouped("hour", project, |row| row.get::<_, i64>(0))?,
            by_project: self.grouped("project", None, |row| row.get::<_, String>(0))?,
            sessions,
            messages,
            tool_calls,
            first_session,
        })
    }

    fn grouped<K>(
        &self,
        column: &str,
        project: Option<&str>,
        key: impl Fn(&rusqlite::Row) -> rusqlite::Result<K>,
    ) -> Result<Vec<(K, Tokens)>, StoreError> {
        let mut statement = self.connection.prepare(&format!(
            "SELECT {column}, {TOKEN_SUMS} FROM transcript_messages WHERE {IN_PROJECT}
             GROUP BY {column} ORDER BY {column}"
        ))?;
        let rows = statement.query_map([project], |row| Ok((key(row)?, tokens_from(row, 1)?)))?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn uses(&self, since: &str) -> Result<Vec<UseCount>, StoreError> {
        let mut statement = self.connection.prepare(
            "SELECT uses.kind, uses.name, commands.command, uses.recent, uses.last
             FROM (SELECT kind, name, command_id, SUM(ts >= ?1) AS recent, MAX(ts) AS last
                   FROM transcript_uses GROUP BY kind, name, command_id) AS uses
             LEFT JOIN transcript_hook_commands AS commands ON commands.id = uses.command_id
             ORDER BY uses.kind, uses.name, commands.command",
        )?;
        let rows = statement.query_map([since], |row| {
            Ok(UseCount {
                kind: row.get(0)?,
                name: row.get(1)?,
                detail: row.get(2)?,
                uses: row.get(3)?,
                last_used: row.get(4)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn search(&self, query: &str) -> Result<Vec<SearchHit>, StoreError> {
        let Some(phrases) = match_query(query) else {
            return Ok(Vec::new());
        };
        let mut statement = self.connection.prepare(
            "SELECT agents.job_id, agents.id, jobs.title, transcript_text.role,
                    transcript_text.text,
                    snippet(transcript_text, 3, '', '', '…', 12), transcript_text.seq
             FROM transcript_text
             JOIN agents ON agents.session_id = transcript_text.session_id
             JOIN jobs ON jobs.id = agents.job_id
             WHERE transcript_text MATCH ?1
             ORDER BY transcript_text.rank, transcript_text.seq
             LIMIT 20",
        )?;
        let rows = statement.query_map([phrases], |row| {
            Ok(SearchHit {
                job_id: row.get(0)?,
                agent_id: row.get(1)?,
                title: row.get(2)?,
                role: row.get(3)?,
                text: row.get(4)?,
                snippet: row.get(5)?,
                seq: row.get(6)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn context_tokens(&self, session_id: &str) -> Result<i64, StoreError> {
        let newest = self.connection.query_row(
            "SELECT input + cache_write + cache_read FROM transcript_messages
             WHERE session_id = ?1 ORDER BY ts DESC, rowid DESC LIMIT 1",
            [session_id],
            |row| row.get(0),
        );
        match newest {
            Ok(tokens) => Ok(tokens),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(0),
            Err(error) => Err(error.into()),
        }
    }

    pub fn session(&self, ids: &[String]) -> Result<Tokens, StoreError> {
        let placeholders = vec!["?"; ids.len()].join(",");
        Ok(self.connection.query_row(
            &format!(
                "SELECT {TOKEN_SUMS} FROM transcript_messages WHERE session_id IN ({placeholders})"
            ),
            params_from_iter(ids),
            |row| tokens_from(row, 0),
        )?)
    }
}

fn factory_session(connection: &Connection, path: &Path) -> Result<Option<String>, StoreError> {
    let Some(stem) = path
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
    else {
        return Ok(None);
    };
    let known: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM agents WHERE session_id = ?1)",
        [&stem],
        |row| row.get(0),
    )?;
    Ok(known.then_some(stem))
}

fn first_seq(connection: &Connection, session_id: &str, offset: i64) -> Result<i64, StoreError> {
    if offset == 0 {
        connection.execute(
            "DELETE FROM transcript_text WHERE session_id = ?1",
            [session_id],
        )?;
        return Ok(0);
    }
    Ok(connection.query_row(
        "SELECT COALESCE(MAX(seq) + 1, 0) FROM transcript_text WHERE session_id = ?1",
        [session_id],
        |row| row.get(0),
    )?)
}

fn insert_text(
    connection: &Connection,
    session_id: &str,
    mut seq: i64,
    line: &str,
) -> Result<i64, StoreError> {
    for (role, text) in text_turns(line) {
        connection.execute(
            "INSERT INTO transcript_text (session_id, seq, role, text) VALUES (?1, ?2, ?3, ?4)",
            params![session_id, seq, role, text],
        )?;
        seq += 1;
    }
    Ok(seq)
}

fn upsert_message(connection: &Connection, message: &Message) -> Result<(), StoreError> {
    connection.execute(
        "INSERT INTO transcript_messages
            (key, session_id, model, ts, hour, input, cache_write, cache_read, output, tool_calls,
             project)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, ?10)
         ON CONFLICT(key) DO UPDATE SET
            model = ?3, input = ?6, cache_write = ?7, cache_read = ?8, output = ?9, project = ?10",
        params![
            message.key,
            message.session_id,
            message.model,
            message.ts,
            message.hour,
            message.tokens.input,
            message.tokens.cache_write,
            message.tokens.cache_read,
            message.tokens.output,
            message.project
        ],
    )?;
    let mut new_tool_calls = 0;
    for id in &message.tool_ids {
        new_tool_calls += connection.execute(
            "INSERT OR IGNORE INTO transcript_tools (id) VALUES (?1)",
            [id],
        )?;
    }
    connection.execute(
        "UPDATE transcript_messages SET tool_calls = tool_calls + ?2 WHERE key = ?1",
        params![message.key, new_tool_calls as i64],
    )?;
    Ok(())
}

fn upsert_uses(connection: &Connection, value: &Value) -> Result<(), StoreError> {
    let (Some(session_id), Some(ts)) = (value["sessionId"].as_str(), value["timestamp"].as_str())
    else {
        return Ok(());
    };
    for found in parse_uses(value) {
        if let Some(command) = &found.detail {
            connection.execute(
                "INSERT OR IGNORE INTO transcript_hook_commands (command) VALUES (?1)",
                [command],
            )?;
        }
        connection.execute(
            "INSERT INTO transcript_uses (key, session_id, ts, kind, name, command_id)
             VALUES (?1, ?2, ?3, ?4, ?5,
                     (SELECT id FROM transcript_hook_commands WHERE command = ?6))
             ON CONFLICT(key) DO UPDATE SET ts = MAX(ts, excluded.ts)",
            params![
                format!("{session_id}|{}|{}", found.kind, found.id),
                session_id,
                ts,
                found.kind,
                found.name,
                found.detail
            ],
        )?;
    }
    Ok(())
}
