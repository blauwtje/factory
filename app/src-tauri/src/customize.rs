use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;

use crate::kit::{entries, file_name, Frontmatter, Kit, KitError};
use crate::scan::{self, Finding, Verdict};
use crate::transcripts::UseCount;

const CONTEXT_MAX: i64 = 200_000;
const USE_DAYS: u64 = 30;
const SECONDS_PER_DAY: u64 = 86_400;
const SCAN_MAX_BYTES: u64 = 256 * 1024;
const HOOK_SCRIPT_EXTENSIONS: [&str; 6] = [".sh", ".mjs", ".cjs", ".js", ".ts", ".py"];
const HOOK_COMMAND_CHARS: usize = 60;
const PROJECT_MEMORY: [&str; 3] = ["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"];
const PLUGIN_PARTS: [(ItemKind, &str, &str); 5] = [
    (ItemKind::Skill, "skill", "skills"),
    (ItemKind::Agent, "agent", "agents"),
    (ItemKind::Command, "command", "commands"),
    (ItemKind::Mcp, "MCP server", "MCP servers"),
    (ItemKind::Hook, "hook", "hooks"),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ItemKind {
    Plugin,
    Skill,
    Agent,
    Mcp,
    Hook,
    Rule,
    Memory,
    Command,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Factory,
    User,
    Project,
    Plugin,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum InstallScope {
    User,
    Project,
    Local,
}

impl InstallScope {
    fn of(scope: &str) -> Option<InstallScope> {
        match scope {
            "user" => Some(InstallScope::User),
            "project" => Some(InstallScope::Project),
            "local" => Some(InstallScope::Local),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CustomizeItem {
    pub id: String,
    pub kind: ItemKind,
    pub name: String,
    pub description: String,
    pub source: Source,
    pub plugin: Option<String>,
    pub origin: Option<String>,
    pub scope: Option<InstallScope>,
    pub version: Option<String>,
    pub path: String,
    pub invocation: String,
    pub enabled: bool,
    pub loaded_tokens: Option<i64>,
    pub use_tokens: i64,
    pub exact: bool,
    pub uses: i64,
    pub last_used: Option<String>,
    pub scan: Scan,
    pub conflicts: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Scan {
    pub verdict: Verdict,
    pub findings: Vec<Finding>,
}

impl Scan {
    fn of(found: impl IntoIterator<Item = Finding>) -> Scan {
        let mut findings: Vec<Finding> = Vec::new();
        for finding in found {
            if !findings.iter().any(|seen| seen.reason == finding.reason) {
                findings.push(finding);
            }
        }
        Scan {
            verdict: scan::verdict(&findings),
            findings,
        }
    }

    fn text(text: &str) -> Scan {
        Scan::of(scan::findings(text))
    }

    fn folder(dir: &Path) -> Scan {
        Scan::of(
            all_files(dir)
                .iter()
                .filter(|file| fs::metadata(file).is_ok_and(|meta| meta.len() <= SCAN_MAX_BYTES))
                .filter_map(|file| read(file))
                .flat_map(|text| scan::findings(&text)),
        )
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Customize {
    pub project_path: Option<String>,
    pub items: Vec<CustomizeItem>,
    pub context_max: i64,
    pub measured: bool,
    pub measured_at: Option<String>,
    pub context: Option<Context>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Context {
    pub total: i64,
    pub max: i64,
    pub categories: Vec<ContextCategory>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ContextCategory {
    pub name: String,
    pub tokens: i64,
    pub kind: CategoryKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CategoryKind {
    Used,
    Deferred,
    Buffer,
    Free,
}

impl CategoryKind {
    fn of(kind: Option<&str>) -> CategoryKind {
        match kind {
            Some("deferred") => CategoryKind::Deferred,
            Some("buffer") => CategoryKind::Buffer,
            Some("free") => CategoryKind::Free,
            _ => CategoryKind::Used,
        }
    }
}

type UseKey = (String, String, Option<String>);
type Uses<'a> = HashMap<UseKey, &'a UseCount>;

struct Found {
    item: CustomizeItem,
    keys: Vec<UseKey>,
}

struct Root {
    dir: PathBuf,
    source: Source,
    plugin: Option<String>,
    origin: Option<String>,
    scope: Option<InstallScope>,
    version: Option<String>,
    prefix: Option<String>,
    enabled: bool,
}

fn label(value: impl Serialize) -> String {
    let value = serde_json::to_value(value).expect("a label serializes");
    value.as_str().expect("a label is a string").into()
}

impl Root {
    fn new(dir: PathBuf, source: Source) -> Root {
        Root {
            dir,
            source,
            plugin: None,
            origin: None,
            scope: None,
            version: None,
            prefix: None,
            enabled: true,
        }
    }

    fn names(&self, name: &str) -> Vec<String> {
        let mut names = vec![name.to_string()];
        names.extend(
            self.prefix
                .as_ref()
                .map(|prefix| format!("{prefix}:{name}")),
        );
        names
    }

    fn slash(&self, name: &str) -> String {
        match &self.prefix {
            Some(prefix) => format!("/{prefix}:{name}"),
            None => format!("/{name}"),
        }
    }

    fn item(&self, kind: ItemKind, name: String, path: &Path) -> CustomizeItem {
        CustomizeItem {
            id: format!(
                "{}:{}:{}:{name}",
                label(kind),
                label(self.source),
                self.plugin.as_deref().unwrap_or_default()
            ),
            kind,
            name,
            description: String::new(),
            source: self.source,
            plugin: self.plugin.clone(),
            origin: self.origin.clone(),
            scope: self.scope,
            version: self.version.clone(),
            path: path.to_string_lossy().into(),
            invocation: String::new(),
            enabled: self.enabled,
            loaded_tokens: Some(0),
            use_tokens: 0,
            exact: false,
            uses: 0,
            last_used: None,
            scan: Scan::of([]),
            conflicts: Vec::new(),
        }
    }
}

pub fn since(now: SystemTime) -> String {
    let today = now
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs() / SECONDS_PER_DAY);
    let (year, month, day) = civil_date(today as i64 - USE_DAYS as i64);
    format!("{year:04}-{month:02}-{day:02}T00:00:00Z")
}

pub fn timestamp(now: SystemTime) -> String {
    let seconds = now
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs());
    let (year, month, day) = civil_date((seconds / SECONDS_PER_DAY) as i64);
    let of_day = seconds % SECONDS_PER_DAY;
    let (hour, minute, second) = (of_day / 3600, of_day % 3600 / 60, of_day % 60);
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

fn civil_date(days: i64) -> (i64, i64, i64) {
    let shifted_days = days + 719_468;
    let era = shifted_days.div_euclid(146_097);
    let day_of_era = shifted_days - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted_month = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * shifted_month + 2) / 5 + 1;
    let month = if shifted_month < 10 {
        shifted_month + 3
    } else {
        shifted_month - 9
    };
    (year_of_era + era * 400 + i64::from(month <= 2), month, day)
}

fn estimate(text: &str) -> i64 {
    (text.chars().count() as i64 + 2) / 4
}

fn read(file: &Path) -> Option<String> {
    fs::read_to_string(file).ok()
}

fn json(file: &Path) -> Value {
    read(file)
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or(Value::Null)
}

fn listed(list: &Value, name: &str) -> bool {
    list.as_array()
        .is_some_and(|items| items.iter().any(|item| item.as_str() == Some(name)))
}

fn markdown_files(dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    for path in entries(dir).unwrap_or_default() {
        if path.is_dir() {
            files.extend(markdown_files(&path));
        } else if path.extension().is_some_and(|extension| extension == "md") {
            files.push(path);
        }
    }
    files
}

fn all_files(dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    for path in entries(dir).unwrap_or_default() {
        match fs::symlink_metadata(&path) {
            Ok(meta) if meta.is_dir() => files.extend(all_files(&path)),
            _ => files.push(path),
        }
    }
    files
}

fn relative_name(dir: &Path, file: &Path, separator: &str) -> String {
    let relative = file.strip_prefix(dir).unwrap_or(file).with_extension("");
    relative
        .components()
        .map(|part| part.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join(separator)
}

fn use_keys(kind: &str, names: Vec<String>) -> Vec<UseKey> {
    names
        .into_iter()
        .map(|name| (kind.to_string(), name, None))
        .collect()
}

fn instructions_key(file: &Path) -> Vec<UseKey> {
    use_keys("instructions", vec![file.to_string_lossy().into()])
}

fn command_line(config: &Value) -> Option<String> {
    let text = |key: &str| config[key].as_str();
    let command = text("command")
        .or_else(|| text("url"))
        .or_else(|| text("prompt"))?;
    let args = config["args"].as_array().into_iter().flatten();
    let line: Vec<&str> = std::iter::once(command)
        .chain(args.filter_map(Value::as_str))
        .collect();
    Some(line.join(" "))
}

fn skill(root: &Root, dir_name: &str, file: &Path) -> Option<Found> {
    let front = Frontmatter::parse(&read(file)?);
    let name = front.get("name").unwrap_or_else(|| dir_name.into());
    let description = front.get("description").unwrap_or_default();
    let manual = front.get("disable-model-invocation").as_deref() == Some("true");
    let hidden = front.get("user-invocable").as_deref() == Some("false");
    let slash = root.slash(&name);
    let invocation = match (manual, hidden) {
        (true, _) => format!("Only {slash}"),
        (false, true) => "Only Claude".into(),
        (false, false) => format!("Claude or {slash}"),
    };
    let loaded = match manual {
        true => 0,
        false => estimate(&format!("{name}{description}")),
    };
    let names = root.names(&name);
    Some(Found {
        keys: [use_keys("skill", names.clone()), use_keys("command", names)].concat(),
        item: CustomizeItem {
            description,
            invocation,
            loaded_tokens: Some(loaded),
            use_tokens: estimate(&front.body),
            scan: Scan::folder(file.parent()?),
            ..root.item(ItemKind::Skill, name, file)
        },
    })
}

fn skills(root: &Root) -> Vec<Found> {
    entries(&root.dir.join("skills"))
        .unwrap_or_default()
        .iter()
        .filter_map(|dir| skill(root, &file_name(dir), &dir.join("SKILL.md")))
        .collect()
}

fn kit_skills(kit: &Kit, root: &Root) -> Result<Vec<Found>, KitError> {
    Ok(kit
        .skills()?
        .into_iter()
        .filter_map(|kit_skill| {
            let mut found = skill(root, &kit_skill.name, &kit.skill_file(&kit_skill.name))?;
            found.item.enabled = kit_skill.enabled;
            Some(found)
        })
        .collect())
}

fn agents(root: &Root) -> Vec<Found> {
    let dir = root.dir.join("agents");
    markdown_files(&dir)
        .iter()
        .filter_map(|file| {
            let text = read(file)?;
            let front = Frontmatter::parse(&text);
            let name = front
                .get("name")
                .unwrap_or_else(|| relative_name(&dir, file, ":"));
            let description = front.get("description").unwrap_or_default();
            Some(Found {
                keys: use_keys("agent", root.names(&name)),
                item: CustomizeItem {
                    invocation: "Claude starts it".into(),
                    loaded_tokens: Some(estimate(&description)),
                    use_tokens: estimate(&front.body),
                    description,
                    scan: Scan::text(&text),
                    ..root.item(ItemKind::Agent, name, file)
                },
            })
        })
        .collect()
}

fn commands(root: &Root) -> Vec<Found> {
    let dir = root.dir.join("commands");
    markdown_files(&dir)
        .iter()
        .filter_map(|file| {
            let text = read(file)?;
            let front = Frontmatter::parse(&text);
            let name = relative_name(&dir, file, ":");
            let description = front.get("description").unwrap_or_default();
            Some(Found {
                keys: use_keys("command", root.names(&name)),
                item: CustomizeItem {
                    invocation: root.slash(&name),
                    loaded_tokens: Some(estimate(&description)),
                    use_tokens: estimate(&front.body),
                    description,
                    scan: Scan::text(&text),
                    ..root.item(ItemKind::Command, name, file)
                },
            })
        })
        .collect()
}

fn rules(root: &Root) -> Vec<Found> {
    let dir = root.dir.join("rules");
    markdown_files(&dir)
        .iter()
        .filter_map(|file| {
            let front = Frontmatter::parse(&read(file)?);
            let size = estimate(&front.body);
            let (invocation, loaded, on_use) = match front.list("paths") {
                Some(globs) => (format!("When files match {}", globs.join(", ")), 0, size),
                None => ("Always".to_string(), size, 0),
            };
            Some(Found {
                keys: instructions_key(file),
                item: CustomizeItem {
                    description: front.get("description").unwrap_or_default(),
                    invocation,
                    loaded_tokens: Some(loaded),
                    use_tokens: on_use,
                    ..root.item(ItemKind::Rule, relative_name(&dir, file, "/"), file)
                },
            })
        })
        .collect()
}

fn kit_rules(root: &Root) -> Vec<Found> {
    rules(root)
        .into_iter()
        .map(|found| Found {
            keys: Vec::new(),
            item: CustomizeItem {
                invocation: "When an agent reads it".into(),
                loaded_tokens: Some(0),
                use_tokens: found.item.use_tokens + found.item.loaded_tokens.unwrap_or(0),
                ..found.item
            },
        })
        .collect()
}

fn memory(root: &Root, base: &Path, names: &[&str]) -> Vec<Found> {
    names
        .iter()
        .filter_map(|name| {
            let file = base.join(name);
            let text = read(&file)?;
            Some(Found {
                keys: instructions_key(&file),
                item: CustomizeItem {
                    invocation: "Always".into(),
                    loaded_tokens: Some(estimate(&text)),
                    ..root.item(ItemKind::Memory, name.to_string(), &file)
                },
            })
        })
        .collect()
}

fn hook_label(command: &str) -> String {
    command
        .split_whitespace()
        .rev()
        .map(|token| token.trim_matches(['"', '\'']))
        .find(|token| {
            token.contains('/')
                && HOOK_SCRIPT_EXTENSIONS
                    .iter()
                    .any(|extension| token.ends_with(extension))
        })
        .and_then(|script| script.rsplit('/').next())
        .map_or_else(
            || command.chars().take(HOOK_COMMAND_CHARS).collect(),
            String::from,
        )
}

fn hooks(root: &Root, file: &Path, settings: &Value) -> Vec<Found> {
    let mut found = Vec::new();
    for (event, groups) in settings["hooks"].as_object().into_iter().flatten() {
        for group in groups.as_array().into_iter().flatten() {
            let invocation = match group["matcher"].as_str() {
                Some(matcher) if !matcher.is_empty() => format!("{event} · {matcher}"),
                _ => event.clone(),
            };
            for hook in group["hooks"].as_array().into_iter().flatten() {
                let Some(command) = command_line(hook) else {
                    continue;
                };
                let command = match root.prefix {
                    Some(_) => {
                        command.replace("${CLAUDE_PLUGIN_ROOT}", &root.dir.to_string_lossy())
                    }
                    None => command,
                };
                found.push(Found {
                    keys: vec![("hook".into(), event.clone(), Some(command.clone()))],
                    item: CustomizeItem {
                        name: format!("{event} · {}", hook_label(&command)),
                        description: command.clone(),
                        invocation: invocation.clone(),
                        ..root.item(ItemKind::Hook, format!("{invocation} {command}"), file)
                    },
                });
            }
        }
    }
    found
}

fn servers(
    root: &Root,
    file: &Path,
    servers: &Value,
    enabled: impl Fn(&str) -> bool,
) -> Vec<Found> {
    servers
        .as_object()
        .into_iter()
        .flatten()
        .map(|(name, config)| {
            let mut names = vec![name.clone()];
            names.extend(
                root.plugin
                    .as_ref()
                    .map(|plugin| format!("plugin_{plugin}_{name}")),
            );
            Found {
                keys: use_keys("mcp", names),
                item: CustomizeItem {
                    description: command_line(config).unwrap_or_default(),
                    invocation: "Claude calls its tools".into(),
                    enabled: root.enabled && enabled(name),
                    loaded_tokens: None,
                    ..root.item(ItemKind::Mcp, name.clone(), file)
                },
            }
        })
        .collect()
}

fn parts(root: &Root) -> Vec<Found> {
    [skills(root), agents(root), commands(root)]
        .into_iter()
        .flatten()
        .collect()
}

fn counted(found: Found, uses: &Uses) -> CustomizeItem {
    let mut item = found.item;
    for count in found.keys.iter().filter_map(|key| uses.get(key)) {
        item.uses += count.uses;
        item.last_used = item.last_used.max(count.last_used.clone());
    }
    if !item.enabled {
        item.loaded_tokens = Some(0);
    }
    item
}

fn plugin_summary(parts: &[CustomizeItem]) -> String {
    let counts: Vec<String> = PLUGIN_PARTS
        .iter()
        .filter_map(|(kind, one, many)| {
            match parts.iter().filter(|part| part.kind == *kind).count() {
                0 => None,
                1 => Some(format!("1 {one}")),
                count => Some(format!("{count} {many}")),
            }
        })
        .collect();
    match counts.is_empty() {
        true => "Adds nothing".into(),
        false => format!("Adds {}", counts.join(", ")),
    }
}

fn plugin_row(root: &Root, name: &str, parts: &[CustomizeItem]) -> CustomizeItem {
    let manifest = json(&root.dir.join(".claude-plugin/plugin.json"));
    let owner = Root::new(root.dir.clone(), Source::Plugin);
    CustomizeItem {
        description: manifest["description"].as_str().unwrap_or_default().into(),
        invocation: plugin_summary(parts),
        enabled: root.enabled,
        loaded_tokens: parts.iter().map(|part| part.loaded_tokens).sum(),
        use_tokens: parts.iter().map(|part| part.use_tokens).sum(),
        uses: parts.iter().map(|part| part.uses).sum(),
        last_used: parts.iter().filter_map(|part| part.last_used.clone()).max(),
        scan: Scan::of(parts.iter().flat_map(|part| {
            part.scan.findings.iter().map(|finding| Finding {
                level: finding.level,
                reason: format!("{}: {}", part.name, finding.reason),
            })
        })),
        origin: root.origin.clone(),
        scope: root.scope,
        version: root.version.clone(),
        ..owner.item(ItemKind::Plugin, name.into(), &root.dir)
    }
}

fn marketplace_origin(marketplaces: &Value, marketplace: &str) -> Option<String> {
    let source = &marketplaces[marketplace]["source"];
    let text = |key: &str| source[key].as_str();
    match text("source")? {
        "github" => Some(format!("github.com/{}", text("repo")?)),
        "git" => text("url").map(String::from),
        "directory" => text("path").map(String::from),
        _ => None,
    }
}

fn plugins(
    claude_dir: &Path,
    project: Option<&Path>,
    enabled: &HashMap<String, bool>,
    uses: &Uses,
) -> Vec<CustomizeItem> {
    let installed = json(&claude_dir.join("plugins/installed_plugins.json"));
    let marketplaces = json(&claude_dir.join("plugins/known_marketplaces.json"));
    let mut items = Vec::new();
    for (id, installs) in installed["plugins"].as_object().into_iter().flatten() {
        let applies = |install: &&Value| {
            install["scope"] == "user" || install["projectPath"].as_str().map(Path::new) == project
        };
        let Some(install) = installs.as_array().into_iter().flatten().find(applies) else {
            continue;
        };
        let Some(dir) = install["installPath"].as_str() else {
            continue;
        };
        let (name, marketplace) = id.split_once('@').unwrap_or((id.as_str(), ""));
        let root = Root {
            plugin: Some(name.into()),
            origin: marketplace_origin(&marketplaces, marketplace),
            scope: install["scope"].as_str().and_then(InstallScope::of),
            version: install["version"].as_str().map(String::from),
            prefix: Some(name.into()),
            enabled: enabled.get(id).copied().unwrap_or(true),
            ..Root::new(dir.into(), Source::Plugin)
        };
        let (hooks_file, mcp_file) = (
            root.dir.join("hooks/hooks.json"),
            root.dir.join(".mcp.json"),
        );
        let mcp = json(&mcp_file);
        let found = [
            parts(&root),
            hooks(&root, &hooks_file, &json(&hooks_file)),
            servers(
                &root,
                &mcp_file,
                mcp.get("mcpServers").unwrap_or(&mcp),
                |_| true,
            ),
        ];
        let parts: Vec<CustomizeItem> = found
            .into_iter()
            .flatten()
            .map(|found| counted(found, uses))
            .collect();
        items.push(plugin_row(&root, name, &parts));
        items.extend(parts);
    }
    items
}

const BUILT_IN_STYLES: [&str; 5] = ["default", "Concise", "Explanatory", "Learning", "Proactive"];

fn style_name(file: &Path) -> Option<String> {
    if file.extension()? != "md" {
        return None;
    }
    let text = read(file)?;
    let named = text
        .strip_prefix("---")
        .and_then(|rest| rest.split("\n---").next())
        .and_then(|front| front.lines().find_map(|line| line.trim().strip_prefix("name:")))
        .map(|name| name.trim().trim_matches(['"', '\'']).to_string())
        .filter(|name| !name.is_empty());
    named.or_else(|| Some(file.file_stem()?.to_string_lossy().into_owned()))
}

fn styles_in(dir: &Path, prefix: Option<&str>) -> Vec<String> {
    let Ok(read) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut names: Vec<String> = read
        .flatten()
        .filter_map(|entry| style_name(&entry.path()))
        .map(|name| prefix.map_or_else(|| name.clone(), |prefix| format!("{prefix}:{name}")))
        .collect();
    names.sort();
    names
}

pub fn output_styles(claude_dir: &Path) -> Vec<String> {
    let enabled: HashMap<String, bool> = json(&claude_dir.join("settings.json"))["enabledPlugins"]
        .as_object()
        .into_iter()
        .flatten()
        .filter_map(|(id, on)| Some((id.clone(), on.as_bool()?)))
        .collect();
    let installed = json(&claude_dir.join("plugins/installed_plugins.json"));
    let mut styles: Vec<String> = BUILT_IN_STYLES.iter().map(|name| name.to_string()).collect();
    styles.extend(styles_in(&claude_dir.join("output-styles"), None));
    for (id, installs) in installed["plugins"].as_object().into_iter().flatten() {
        if !enabled.get(id).copied().unwrap_or(false) {
            continue;
        }
        let user = installs.as_array().into_iter().flatten().find(|install| install["scope"] == "user");
        let Some(dir) = user.and_then(|install| install["installPath"].as_str()) else {
            continue;
        };
        let name = id.split_once('@').map_or(id.as_str(), |(name, _)| name);
        styles.extend(styles_in(&Path::new(dir).join("output-styles"), Some(name)));
    }
    let mut seen = std::collections::HashSet::new();
    styles.retain(|name| seen.insert(name.clone()));
    styles
}

fn mark_conflicts(items: &mut [CustomizeItem]) {
    let canonical: Vec<PathBuf> = items
        .iter()
        .map(|item| fs::canonicalize(&item.path).unwrap_or_else(|_| PathBuf::from(&item.path)))
        .collect();
    let clash = |a: usize, b: usize| {
        let (one, other) = (&items[a], &items[b]);
        a != b
            && matches!(
                one.kind,
                ItemKind::Skill | ItemKind::Agent | ItemKind::Command | ItemKind::Mcp
            )
            && one.kind == other.kind
            && one.name == other.name
            && (canonical[a] != canonical[b]
                || (one.kind == ItemKind::Mcp && one.source != other.source))
    };
    let conflicts: Vec<Vec<String>> = (0..items.len())
        .map(|a| {
            (0..items.len())
                .filter(|&b| clash(a, b))
                .map(|b| items[b].path.clone())
                .collect()
        })
        .collect();
    for (item, found) in items.iter_mut().zip(conflicts) {
        item.conflicts = found;
    }
}

fn settings_files(claude_dir: &Path, project: Option<&Path>) -> Vec<PathBuf> {
    let mut files = vec![claude_dir.join("settings.json")];
    if let Some(project) = project {
        files.push(project.join(".claude/settings.json"));
        files.push(project.join(".claude/settings.local.json"));
    }
    files
}

pub fn list(
    kit: &Kit,
    claude_dir: &Path,
    project: Option<&Path>,
    uses: &[UseCount],
) -> Result<Customize, KitError> {
    let uses: Uses = uses
        .iter()
        .map(|count| {
            (
                (count.kind.clone(), count.name.clone(), count.detail.clone()),
                count,
            )
        })
        .collect();
    let claude_json_file = claude_dir.with_file_name(".claude.json");
    let claude_json = json(&claude_json_file);
    let local = match project {
        Some(path) => claude_json["projects"][path.to_string_lossy().as_ref()].clone(),
        None => Value::Null,
    };
    let settings: Vec<(PathBuf, Value)> = settings_files(claude_dir, project)
        .into_iter()
        .map(|file| {
            let value = json(&file);
            (file, value)
        })
        .collect();
    let enabled_plugins: HashMap<String, bool> = settings
        .iter()
        .filter_map(|(_, value)| value["enabledPlugins"].as_object())
        .flatten()
        .filter_map(|(id, on)| Some((id.clone(), on.as_bool()?)))
        .collect();
    let approve_all = settings
        .iter()
        .filter_map(|(_, value)| value["enableAllProjectMcpServers"].as_bool())
        .last()
        .unwrap_or(false);
    let switched_on = |name: &str| !listed(&local["disabledMcpServers"], name);

    let kit_root = Root {
        prefix: json(&kit.dir().join(".claude-plugin/plugin.json"))["name"]
            .as_str()
            .map(String::from),
        ..Root::new(kit.dir().into(), Source::Factory)
    };
    let kit_hooks_file = kit.dir().join("hooks/hooks.json");
    let mut found: Vec<Found> = [
        kit_skills(kit, &kit_root)?,
        agents(&kit_root),
        commands(&kit_root),
        kit_rules(&kit_root),
        hooks(&kit_root, &kit_hooks_file, &json(&kit_hooks_file)),
    ]
    .into_iter()
    .flatten()
    .collect();

    let user = Root::new(claude_dir.into(), Source::User);
    found.extend(parts(&user));
    found.extend(rules(&user));
    found.extend(memory(&user, claude_dir, &["CLAUDE.md"]));
    let (user_settings, project_settings) = settings.split_at(1);
    for (file, value) in user_settings {
        found.extend(hooks(&user, file, value));
    }
    found.extend(servers(
        &user,
        &claude_json_file,
        &claude_json["mcpServers"],
        switched_on,
    ));

    if let Some(project) = project {
        let shared = Root::new(project.join(".claude"), Source::Project);
        found.extend(parts(&shared));
        found.extend(rules(&shared));
        found.extend(memory(&shared, project, &PROJECT_MEMORY));
        for (file, value) in project_settings {
            found.extend(hooks(&shared, file, value));
        }
        found.extend(servers(
            &shared,
            &claude_json_file,
            &local["mcpServers"],
            switched_on,
        ));
        let approved = |name: &str| {
            (approve_all || listed(&local["enabledMcpjsonServers"], name))
                && !listed(&local["disabledMcpjsonServers"], name)
                && switched_on(name)
        };
        let mcp_file = project.join(".mcp.json");
        found.extend(servers(
            &shared,
            &mcp_file,
            &json(&mcp_file)["mcpServers"],
            approved,
        ));
    }

    let mut items: Vec<CustomizeItem> = found
        .into_iter()
        .map(|found| counted(found, &uses))
        .collect();
    items.extend(plugins(claude_dir, project, &enabled_plugins, &uses));
    let mut seen = HashSet::new();
    for item in &mut items {
        if !seen.insert(item.id.clone()) {
            item.id = format!("{}:{}", item.id, item.path);
            seen.insert(item.id.clone());
        }
    }
    mark_conflicts(&mut items);
    Ok(Customize {
        project_path: project.map(|path| path.to_string_lossy().into()),
        items,
        context_max: CONTEXT_MAX,
        measured: false,
        measured_at: None,
        context: None,
    })
}

pub fn fingerprint(claude_dir: &Path, project: Option<&Path>, customize: &Customize) -> u64 {
    let mut items: Vec<&CustomizeItem> = customize.items.iter().collect();
    items.sort_by(|a, b| a.id.cmp(&b.id));
    let mut hasher = DefaultHasher::new();
    for item in items {
        (&item.id, &item.path, item.enabled).hash(&mut hasher);
        (&item.description, &item.invocation).hash(&mut hasher);
        if item.path.ends_with(".md") {
            read(Path::new(&item.path)).hash(&mut hasher);
        }
    }
    for file in settings_files(claude_dir, project) {
        read(&file).hash(&mut hasher);
    }
    hasher.finish()
}

#[derive(Debug, Clone, Default)]
pub struct Measurement {
    context: Option<Context>,
    files: Vec<(String, i64)>,
    servers: HashMap<String, i64>,
    deferred: HashMap<String, i64>,
    agents: Vec<(Option<String>, String, i64)>,
    skills: Vec<(Option<String>, String, i64)>,
}

fn tokens_of(entry: &Value) -> i64 {
    entry["tokens"].as_i64().unwrap_or(0)
}

fn reported(entries: &Value, name_key: &str) -> Vec<(Option<String>, String, i64)> {
    entries
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let name = entry[name_key].as_str()?;
            let path = entry["path"].as_str().map(String::from);
            Some((path, name.to_string(), tokens_of(entry)))
        })
        .collect()
}

fn same_file(item: &CustomizeItem, path: &str) -> bool {
    Path::new(&item.path).starts_with(path)
}

fn same_name(item: &CustomizeItem, name: &str) -> bool {
    match (&item.plugin, item.source) {
        (Some(plugin), _) => name == format!("{plugin}:{}", item.name),
        (None, Source::Factory) => name.ends_with(&format!(":{}", item.name)),
        (None, _) => name == item.name,
    }
}

fn found_in(entries: &[(Option<String>, String, i64)], item: &CustomizeItem) -> Option<i64> {
    entries.iter().find_map(|(path, name, tokens)| {
        let same = match path {
            Some(path) => same_file(item, path),
            None => same_name(item, name),
        };
        same.then_some(*tokens)
    })
}

fn per_server<'a>(entries: impl IntoIterator<Item = &'a Value>) -> HashMap<String, i64> {
    let mut servers: HashMap<String, i64> = HashMap::new();
    for entry in entries {
        if let Some(server) = entry["serverName"].as_str() {
            *servers.entry(server.into()).or_default() += tokens_of(entry);
        }
    }
    servers
}

fn context_of(report: &Value) -> Option<Context> {
    Some(Context {
        total: report["totalTokens"].as_i64()?,
        max: report["maxTokens"].as_i64()?,
        categories: report["categories"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|category| {
                Some(ContextCategory {
                    name: category["name"].as_str()?.into(),
                    tokens: tokens_of(category),
                    kind: CategoryKind::of(category["kind"].as_str()),
                })
            })
            .collect(),
    })
}

fn server_name(item: &CustomizeItem) -> String {
    match &item.plugin {
        Some(plugin) => format!("plugin_{plugin}_{}", item.name),
        None => item.name.clone(),
    }
}

impl Measurement {
    pub fn from_report(report: &Value) -> Measurement {
        let (loaded_tools, deferred_tools): (Vec<&Value>, Vec<&Value>) = report["mcpTools"]
            .as_array()
            .into_iter()
            .flatten()
            .partition(|tool| tool["isLoaded"].as_bool() != Some(false));
        let instructions = report["mcpInstructions"].as_array().into_iter().flatten();
        Measurement {
            context: context_of(report),
            servers: per_server(loaded_tools.into_iter().chain(instructions)),
            deferred: per_server(deferred_tools),
            files: report["memoryFiles"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|file| Some((file["path"].as_str()?.into(), tokens_of(file))))
                .collect(),
            agents: reported(&report["agents"], "agentType"),
            skills: reported(&report["skills"]["skillFrontmatter"], "name"),
        }
    }

    fn tokens(&self, item: &CustomizeItem) -> Option<i64> {
        match item.kind {
            ItemKind::Memory | ItemKind::Rule => self
                .files
                .iter()
                .find_map(|(path, tokens)| (item.path == *path).then_some(*tokens)),
            ItemKind::Mcp => self
                .servers
                .get(&server_name(item))
                .copied()
                .or_else(|| self.deferred_only(item).map(|_| 0)),
            ItemKind::Agent => found_in(&self.agents, item),
            ItemKind::Skill => found_in(&self.skills, item),
            ItemKind::Plugin | ItemKind::Hook | ItemKind::Command => None,
        }
    }

    fn deferred_only(&self, item: &CustomizeItem) -> Option<i64> {
        let name = server_name(item);
        if item.kind != ItemKind::Mcp || self.servers.contains_key(&name) {
            return None;
        }
        self.deferred.get(&name).copied()
    }

    pub fn apply(&self, customize: &mut Customize) {
        customize.context = self.context.clone();
        for item in customize.items.iter_mut().filter(|item| item.enabled) {
            if let Some(tokens) = self.tokens(item) {
                item.loaded_tokens = Some(tokens);
                item.exact = true;
            }
            if let Some(tokens) = self.deferred_only(item) {
                item.use_tokens = tokens;
            }
        }
        let parts: Vec<CustomizeItem> = customize.items.clone();
        for plugin in customize
            .items
            .iter_mut()
            .filter(|item| item.kind == ItemKind::Plugin)
        {
            let own: Vec<&CustomizeItem> = parts
                .iter()
                .filter(|part| part.plugin.as_deref() == Some(plugin.name.as_str()))
                .collect();
            plugin.loaded_tokens = own.iter().map(|part| part.loaded_tokens).sum();
            plugin.exact = own
                .iter()
                .filter(|part| part.enabled)
                .all(|part| part.exact);
        }
    }
}
