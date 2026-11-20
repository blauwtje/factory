use std::fmt;
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::kit::{file_name, Frontmatter};

const MEMORY_FILES: [&str; 2] = ["CLAUDE.md", "CLAUDE.local.md"];
const NAME_CHARS: usize = 64;

#[derive(Debug)]
pub struct EditError(String);

impl fmt::Display for EditError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for EditError {}

fn refuse<T>(message: impl Into<String>) -> Result<T, EditError> {
    Err(EditError(message.into()))
}

fn io_error(operation: &str, path: &Path) -> impl Fn(io::Error) -> EditError {
    let operation = format!("{operation} {}", path.display());
    move |error| EditError(format!("{operation}: {error}"))
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Draft {
    pub name: String,
    pub description: String,
    pub paths: Vec<String>,
    pub body: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EditKind {
    Skill,
    Agent,
    Rule,
    Memory,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Scope {
    User,
    Project,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SaveRequest {
    pub kind: EditKind,
    pub scope: Scope,
    pub project: Option<PathBuf>,
    pub original_path: Option<PathBuf>,
    pub draft: Draft,
}

pub struct Roots {
    pub claude_dir: PathBuf,
    pub projects: Vec<PathBuf>,
    pub read_only: Vec<PathBuf>,
}

struct Located {
    kind: EditKind,
    item: PathBuf,
    file: PathBuf,
}

fn exists(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok()
}

fn plain(path: &Path) -> bool {
    path.is_absolute()
        && path.components().all(|part| {
            matches!(
                part,
                Component::RootDir | Component::Prefix(_) | Component::Normal(_)
            )
        })
}

fn named(path: Option<&Path>, name: &str) -> bool {
    path.and_then(Path::file_name)
        .is_some_and(|file| file == name)
}

impl Roots {
    fn is_project(&self, dir: &Path) -> bool {
        self.projects.iter().any(|project| project == dir)
    }

    fn is_root(&self, dir: &Path) -> bool {
        dir == self.claude_dir
            || named(Some(dir), ".claude") && dir.parent().is_some_and(|home| self.is_project(home))
    }
}

fn shape(roots: &Roots, path: &Path) -> Option<(EditKind, PathBuf, PathBuf)> {
    let name = file_name(path);
    let parent = path.parent()?;
    if MEMORY_FILES.contains(&name.as_str()) {
        return (roots.is_root(parent) || roots.is_project(parent))
            .then(|| (EditKind::Memory, parent.into(), path.into()));
    }
    let folder = parent.parent()?;
    if name == "SKILL.md" && named(Some(folder), "skills") {
        let root = folder.parent()?;
        return roots
            .is_root(root)
            .then(|| (EditKind::Skill, root.into(), parent.into()));
    }
    let kind = match file_name(parent).as_str() {
        "agents" => EditKind::Agent,
        "rules" => EditKind::Rule,
        _ => return None,
    };
    (name.ends_with(".md") && roots.is_root(folder)).then(|| (kind, folder.into(), path.into()))
}

fn resolved(path: &Path) -> Result<PathBuf, EditError> {
    path.canonicalize().map_err(io_error("resolve", path))
}

fn confine(roots: &Roots, root: &Path, path: &Path) -> Result<(), EditError> {
    let anchor = path
        .ancestors()
        .find(|ancestor| exists(ancestor))
        .expect("an absolute path has an existing root");
    let real = resolved(anchor)?;
    let real_root = match root.strip_prefix(anchor) {
        Ok(missing) => real.join(missing),
        Err(_) => resolved(root)?,
    };
    let below_root = path
        .strip_prefix(root)
        .expect("a located path is inside its root");
    let expected = real_root.join(below_root);
    if real.join(
        path.strip_prefix(anchor)
            .expect("an ancestor prefixes its path"),
    ) != expected
    {
        return refuse(format!(
            "{} goes through a symbolic link out of {}",
            path.display(),
            root.display()
        ));
    }
    let read_only = roots
        .read_only
        .iter()
        .find(|dir| expected.starts_with(dir.canonicalize().unwrap_or_else(|_| dir.to_path_buf())));
    match read_only {
        Some(dir) => refuse(format!(
            "{} is inside the read-only {}",
            path.display(),
            dir.display()
        )),
        None => Ok(()),
    }
}

fn locate(roots: &Roots, path: &Path) -> Result<Located, EditError> {
    let Some((kind, root, item)) = plain(path).then(|| shape(roots, path)).flatten() else {
        return refuse(format!(
            "{} is not a skill, agent, rule or memory file of the user or a project",
            path.display()
        ));
    };
    confine(roots, &root, path)?;
    Ok(Located {
        kind,
        item,
        file: path.into(),
    })
}

fn checked_name(name: &str) -> Result<&str, EditError> {
    let mut chars = name.chars();
    let first_ok = chars
        .next()
        .is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit());
    let rest_ok = chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    match first_ok && rest_ok && name.len() <= NAME_CHARS {
        true => Ok(name),
        false => refuse(format!(
            "the name {name:?} must be 1 to {NAME_CHARS} lowercase letters, digits or hyphens, not starting with a hyphen"
        )),
    }
}

fn target_path(roots: &Roots, request: &SaveRequest) -> Result<PathBuf, EditError> {
    let (home, root) = match (request.scope, &request.project) {
        (Scope::User, _) => (roots.claude_dir.clone(), roots.claude_dir.clone()),
        (Scope::Project, Some(project)) if roots.is_project(project) => {
            (project.clone(), project.join(".claude"))
        }
        (Scope::Project, project) => {
            return refuse(format!("{project:?} is not a project of Factory"))
        }
    };
    let name = || checked_name(&request.draft.name);
    Ok(match request.kind {
        EditKind::Memory => home.join("CLAUDE.md"),
        EditKind::Skill => root.join("skills").join(name()?).join("SKILL.md"),
        EditKind::Agent => root.join("agents").join(format!("{}.md", name()?)),
        EditKind::Rule => root.join("rules").join(format!("{}.md", name()?)),
    })
}

fn read_text(path: &Path) -> Result<String, EditError> {
    fs::read_to_string(path).map_err(io_error("read", path))
}

pub fn read(roots: &Roots, path: &Path) -> Result<Draft, EditError> {
    let located = locate(roots, path)?;
    let text = read_text(&located.file)?;
    if located.kind == EditKind::Memory {
        return Ok(Draft {
            name: file_name(path),
            description: String::new(),
            paths: Vec::new(),
            body: text,
        });
    }
    let front = Frontmatter::parse(&text);
    let name = match located.kind {
        EditKind::Skill => file_name(&located.item),
        _ => path
            .file_stem()
            .map_or_else(String::new, |stem| stem.to_string_lossy().into()),
    };
    Ok(Draft {
        name,
        description: front.get("description").unwrap_or_default(),
        paths: front.list("paths").unwrap_or_default(),
        body: front.body,
    })
}

struct Entry {
    key: Option<String>,
    lines: Vec<String>,
}

fn front_entries(text: &str) -> Vec<Entry> {
    let mut lines = text.lines();
    if lines.next().map(str::trim_end) != Some("---") {
        return Vec::new();
    }
    let mut entries: Vec<Entry> = Vec::new();
    for line in lines.take_while(|line| line.trim_end() != "---") {
        let key = match line.starts_with([' ', '\t', '-']) {
            true => None,
            false => line.split_once(':').map(|(key, _)| key.trim().to_string()),
        };
        match (key, entries.last_mut()) {
            (None, Some(last)) => last.lines.push(line.into()),
            (key, _) => entries.push(Entry {
                key,
                lines: vec![line.into()],
            }),
        }
    }
    entries
}

fn set(entries: &mut Vec<Entry>, key: &str, lines: Option<Vec<String>>) {
    let at = entries
        .iter()
        .position(|entry| entry.key.as_deref() == Some(key));
    match (at, lines) {
        (Some(at), Some(lines)) => entries[at].lines = lines,
        (Some(at), None) => {
            entries.remove(at);
        }
        (None, Some(lines)) => entries.push(Entry {
            key: Some(key.into()),
            lines,
        }),
        (None, None) => {}
    }
}

fn quoted(value: &str) -> String {
    Value::from(value).to_string()
}

fn with_newline(body: &str) -> String {
    match body.is_empty() || body.ends_with('\n') {
        true => body.into(),
        false => format!("{body}\n"),
    }
}

fn render(kind: EditKind, current: &str, draft: &Draft) -> String {
    if kind == EditKind::Memory {
        return with_newline(&draft.body);
    }
    let mut entries = front_entries(current);
    if kind != EditKind::Rule {
        set(
            &mut entries,
            "name",
            Some(vec![format!("name: {}", draft.name)]),
        );
    }
    let unchanged = !draft.description.is_empty()
        && Frontmatter::parse(current).get("description").as_deref() == Some(&draft.description);
    if !unchanged {
        let description = (kind != EditKind::Rule || !draft.description.is_empty())
            .then(|| vec![format!("description: {}", quoted(&draft.description))]);
        set(&mut entries, "description", description);
    }
    if kind == EditKind::Rule {
        let paths = (!draft.paths.is_empty()).then(|| {
            std::iter::once("paths:".to_string())
                .chain(
                    draft
                        .paths
                        .iter()
                        .map(|glob| format!("  - {}", quoted(glob))),
                )
                .collect()
        });
        set(&mut entries, "paths", paths);
    }
    if entries.is_empty() {
        return with_newline(&draft.body);
    }
    let front: Vec<String> = entries.into_iter().flat_map(|entry| entry.lines).collect();
    format!(
        "---\n{}\n---\n{}",
        front.join("\n"),
        with_newline(&draft.body)
    )
}

fn same_folder(a: &Path, b: &Path) -> bool {
    match (
        a.parent().map(Path::canonicalize),
        b.parent().map(Path::canonicalize),
    ) {
        (Some(Ok(a)), Some(Ok(b))) => a == b,
        _ => false,
    }
}

fn move_item(original: &Located, target: &Located) -> Result<(), EditError> {
    if original.item == target.item {
        return Ok(());
    }
    if !same_folder(&original.item, &target.item) {
        return refuse(format!(
            "{} cannot move to {}",
            original.item.display(),
            target.item.display()
        ));
    }
    if exists(&target.item) {
        return refuse(format!("{} already exists", target.item.display()));
    }
    fs::rename(&original.item, &target.item).map_err(io_error("move", &original.item))
}

pub fn save(roots: &Roots, request: &SaveRequest) -> Result<PathBuf, EditError> {
    let original = match &request.original_path {
        Some(path) => Some(locate(roots, path)?),
        None => None,
    };
    let target = match (&original, request.kind) {
        (Some(original), EditKind::Memory) => locate(roots, &original.file)?,
        _ => locate(roots, &target_path(roots, request)?)?,
    };
    if target.kind != request.kind || original.as_ref().is_some_and(|o| o.kind != request.kind) {
        return refuse(format!(
            "{} is not a {:?} file",
            target.file.display(),
            request.kind
        ));
    }
    match &original {
        Some(original) if !original.file.is_file() => {
            return refuse(format!("{} does not exist", original.file.display()))
        }
        Some(original) => move_item(original, &target)?,
        None if exists(&target.item) => {
            return refuse(format!("{} already exists", target.item.display()))
        }
        None => {}
    }
    let current = match fs::read_to_string(&target.file) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => String::new(),
        text => text.map_err(io_error("read", &target.file))?,
    };
    let folder = target.file.parent().expect("a located file has a folder");
    fs::create_dir_all(folder).map_err(io_error("create", folder))?;
    fs::write(&target.file, render(request.kind, &current, &request.draft))
        .map_err(io_error("write", &target.file))?;
    Ok(target.file)
}

pub fn delete<E: fmt::Display>(
    roots: &Roots,
    path: &Path,
    discard: impl FnOnce(&Path) -> Result<(), E>,
) -> Result<(), EditError> {
    let located = locate(roots, path)?;
    if !exists(&located.file) {
        return Ok(());
    }
    discard(&located.item).map_err(|error| {
        EditError(format!(
            "move {} to the Trash: {error}",
            located.item.display()
        ))
    })
}
