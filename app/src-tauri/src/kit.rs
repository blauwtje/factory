use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fmt;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::bus::{KindChoice, KitConfig, TOOL_NAMES};

const CLAUDE_TOOLS: [&str; 13] = [
    "Read",
    "Write",
    "Edit",
    "Bash",
    "Glob",
    "Grep",
    "WebSearch",
    "WebFetch",
    "Skill",
    "TaskStop",
    "TodoWrite",
    "NotebookEdit",
    "Agent",
];
const CONFIG: &str = "config.json";

#[derive(Debug)]
pub struct KitError(String);

impl fmt::Display for KitError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for KitError {}

fn io_error(operation: String) -> impl Fn(io::Error) -> KitError {
    move |error| KitError(format!("{operation}: {error}"))
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Role {
    pub name: String,
    pub description: String,
    pub model: String,
    pub effort: String,
    pub tools: Vec<String>,
    pub prompt: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Origin {
    Builtin,
    Edited,
    Custom,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct KitRole {
    #[serde(flatten)]
    pub role: Role,
    pub origin: Origin,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Skill {
    pub name: String,
    pub description: String,
    pub enabled: bool,
    pub origin: Origin,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Kind {
    pub id: String,
    #[serde(flatten)]
    pub choice: KindChoice,
}

#[derive(Debug, Clone, Serialize)]
pub struct KindRow {
    #[serde(flatten)]
    pub kind: Kind,
    pub edited: bool,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct Overrides {
    #[serde(default)]
    models: BTreeMap<String, KindChoice>,
    #[serde(default)]
    disabled_skills: BTreeSet<String>,
}

pub struct Kit {
    bundled: PathBuf,
    overrides: PathBuf,
    built: PathBuf,
    writing: Mutex<()>,
}

pub fn tools() -> Vec<String> {
    CLAUDE_TOOLS
        .iter()
        .map(|tool| tool.to_string())
        .chain(TOOL_NAMES.iter().map(|tool| format!("mcp__factory__{tool}")))
        .collect()
}

fn checked_name(name: &str) -> Result<&str, KitError> {
    let valid = !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    match valid {
        true => Ok(name),
        false => Err(KitError(format!(
            "name {name:?} must be lowercase letters, digits and dashes"
        ))),
    }
}

fn checked_role(role: &Role) -> Result<(), KitError> {
    checked_name(&role.name)?;
    if role.tools.is_empty() {
        return Err(KitError(format!("role {:?} needs at least one tool", role.name)));
    }
    let fields = [&role.model, &role.effort].into_iter().chain(&role.tools);
    for value in fields {
        if value.trim().is_empty() || value.contains(['\n', '\r', ',']) {
            return Err(KitError(format!(
                "role {:?} has an invalid value {value:?}",
                role.name
            )));
        }
    }
    Ok(())
}

pub struct Frontmatter {
    values: HashMap<String, Vec<String>>,
    pub body: String,
}

const BLOCK_MARKERS: [&str; 6] = [">", "|", ">-", "|-", ">+", "|+"];

fn unquote(value: &str) -> String {
    if value.starts_with('"') {
        return serde_json::from_str(value).unwrap_or_else(|_| value.trim_matches('"').into());
    }
    match value.strip_prefix('\'').and_then(|rest| rest.strip_suffix('\'')) {
        Some(inner) => inner.replace("''", "'"),
        None => value.into(),
    }
}

impl Frontmatter {
    pub fn parse(source: &str) -> Frontmatter {
        let mut lines = source.lines();
        if lines.next().map(str::trim_end) != Some("---") {
            return Frontmatter {
                values: HashMap::new(),
                body: source.into(),
            };
        }
        let mut values: HashMap<String, Vec<String>> = HashMap::new();
        let mut key = None;
        for line in lines.by_ref().take_while(|line| line.trim_end() != "---") {
            let nested = line.starts_with([' ', '\t', '-']);
            match (nested, &key) {
                (true, Some(key)) => {
                    let list = values.get_mut(key).expect("a nested line follows its key");
                    Frontmatter::add_nested(list, line.trim());
                }
                (false, _) => {
                    let Some((name, value)) = line.split_once(':') else {
                        continue;
                    };
                    let value = value.trim();
                    let value = if BLOCK_MARKERS.contains(&value) { "" } else { value };
                    values.insert(name.trim().into(), vec![value.into()]);
                    key = Some(name.trim().to_string());
                }
                _ => {}
            }
        }
        Frontmatter {
            values,
            body: lines.collect::<Vec<_>>().join("\n"),
        }
    }

    fn add_nested(list: &mut Vec<String>, line: &str) {
        if *list == [""] {
            list.clear();
        }
        match line.strip_prefix('-') {
            Some(item) => list.push(item.trim().into()),
            None => match list.last_mut() {
                Some(last) => *last = format!("{last} {line}").trim().into(),
                None => list.push(line.into()),
            },
        }
    }

    pub fn get(&self, key: &str) -> Option<String> {
        let value = self.values.get(key)?.first()?;
        (!value.is_empty()).then(|| unquote(value))
    }

    pub fn list(&self, key: &str) -> Option<Vec<String>> {
        let values = self.values.get(key)?;
        let items: Vec<&str> = match values.as_slice() {
            [inline] if inline.starts_with('[') => {
                inline.trim_matches(['[', ']']).split(',').map(str::trim).collect()
            }
            _ => values.iter().map(String::as_str).collect(),
        };
        Some(
            items
                .into_iter()
                .filter(|item| !item.is_empty())
                .map(unquote)
                .collect(),
        )
    }
}

fn field(front: &Frontmatter, key: &str, file: &Path) -> Result<String, KitError> {
    front.get(key).ok_or_else(|| {
        KitError(format!(
            "{} has no {key} in its frontmatter",
            file.display()
        ))
    })
}

fn parse_role(source: &str, file: &Path) -> Result<Role, KitError> {
    let front = Frontmatter::parse(source);
    let field = |key| field(&front, key, file);
    Ok(Role {
        name: field("name")?,
        description: field("description")?,
        model: field("model")?,
        effort: field("effort")?,
        tools: field("tools")?
            .split(',')
            .map(|tool| tool.trim().into())
            .collect(),
        prompt: front.body,
    })
}

fn render_role(role: &Role) -> String {
    format!(
        "---\nname: {}\ndescription: {}\nmodel: {}\neffort: {}\ntools: {}\n---\n{}\n",
        role.name,
        Value::from(role.description.as_str()),
        role.model,
        role.effort,
        role.tools.join(", "),
        role.prompt
    )
}

fn read(path: &Path) -> Result<String, KitError> {
    fs::read_to_string(path).map_err(io_error(format!("read {}", path.display())))
}

fn write(path: &Path, text: &str) -> Result<(), KitError> {
    let parent = path.parent().expect("a kit file has a folder");
    fs::create_dir_all(parent).map_err(io_error(format!("create {}", parent.display())))?;
    fs::write(path, text).map_err(io_error(format!("write {}", path.display())))
}

fn remove_file(path: &Path) -> Result<(), KitError> {
    match fs::remove_file(path) {
        Err(error) if error.kind() != io::ErrorKind::NotFound => {
            Err(io_error(format!("remove {}", path.display()))(error))
        }
        _ => Ok(()),
    }
}

fn remove_dir(path: &Path) -> Result<(), KitError> {
    match fs::remove_dir_all(path) {
        Err(error) if error.kind() != io::ErrorKind::NotFound => {
            Err(io_error(format!("remove {}", path.display()))(error))
        }
        _ => Ok(()),
    }
}

pub(crate) fn entries(dir: &Path) -> Result<Vec<PathBuf>, KitError> {
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let list = io_error(format!("list {}", dir.display()));
    let mut paths = fs::read_dir(dir)
        .map_err(&list)?
        .map(|entry| entry.map(|entry| entry.path()))
        .collect::<Result<Vec<_>, _>>()
        .map_err(&list)?;
    paths.sort();
    Ok(paths)
}

fn copy_dir(from: &Path, to: &Path) -> Result<(), KitError> {
    fs::create_dir_all(to).map_err(io_error(format!("create {}", to.display())))?;
    for path in entries(from)? {
        let target = to.join(path.file_name().expect("a listed entry has a name"));
        if path.is_dir() {
            copy_dir(&path, &target)?;
        } else {
            fs::copy(&path, &target).map_err(io_error(format!("copy {}", path.display())))?;
        }
    }
    Ok(())
}

pub(crate) fn file_name(path: &Path) -> String {
    path.file_name()
        .map_or_else(String::new, |name| name.to_string_lossy().into())
}

impl Kit {
    pub fn open(bundled: PathBuf, data: &Path) -> Result<Kit, KitError> {
        let kit = Kit {
            bundled,
            overrides: data.join("kit-overrides"),
            built: data.join("kit"),
            writing: Mutex::default(),
        };
        kit.build()?;
        Ok(kit)
    }

    pub fn dir(&self) -> &Path {
        &self.built
    }

    fn load_overrides(&self) -> Result<Overrides, KitError> {
        let path = self.overrides.join(CONFIG);
        if !path.is_file() {
            return Ok(Overrides::default());
        }
        serde_json::from_str(&read(&path)?)
            .map_err(|error| KitError(format!("{}: {error}", path.display())))
    }

    fn save_overrides(&self, overrides: &Overrides) -> Result<(), KitError> {
        let text = serde_json::to_string_pretty(overrides).expect("overrides serialize");
        write(&self.overrides.join(CONFIG), &text)
    }

    fn build(&self) -> Result<(), KitError> {
        let overrides = self.load_overrides()?;
        let next = self.built.with_extension("next");
        let old = self.built.with_extension("old");
        remove_dir(&next)?;
        remove_dir(&old)?;
        copy_dir(&self.bundled, &next)?;
        for part in ["agents", "skills"] {
            copy_dir(&self.overrides.join(part), &next.join(part))?;
        }
        for skill in &overrides.disabled_skills {
            remove_dir(&next.join("skills").join(skill))?;
        }
        let mut config: Value = serde_json::from_str(&read(&self.bundled.join(CONFIG))?)
            .map_err(|error| KitError(format!("bundled {CONFIG}: {error}")))?;
        for (id, choice) in overrides.models {
            config["models"][id] = serde_json::to_value(choice).expect("a kind serializes");
        }
        write(
            &next.join(CONFIG),
            &serde_json::to_string_pretty(&config).expect("config serializes"),
        )?;
        if self.built.exists() {
            fs::rename(&self.built, &old).map_err(io_error(format!(
                "move {} aside",
                self.built.display()
            )))?;
        }
        fs::rename(&next, &self.built)
            .map_err(io_error(format!("move {} in place", next.display())))?;
        remove_dir(&old)
    }

    fn origin(&self, part: &str, name: &str) -> Origin {
        match (
            self.bundled.join(part).join(name).exists(),
            self.overrides.join(part).join(name).exists(),
        ) {
            (true, false) => Origin::Builtin,
            (true, true) => Origin::Edited,
            (false, _) => Origin::Custom,
        }
    }

    fn role(&self, file: &Path) -> Result<KitRole, KitError> {
        Ok(KitRole {
            role: parse_role(&read(file)?, file)?,
            origin: self.origin("agents", &file_name(file)),
        })
    }

    pub fn roles(&self) -> Result<Vec<KitRole>, KitError> {
        entries(&self.built.join("agents"))?
            .iter()
            .filter(|file| file.extension().is_some_and(|extension| extension == "md"))
            .map(|file| self.role(file))
            .collect()
    }

    pub fn save_role(&self, role: Role) -> Result<KitRole, KitError> {
        checked_role(&role)?;
        let _writing = self.writing.lock().unwrap();
        let file = format!("{}.md", role.name);
        write(&self.overrides.join("agents").join(&file), &render_role(&role))?;
        self.build()?;
        self.role(&self.built.join("agents").join(file))
    }

    pub fn reset_role(&self, name: &str) -> Result<(), KitError> {
        let name = checked_name(name)?;
        let _writing = self.writing.lock().unwrap();
        remove_file(&self.overrides.join("agents").join(format!("{name}.md")))?;
        self.build()
    }

    pub fn skill_file(&self, name: &str) -> PathBuf {
        let edited = self.overrides.join("skills").join(name).join("SKILL.md");
        match edited.is_file() {
            true => edited,
            false => self.bundled.join("skills").join(name).join("SKILL.md"),
        }
    }

    pub fn skills(&self) -> Result<Vec<Skill>, KitError> {
        let disabled = self.load_overrides()?.disabled_skills;
        let names: BTreeSet<String> = [&self.bundled, &self.overrides]
            .iter()
            .map(|root| entries(&root.join("skills")))
            .collect::<Result<Vec<_>, _>>()?
            .concat()
            .iter()
            .filter(|dir| dir.join("SKILL.md").is_file())
            .map(|dir| file_name(dir))
            .collect();
        names
            .into_iter()
            .map(|name| {
                let file = self.skill_file(&name);
                let front = Frontmatter::parse(&read(&file)?);
                Ok(Skill {
                    description: field(&front, "description", &file)?,
                    enabled: !disabled.contains(&name),
                    origin: match self.origin("skills", &name) {
                        Origin::Custom => Origin::Custom,
                        _ => Origin::Builtin,
                    },
                    name,
                })
            })
            .collect()
    }

    pub fn set_skill_enabled(&self, name: &str, enabled: bool) -> Result<(), KitError> {
        let name = checked_name(name)?;
        let _writing = self.writing.lock().unwrap();
        let mut overrides = self.load_overrides()?;
        match enabled {
            true => overrides.disabled_skills.remove(name),
            false => overrides.disabled_skills.insert(name.into()),
        };
        self.save_overrides(&overrides)?;
        self.build()
    }

    pub fn kinds(&self) -> Result<Vec<KindRow>, KitError> {
        let edited = self.load_overrides()?.models;
        let config = KitConfig::load(&self.built).map_err(|error| KitError(error.to_string()))?;
        Ok(config
            .models
            .into_iter()
            .map(|(id, choice)| KindRow {
                edited: edited.contains_key(&id),
                kind: Kind { id, choice },
            })
            .collect())
    }

    pub fn save_kind(&self, kind: Kind) -> Result<KindRow, KitError> {
        let bundled =
            KitConfig::load(&self.bundled).map_err(|error| KitError(error.to_string()))?;
        if !bundled.models.contains_key(&kind.id) {
            return Err(KitError(format!("unknown kind {:?}", kind.id)));
        }
        let _writing = self.writing.lock().unwrap();
        let mut overrides = self.load_overrides()?;
        overrides.models.insert(kind.id.clone(), kind.choice.clone());
        self.save_overrides(&overrides)?;
        self.build()?;
        Ok(KindRow { kind, edited: true })
    }

    pub fn reset_kind(&self, id: &str) -> Result<(), KitError> {
        let _writing = self.writing.lock().unwrap();
        let mut overrides = self.load_overrides()?;
        overrides.models.remove(id);
        self.save_overrides(&overrides)?;
        self.build()
    }
}
