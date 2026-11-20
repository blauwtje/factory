use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use factory_lib::store::{Agent, Job, JobStatus, Project, Store};
use factory_lib::transcripts::{Index, Progress, SearchHit, Tokens, UseCount};
use tempfile::TempDir;

const FIXTURE: &str = include_str!("fixtures/transcript.jsonl");

struct Setup {
    _dir: TempDir,
    root: PathBuf,
    log: PathBuf,
    index: Index,
}

fn setup() -> Setup {
    let dir = TempDir::new().unwrap();
    let root = dir.path().join("projects");
    let project = root.join("-code-app");
    fs::create_dir_all(&project).unwrap();
    let log = project.join("sess-1.jsonl");
    fs::write(&log, FIXTURE).unwrap();
    let index = Index::open(&dir.path().join("factory.db")).unwrap();
    Setup {
        _dir: dir,
        root,
        log,
        index,
    }
}

fn append(path: &Path, text: &str) {
    OpenOptions::new()
        .append(true)
        .open(path)
        .unwrap()
        .write_all(text.as_bytes())
        .unwrap();
}

fn tokens(input: i64, cache_write: i64, cache_read: i64, output: i64) -> Tokens {
    Tokens {
        input,
        cache_write,
        cache_read,
        output,
        uncached: input + cache_write + output,
    }
}

#[test]
fn each_message_counts_once_with_its_last_line() {
    let setup = setup();
    let progress = setup.index.refresh(&setup.root).unwrap();
    assert_eq!(
        progress,
        Progress {
            files_done: 1,
            files_total: 1
        }
    );
    let stats = setup.index.stats(None).unwrap();
    assert_eq!(stats.total, tokens(14, 102, 1203, 53));
    assert_eq!(stats.messages, 3);
    assert_eq!(stats.sessions, 2);
    assert_eq!(stats.tool_calls, 4);
    assert_eq!(
        stats.first_session.as_deref(),
        Some("2026-01-01T10:00:01.000Z")
    );
}

#[test]
fn tokens_are_grouped_by_model_and_utc_hour() {
    let setup = setup();
    setup.index.refresh(&setup.root).unwrap();
    let stats = setup.index.stats(None).unwrap();
    assert_eq!(
        stats.by_model,
        vec![
            ("claude-haiku-x".to_string(), tokens(3, 0, 200, 7)),
            ("claude-opus-x".to_string(), tokens(11, 102, 1003, 46)),
        ]
    );
    assert_eq!(
        stats.by_hour,
        vec![
            (490906, tokens(10, 100, 1000, 42)),
            (490907, tokens(3, 0, 200, 7)),
            (490930, tokens(1, 2, 3, 4)),
        ]
    );
}

#[test]
fn tokens_are_grouped_by_the_cwd_of_each_message() {
    let setup = setup();
    append(
        &setup.log,
        "{\"type\":\"assistant\",\"sessionId\":\"sess-3\",\"requestId\":\"req_e\",\"timestamp\":\"2026-01-03T00:00:00.000Z\",\"cwd\":\"~/code/site\",\"message\":{\"id\":\"msg_e\",\"model\":\"claude-opus-x\",\"content\":[],\"usage\":{\"input_tokens\":1,\"cache_creation_input_tokens\":0,\"cache_read_input_tokens\":0,\"output_tokens\":1}}}\n\
         {\"type\":\"assistant\",\"sessionId\":\"sess-4\",\"requestId\":\"req_f\",\"timestamp\":\"2026-01-03T00:00:00.000Z\",\"message\":{\"id\":\"msg_f\",\"model\":\"claude-opus-x\",\"content\":[],\"usage\":{\"input_tokens\":2,\"cache_creation_input_tokens\":0,\"cache_read_input_tokens\":0,\"output_tokens\":2}}}\n",
    );
    setup.index.refresh(&setup.root).unwrap();
    assert_eq!(
        setup.index.stats(None).unwrap().by_project,
        vec![
            (String::new(), tokens(2, 0, 0, 2)),
            ("~/code/app".to_string(), tokens(14, 102, 1203, 53)),
            ("~/code/site".to_string(), tokens(1, 0, 0, 1)),
        ]
    );
}

#[test]
fn stats_for_project_count_only_that_project_but_by_project_lists_all() {
    let setup = setup();
    append(
        &setup.log,
        "{\"type\":\"assistant\",\"sessionId\":\"sess-3\",\"requestId\":\"req_e\",\"timestamp\":\"2026-01-03T00:00:00.000Z\",\"cwd\":\"~/code/app/sub\",\"message\":{\"id\":\"msg_e\",\"model\":\"claude-opus-x\",\"content\":[],\"usage\":{\"input_tokens\":1,\"cache_creation_input_tokens\":0,\"cache_read_input_tokens\":0,\"output_tokens\":1}}}\n\
         {\"type\":\"assistant\",\"sessionId\":\"sess-4\",\"requestId\":\"req_f\",\"timestamp\":\"2026-01-03T00:00:00.000Z\",\"cwd\":\"~/code/application\",\"message\":{\"id\":\"msg_f\",\"model\":\"claude-opus-x\",\"content\":[],\"usage\":{\"input_tokens\":2,\"cache_creation_input_tokens\":0,\"cache_read_input_tokens\":0,\"output_tokens\":2}}}\n",
    );
    setup.index.refresh(&setup.root).unwrap();
    let all = setup.index.stats(None).unwrap();
    let app = setup.index.stats(Some("~/code/app")).unwrap();
    assert_eq!(app.total, tokens(15, 102, 1203, 54));
    assert_eq!(app.messages, all.messages - 1);
    assert_eq!(app.by_project, all.by_project);
    assert_eq!(setup.index.stats(Some("~/code/none")).unwrap().messages, 0);
}

#[test]
fn session_tokens_sum_the_given_session_ids() {
    let setup = setup();
    setup.index.refresh(&setup.root).unwrap();
    assert_eq!(
        setup.index.session(&["sess-2".to_string()]).unwrap(),
        tokens(1, 2, 3, 4)
    );
    assert_eq!(
        setup
            .index
            .session(&["sess-1".to_string(), "sess-2".to_string()])
            .unwrap(),
        tokens(14, 102, 1203, 53)
    );
    assert_eq!(setup.index.session(&[]).unwrap(), Tokens::default());
}

#[test]
fn context_tokens_are_the_input_and_cache_of_the_sessions_newest_message() {
    let setup = setup();
    setup.index.refresh(&setup.root).unwrap();
    assert_eq!(setup.index.context_tokens("sess-1").unwrap(), 203);
    assert_eq!(setup.index.context_tokens("sess-2").unwrap(), 6);
    assert_eq!(setup.index.context_tokens("none").unwrap(), 0);
}

#[test]
fn a_second_refresh_reads_only_the_appended_lines() {
    let setup = setup();
    setup.index.refresh(&setup.root).unwrap();
    let altered = FIXTURE.replace("\"output_tokens\":42", "\"output_tokens\":99");
    assert_eq!(altered.len(), FIXTURE.len());
    fs::write(&setup.log, altered).unwrap();
    append(
        &setup.log,
        "{\"type\":\"assistant\",\"sessionId\":\"sess-3\",\"requestId\":\"req_e\",\"timestamp\":\"2026-01-03T00:00:00.000Z\",\"message\":{\"id\":\"msg_e\",\"model\":\"claude-opus-x\",\"content\":[],\"usage\":{\"input_tokens\":1,\"cache_creation_input_tokens\":0,\"cache_read_input_tokens\":0,\"output_tokens\":1}}}\n",
    );
    setup.index.refresh(&setup.root).unwrap();
    let stats = setup.index.stats(None).unwrap();
    assert_eq!(stats.total, tokens(15, 102, 1203, 54));
    assert_eq!(stats.messages, 4);
}

#[test]
fn a_line_still_being_written_is_read_once_it_is_complete() {
    let setup = setup();
    setup.index.refresh(&setup.root).unwrap();
    let line = "{\"type\":\"assistant\",\"sessionId\":\"sess-3\",\"requestId\":\"req_e\",\"timestamp\":\"2026-01-03T00:00:00.000Z\",\"message\":{\"id\":\"msg_e\",\"model\":\"claude-opus-x\",\"content\":[],\"usage\":{\"input_tokens\":1,\"cache_creation_input_tokens\":0,\"cache_read_input_tokens\":0,\"output_tokens\":1}}}\n";
    let (head, tail) = line.split_at(40);
    append(&setup.log, head);
    setup.index.refresh(&setup.root).unwrap();
    assert_eq!(setup.index.stats(None).unwrap().messages, 3);
    append(&setup.log, tail);
    setup.index.refresh(&setup.root).unwrap();
    assert_eq!(setup.index.stats(None).unwrap().messages, 4);
}

#[test]
fn a_missing_root_is_an_empty_index() {
    let setup = setup();
    let progress = setup.index.refresh(&setup.root.join("absent")).unwrap();
    assert_eq!(progress.files_total, 0);
    assert_eq!(setup.index.stats(None).unwrap().total, Tokens::default());
}

#[test]
fn rereading_a_rewritten_file_does_not_count_tool_calls_twice() {
    let setup = setup();
    let line = |id: &str| {
        format!(
            "{{\"type\":\"assistant\",\"sessionId\":\"s1\",\"requestId\":\"r_{id}\",\"timestamp\":\"2026-01-01T10:00:00.000Z\",\"message\":{{\"id\":\"{id}\",\"model\":\"m\",\"usage\":{{\"input_tokens\":1,\"output_tokens\":1}},\"content\":[{{\"type\":\"tool_use\",\"id\":\"t\"}}]}}}}\n"
        )
    };
    let tool_log = setup.log.with_file_name("tools.jsonl");
    fs::write(&tool_log, line("m1") + &line("m2")).unwrap();
    setup.index.refresh(&setup.root).unwrap();
    let before = setup.index.stats(None).unwrap().tool_calls;
    fs::write(&tool_log, line("m1")).unwrap();
    setup.index.refresh(&setup.root).unwrap();
    assert_eq!(setup.index.stats(None).unwrap().tool_calls, before);
}

fn used(kind: &str, name: &str, detail: Option<&str>, uses: i64, last_used: &str) -> UseCount {
    UseCount {
        kind: kind.to_string(),
        name: name.to_string(),
        detail: detail.map(str::to_string),
        uses,
        last_used: Some(last_used.to_string()),
    }
}

#[test]
fn uses_count_skills_agents_mcp_commands_hooks_and_loaded_instructions() {
    let setup = setup();
    setup.index.refresh(&setup.root).unwrap();
    let hook = Some("~/code/app/hooks/start.sh");
    assert_eq!(
        setup.index.uses("2026-01-02T00:00:00Z").unwrap(),
        vec![
            used("agent", "Explore", None, 1, "2026-01-02T10:15:00.000Z"),
            used(
                "agent",
                "exo:locate-code",
                None,
                0,
                "2026-01-01T10:00:03.000Z"
            ),
            used("command", "clear", None, 0, "2026-01-01T10:00:00.400Z"),
            used("command", "exo:build", None, 1, "2026-01-02T10:14:30.000Z"),
            used("hook", "SessionStart", hook, 1, "2026-01-02T10:14:00.000Z"),
            used(
                "instructions",
                "~/.claude/rules/style.md",
                None,
                0,
                "2026-01-01T10:00:00.300Z"
            ),
            used(
                "instructions",
                "~/code/app/CLAUDE.md",
                None,
                1,
                "2026-01-02T10:14:00.100Z"
            ),
            used("mcp", "studio", None, 0, "2026-01-01T11:30:00.000Z"),
            used("skill", "exo:build", None, 0, "2026-01-01T10:00:02.000Z"),
        ]
    );
    let all_time = setup.index.uses("").unwrap();
    let count = |kind: &str, name: &str| {
        all_time
            .iter()
            .find(|found| found.kind == kind && found.name == name)
            .unwrap()
            .uses
    };
    assert_eq!(count("agent", "exo:locate-code"), 1);
    assert_eq!(count("command", "exo:build"), 1);
    assert_eq!(count("hook", "SessionStart"), 2);
    assert_eq!(count("instructions", "~/code/app/CLAUDE.md"), 2);
}

const SESSION: &str = "11111111-2222-3333-4444-555555555555";

fn user_line(text: &str) -> String {
    format!(
        "{{\"type\":\"user\",\"sessionId\":\"{SESSION}\",\"timestamp\":\"2026-01-01T10:00:00.000Z\",\"message\":{{\"role\":\"user\",\"content\":{}}}}}\n",
        serde_json::to_string(text).unwrap()
    )
}

fn assistant_line(text: &str) -> String {
    format!(
        "{{\"type\":\"assistant\",\"sessionId\":\"{SESSION}\",\"timestamp\":\"2026-01-01T10:00:01.000Z\",\"message\":{{\"content\":[{{\"type\":\"text\",\"text\":{}}},{{\"type\":\"tool_use\",\"id\":\"t1\",\"name\":\"Bash\",\"input\":{{\"command\":\"frobnicate tool\"}}}}]}}}}\n",
        serde_json::to_string(text).unwrap()
    )
}

fn factory_session(setup: &Setup, lines: &str) -> PathBuf {
    let store = Store::open(&setup.root.parent().unwrap().join("factory.db")).unwrap();
    store
        .add_project(&Project {
            id: "p1".into(),
            path: "repo".into(),
            name: "repo".into(),
        })
        .unwrap();
    store
        .add_job(&Job {
            id: "j1".into(),
            project_id: "p1".into(),
            title: "add login".into(),
            kind: "build".into(),
            mode: "auto".into(),
            branch: "factory/add-login".into(),
            status: JobStatus::Building,
            created_at: 1_700_000_000,
            archived: false,
            pinned: false,
        })
        .unwrap();
    store
        .add_agent(&Agent {
            id: "a1".into(),
            job_id: "j1".into(),
            role: "lead".into(),
            name: "lead".into(),
            kind: "lead".into(),
            model: "claude-sonnet-5-5".into(),
            effort: "medium".into(),
            why: "leads".into(),
            attempt: 1,
            cli_version: "2.1.326".into(),
            session_id: SESSION.into(),
            worktree: "wt/ab12".into(),
            status: "running".into(),
            permission_mode: String::new(),
        })
        .unwrap();
    let path = setup.log.with_file_name(format!("{SESSION}.jsonl"));
    fs::write(&path, lines).unwrap();
    path
}

fn hit(role: &str, text: &str, seq: i64) -> SearchHit {
    SearchHit {
        job_id: "j1".into(),
        agent_id: "a1".into(),
        title: "add login".into(),
        role: role.into(),
        text: text.into(),
        snippet: text.into(),
        seq,
    }
}

#[test]
fn search_finds_prompt_and_reply_text_of_factory_sessions_only() {
    let setup = setup();
    factory_session(
        &setup,
        &(user_line("please frobnicate the widget") + &assistant_line("Frobnicated it for you")),
    );
    fs::write(
        setup.log.with_file_name("other.jsonl"),
        user_line("frobnicate outside factory"),
    )
    .unwrap();
    setup.index.refresh(&setup.root).unwrap();
    let mut hits = setup.index.search("frobnic").unwrap();
    hits.sort_by_key(|found| found.seq);
    assert_eq!(
        hits,
        vec![
            hit("user", "please frobnicate the widget", 0),
            hit("assistant", "Frobnicated it for you", 1),
        ]
    );
    assert_eq!(setup.index.search("widget please").unwrap().len(), 1);
    assert!(setup.index.search("widget absent").unwrap().is_empty());
}

#[test]
fn search_after_a_second_refresh_has_no_duplicates_and_continues_seq() {
    let setup = setup();
    let path = factory_session(&setup, &user_line("first frobnicate"));
    setup.index.refresh(&setup.root).unwrap();
    append(&path, &assistant_line("second frobnicate"));
    setup.index.refresh(&setup.root).unwrap();
    setup.index.refresh(&setup.root).unwrap();
    let mut hits = setup.index.search("frobnicate").unwrap();
    hits.sort_by_key(|found| found.seq);
    assert_eq!(
        hits,
        vec![
            hit("user", "first frobnicate", 0),
            hit("assistant", "second frobnicate", 1),
        ]
    );
}

#[test]
fn search_after_a_shorter_rewrite_holds_only_the_new_text() {
    let setup = setup();
    let path = factory_session(
        &setup,
        &(user_line("old frobnicate prompt") + &assistant_line("old frobnicate reply")),
    );
    setup.index.refresh(&setup.root).unwrap();
    fs::write(&path, user_line("new frobnicate")).unwrap();
    setup.index.refresh(&setup.root).unwrap();
    assert_eq!(
        setup.index.search("frobnicate").unwrap(),
        vec![hit("user", "new frobnicate", 0)]
    );
}

#[test]
fn search_drops_quotes_and_returns_nothing_for_an_empty_query() {
    let setup = setup();
    factory_session(&setup, &user_line("say \"frobnicate\" twice"));
    setup.index.refresh(&setup.root).unwrap();
    assert_eq!(
        setup.index.search("\"frob").unwrap(),
        vec![hit("user", "say \"frobnicate\" twice", 0)]
    );
    assert_eq!(setup.index.search("fro\"bnic OR").unwrap().len(), 0);
    assert!(setup.index.search(" \" ").unwrap().is_empty());
    assert!(setup.index.search("").unwrap().is_empty());
}

#[test]
fn search_snippet_shortens_long_text_with_an_ellipsis() {
    let setup = setup();
    let long = format!("{} frobnicate {}", "word ".repeat(30), "tail ".repeat(30));
    factory_session(&setup, &user_line(&long));
    setup.index.refresh(&setup.root).unwrap();
    let hits = setup.index.search("frobnicate").unwrap();
    assert_eq!(hits.len(), 1);
    assert!(hits[0].snippet.contains("frobnicate"));
    assert!(hits[0].snippet.starts_with('…') && hits[0].snippet.ends_with('…'));
    assert!(!hits[0].snippet.contains('['));
}

#[test]
fn a_project_path_with_sql_wildcards_matches_only_itself_and_its_folders() {
    let setup = setup();
    let line = |session: &str, request: &str, cwd: &str| {
        format!("{{\"type\":\"assistant\",\"sessionId\":\"{session}\",\"requestId\":\"{request}\",\"timestamp\":\"2026-01-03T00:00:00.000Z\",\"cwd\":\"{cwd}\",\"message\":{{\"id\":\"{request}\",\"model\":\"claude-opus-x\",\"content\":[],\"usage\":{{\"input_tokens\":1,\"cache_creation_input_tokens\":0,\"cache_read_input_tokens\":0,\"output_tokens\":1}}}}}}\n")
    };
    append(
        &setup.log,
        &[
            line("s-a", "req_a", "/x/my_app"),
            line("s-b", "req_b", "/x/my_app/sub"),
            line("s-c", "req_c", "/x/myXapp/sub"),
            line("s-d", "req_d", "/x/100%"),
            line("s-e", "req_e", "/x/100abc/sub"),
        ]
        .concat(),
    );
    setup.index.refresh(&setup.root).unwrap();
    assert_eq!(setup.index.stats(Some("/x/my_app")).unwrap().messages, 2);
    assert_eq!(setup.index.stats(Some("/x/100%")).unwrap().messages, 1);
}
