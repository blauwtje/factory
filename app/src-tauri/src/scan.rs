use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Verdict {
    Pass,
    Review,
    Risk,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Finding {
    pub level: Verdict,
    pub reason: String,
}

const MIN_BASE64_RUN: usize = 120;
const SHELLS: [&str; 3] = ["sh", "bash", "zsh"];

pub fn findings(text: &str) -> Vec<Finding> {
    let rules: [(Verdict, &str, fn(&str) -> bool); 4] = [
        (Verdict::Risk, "Invisible characters", has_invisible),
        (
            Verdict::Risk,
            "Downloads and runs code",
            has_download_and_run,
        ),
        (Verdict::Review, "Hidden HTML comment", |text| {
            text.contains("<!--")
        }),
        (Verdict::Review, "Long base64 text", has_long_base64),
    ];
    rules
        .into_iter()
        .filter(|(_, _, matches)| matches(text))
        .map(|(level, reason, _)| Finding {
            level,
            reason: reason.into(),
        })
        .collect()
}

pub fn verdict(findings: &[Finding]) -> Verdict {
    findings
        .iter()
        .map(|finding| finding.level)
        .max()
        .unwrap_or(Verdict::Pass)
}

fn is_invisible(index: usize, c: char) -> bool {
    matches!(
        c,
        '\u{200B}'..='\u{200F}'
            | '\u{2060}'..='\u{2064}'
            | '\u{202A}'..='\u{202E}'
            | '\u{2066}'..='\u{2069}'
            | '\u{E0000}'..='\u{E007F}'
    ) || (c == '\u{FEFF}' && index > 0)
}

fn has_invisible(text: &str) -> bool {
    text.char_indices().any(|(index, c)| is_invisible(index, c))
}

fn has_download_and_run(text: &str) -> bool {
    text.lines().any(downloads_and_runs)
}

fn downloads_and_runs(line: &str) -> bool {
    let Some(start) = ["curl ", "wget "]
        .iter()
        .filter_map(|tool| line.find(tool))
        .min()
    else {
        return false;
    };
    line[start..].split('|').skip(1).any(|after| {
        SHELLS
            .iter()
            .any(|shell| starts_with_word(after.trim_start(), shell))
    })
}

fn starts_with_word(text: &str, word: &str) -> bool {
    text.strip_prefix(word)
        .is_some_and(|rest| !rest.starts_with(|c: char| c.is_ascii_alphanumeric()))
}

fn is_base64(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '+' | '/' | '=')
}

fn has_long_base64(text: &str) -> bool {
    text.split(|c: char| !is_base64(c))
        .any(|run| run.len() >= MIN_BASE64_RUN)
}
