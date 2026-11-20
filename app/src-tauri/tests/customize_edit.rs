use std::fs;
use std::io;
use std::os::unix::fs::symlink;
use std::path::{Path, PathBuf};

use factory_lib::customize_edit::{self, Draft, EditKind, Roots, SaveRequest, Scope};
use tempfile::TempDir;

struct Fixture {
    _dir: TempDir,
    root: PathBuf,
    roots: Roots,
    project: PathBuf,
}

fn fixture() -> Fixture {
    let dir = TempDir::new().unwrap();
    let root = dir.path().to_path_buf();
    let claude = root.join(".claude");
    let project = root.join("code/app");
    let kit = root.join("kit");
    for folder in [&claude, &project, &kit] {
        fs::create_dir_all(folder).unwrap();
    }
    Fixture {
        _dir: dir,
        roots: Roots {
            claude_dir: claude.clone(),
            projects: vec![project.clone()],
            read_only: vec![claude.join("plugins"), kit],
        },
        root,
        project,
    }
}

fn write(path: &Path, text: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
}

fn read(path: &Path) -> String {
    fs::read_to_string(path).unwrap()
}

fn draft(name: &str, description: &str, body: &str) -> Draft {
    Draft {
        name: name.into(),
        description: description.into(),
        paths: Vec::new(),
        body: body.into(),
    }
}

fn request(kind: EditKind, original: Option<&Path>, draft: Draft) -> SaveRequest {
    SaveRequest {
        kind,
        scope: Scope::User,
        project: None,
        original_path: original.map(Path::to_path_buf),
        draft,
    }
}

fn remove(path: &Path) -> io::Result<()> {
    match path.is_dir() {
        true => fs::remove_dir_all(path),
        false => fs::remove_file(path),
    }
}

fn refusal(result: Result<impl std::fmt::Debug, customize_edit::EditError>) -> String {
    result.expect_err("the edit is refused").to_string()
}

#[test]
fn save_creates_a_user_skill_and_a_project_agent() {
    let f = fixture();
    let skill = request(
        EditKind::Skill,
        None,
        draft("deploy", "Ships it: now.", "Deploy."),
    );
    let written = customize_edit::save(&f.roots, &skill).unwrap();
    assert_eq!(written, f.roots.claude_dir.join("skills/deploy/SKILL.md"));
    assert_eq!(
        read(&written),
        "---\nname: deploy\ndescription: \"Ships it: now.\"\n---\nDeploy.\n"
    );

    let agent = SaveRequest {
        scope: Scope::Project,
        project: Some(f.project.clone()),
        ..request(
            EditKind::Agent,
            None,
            draft("helper", "Helps.", "You help."),
        )
    };
    let written = customize_edit::save(&f.roots, &agent).unwrap();
    assert_eq!(written, f.project.join(".claude/agents/helper.md"));
    let reread = customize_edit::read(&f.roots, &written).unwrap();
    assert_eq!(reread, draft("helper", "Helps.", "You help."));
}

#[test]
fn save_keeps_other_frontmatter_keys_in_their_order() {
    let f = fixture();
    let file = f.roots.claude_dir.join("skills/deploy/SKILL.md");
    write(
        &file,
        "---\nname: deploy\nallowed-tools:\n  - Read\n  - Bash\ndescription: >\n  Old\n  text.\nmodel: opus\n---\nOld body.\n",
    );
    let edited = request(
        EditKind::Skill,
        Some(&file),
        draft("deploy", "New text.", "New body."),
    );
    customize_edit::save(&f.roots, &edited).unwrap();
    assert_eq!(
        read(&file),
        "---\nname: deploy\nallowed-tools:\n  - Read\n  - Bash\ndescription: \"New text.\"\nmodel: opus\n---\nNew body.\n"
    );
}

#[test]
fn rules_write_paths_only_when_given_and_memory_has_no_frontmatter() {
    let f = fixture();
    let rule = Draft {
        paths: vec!["src/**/*.rs".into(), "tests/*.rs".into()],
        ..draft("rust", "", "Use clippy.")
    };
    let file = customize_edit::save(&f.roots, &request(EditKind::Rule, None, rule)).unwrap();
    assert_eq!(
        read(&file),
        "---\npaths:\n  - \"src/**/*.rs\"\n  - \"tests/*.rs\"\n---\nUse clippy.\n"
    );
    let always = draft("rust", "", "Use clippy always.");
    customize_edit::save(&f.roots, &request(EditKind::Rule, Some(&file), always)).unwrap();
    assert_eq!(read(&file), "Use clippy always.\n");

    let memory = draft("CLAUDE.md", "", "Be brief.\n");
    let file = customize_edit::save(&f.roots, &request(EditKind::Memory, None, memory)).unwrap();
    assert_eq!(file, f.roots.claude_dir.join("CLAUDE.md"));
    assert_eq!(read(&file), "Be brief.\n");
}

#[test]
fn renaming_a_skill_moves_its_folder_and_an_agent_its_file() {
    let f = fixture();
    let skills = f.roots.claude_dir.join("skills");
    write(
        &skills.join("old/SKILL.md"),
        "---\nname: old\ndescription: Old.\n---\nBody.",
    );
    write(&skills.join("old/reference.md"), "Kept.");
    let renamed = request(
        EditKind::Skill,
        Some(&skills.join("old/SKILL.md")),
        draft("new", "Old.", "Body."),
    );
    let written = customize_edit::save(&f.roots, &renamed).unwrap();
    assert_eq!(written, skills.join("new/SKILL.md"));
    assert!(!skills.join("old").exists());
    assert_eq!(read(&skills.join("new/reference.md")), "Kept.");
    assert_eq!(
        read(&written),
        "---\nname: new\ndescription: Old.\n---\nBody.\n"
    );

    let agents = f.roots.claude_dir.join("agents");
    write(&agents.join("a.md"), "---\nname: a\n---\nA.");
    let renamed = request(
        EditKind::Agent,
        Some(&agents.join("a.md")),
        draft("b", "B.", "A."),
    );
    assert_eq!(
        customize_edit::save(&f.roots, &renamed).unwrap(),
        agents.join("b.md")
    );
    assert!(!agents.join("a.md").exists());
}

#[test]
fn save_refuses_bad_names_and_a_create_onto_an_existing_item() {
    let f = fixture();
    let long = "a".repeat(65);
    for name in [
        "",
        "Deploy",
        "-deploy",
        "de ploy",
        "../deploy",
        "a/b",
        long.as_str(),
    ] {
        let bad = request(EditKind::Skill, None, draft(name, "D.", "B."));
        assert!(
            refusal(customize_edit::save(&f.roots, &bad)).contains("name"),
            "{name:?}"
        );
    }
    let ok = "a".repeat(64);
    customize_edit::save(
        &f.roots,
        &request(EditKind::Agent, None, draft(&ok, "D.", "B.")),
    )
    .unwrap();

    let file = f.roots.claude_dir.join("agents/helper.md");
    write(&file, "Mine.");
    let again = request(EditKind::Agent, None, draft("helper", "D.", "B."));
    assert!(refusal(customize_edit::save(&f.roots, &again)).contains("already exists"));
    write(&f.roots.claude_dir.join("agents/other.md"), "Other.");
    let onto = request(EditKind::Agent, Some(&file), draft("other", "D.", "B."));
    assert!(refusal(customize_edit::save(&f.roots, &onto)).contains("already exists"));
    assert_eq!(read(&file), "Mine.");
}

#[test]
fn edits_outside_the_allowed_folders_are_refused() {
    let f = fixture();
    let outside = f.root.join("outside");
    write(&outside.join("SKILL.md"), "Theirs.");
    write(&outside.join("notes.md"), "Theirs.");
    let skills = f.roots.claude_dir.join("skills");
    fs::create_dir_all(&skills).unwrap();
    symlink(&outside, skills.join("linked")).unwrap();
    let agents = f.project.join(".claude/agents");
    fs::create_dir_all(agents.parent().unwrap()).unwrap();
    symlink(&outside, &agents).unwrap();
    let plugin = f
        .roots
        .claude_dir
        .join("plugins/marketplaces/market/.claude/agents/theirs.md");
    write(&plugin, "Theirs.");
    let kit = f.root.join("kit/.claude/rules/theirs.md");
    write(&kit, "Theirs.");

    let refused = [
        skills.join("linked/SKILL.md"),
        agents.join("notes.md"),
        plugin.clone(),
        kit.clone(),
        f.roots.claude_dir.join("agents/../../outside/notes.md"),
        f.root.join("outside/notes.md"),
        PathBuf::from("relative/.claude/agents/a.md"),
    ];
    for path in &refused {
        assert!(
            customize_edit::read(&f.roots, path).is_err(),
            "read {path:?}"
        );
        assert!(
            customize_edit::delete(&f.roots, path, remove).is_err(),
            "delete {path:?}"
        );
        let edit = request(EditKind::Agent, Some(path), draft("theirs", "D.", "Mine."));
        assert!(
            customize_edit::save(&f.roots, &edit).is_err(),
            "save {path:?}"
        );
    }

    let through_link = SaveRequest {
        scope: Scope::Project,
        project: Some(f.project.clone()),
        ..request(EditKind::Agent, None, draft("new", "D.", "Mine."))
    };
    assert!(customize_edit::save(&f.roots, &through_link).is_err());
    let into_kit = SaveRequest {
        scope: Scope::Project,
        project: Some(f.root.join("kit")),
        ..request(EditKind::Rule, None, draft("new", "", "Mine."))
    };
    assert!(customize_edit::save(&f.roots, &into_kit).is_err());
    let no_project = SaveRequest {
        scope: Scope::Project,
        ..request(EditKind::Rule, None, draft("new", "", "Mine."))
    };
    assert!(customize_edit::save(&f.roots, &no_project).is_err());

    assert!(!outside.join("new.md").exists());
    assert!(!f.root.join("kit/.claude/rules/new.md").exists());
    for path in [
        outside.join("SKILL.md"),
        outside.join("notes.md"),
        plugin,
        kit,
    ] {
        assert_eq!(read(&path), "Theirs.");
    }
}

#[test]
fn only_the_user_folder_and_registered_projects_are_roots() {
    let f = fixture();
    let stranger = f.root.join("code/stranger");
    let theirs = [
        stranger.join("CLAUDE.md"),
        stranger.join("CLAUDE.local.md"),
        stranger.join(".claude/agents/theirs.md"),
        stranger.join(".claude/rules/theirs.md"),
        stranger.join(".claude/skills/theirs/SKILL.md"),
        f.root.join("code/app/nested/CLAUDE.md"),
    ];
    for path in &theirs {
        write(path, "Theirs.");
        assert!(
            customize_edit::read(&f.roots, path).is_err(),
            "read {path:?}"
        );
        assert!(
            customize_edit::delete(&f.roots, path, remove).is_err(),
            "delete {path:?}"
        );
        assert!(path.exists(), "{path:?} was deleted");
    }
    let kind = |path: &Path| match path.file_name().unwrap().to_str().unwrap() {
        "SKILL.md" => EditKind::Skill,
        name if name.starts_with("CLAUDE") => EditKind::Memory,
        _ if path.to_string_lossy().contains("/agents/") => EditKind::Agent,
        _ => EditKind::Rule,
    };
    for path in &theirs {
        let edit = request(kind(path), Some(path), draft("theirs", "D.", "Mine."));
        assert!(
            customize_edit::save(&f.roots, &edit).is_err(),
            "save {path:?}"
        );
        assert_eq!(read(path), "Theirs.");
    }
    let into_stranger = SaveRequest {
        scope: Scope::Project,
        project: Some(stranger.clone()),
        ..request(EditKind::Rule, None, draft("new", "", "Mine."))
    };
    assert!(customize_edit::save(&f.roots, &into_stranger).is_err());
    assert!(!stranger.join(".claude/rules/new.md").exists());

    let registered = f.project.join("CLAUDE.md");
    write(&registered, "Mine.");
    assert!(customize_edit::read(&f.roots, &registered).is_ok());
    let nested = f.project.join(".claude/CLAUDE.md");
    write(&nested, "Mine.");
    assert!(customize_edit::read(&f.roots, &nested).is_ok());
}

#[test]
fn save_keeps_a_block_scalar_description_when_it_did_not_change() {
    let f = fixture();
    let file = f.roots.claude_dir.join("skills/deploy/SKILL.md");
    write(
        &file,
        "---\nname: deploy\ndescription: |\n  Ships the build.\n  Then tags it.\nmodel: opus\n---\nOld body.\n",
    );
    let current = customize_edit::read(&f.roots, &file).unwrap();
    let edited = request(
        EditKind::Skill,
        Some(&file),
        Draft {
            body: "New body.".into(),
            ..current
        },
    );
    customize_edit::save(&f.roots, &edited).unwrap();
    assert_eq!(
        read(&file),
        "---\nname: deploy\ndescription: |\n  Ships the build.\n  Then tags it.\nmodel: opus\n---\nNew body.\n"
    );
}

#[test]
fn delete_removes_the_skill_folder_or_the_file() {
    let f = fixture();
    let skill = f.roots.claude_dir.join("skills/deploy");
    write(&skill.join("SKILL.md"), "Deploy.");
    write(&skill.join("script.sh"), "echo");
    let rule = f.project.join(".claude/rules/rust.md");
    write(&rule, "Rust.");
    let memory = f.project.join("CLAUDE.md");
    write(&memory, "Brief.");

    let mut discarded = Vec::new();
    let mut discard = |path: &Path| {
        discarded.push(path.to_path_buf());
        remove(path)
    };
    customize_edit::delete(&f.roots, &skill.join("SKILL.md"), &mut discard).unwrap();
    customize_edit::delete(&f.roots, &rule, &mut discard).unwrap();
    customize_edit::delete(&f.roots, &memory, &mut discard).unwrap();
    assert_eq!(discarded, [skill.clone(), rule.clone(), memory.clone()]);
    assert!(!skill.exists() && !rule.exists() && !memory.exists());
    assert!(f.roots.claude_dir.join("skills").is_dir());
    let untouched = |path: &Path| -> io::Result<()> { panic!("discarded {path:?} again") };
    customize_edit::delete(&f.roots, &rule, untouched).unwrap();
}
