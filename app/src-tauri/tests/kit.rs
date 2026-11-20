use std::fs;
use std::path::Path;

use factory_lib::bus::KindChoice;
use factory_lib::kit::{Kind, Kit, KitRole, Origin};
use serde_json::Value;
use tempfile::TempDir;

const KIT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../kit");

fn opened() -> (TempDir, Kit) {
    let data = TempDir::new().unwrap();
    let kit = Kit::open(KIT.into(), data.path()).unwrap();
    (data, kit)
}

fn role(kit: &Kit, name: &str) -> Option<KitRole> {
    kit.roles()
        .unwrap()
        .into_iter()
        .find(|role| role.role.name == name)
}

fn built_config(kit: &Kit) -> Value {
    serde_json::from_str(&fs::read_to_string(kit.dir().join("config.json")).unwrap()).unwrap()
}

#[test]
fn an_edited_role_is_in_the_built_kit_until_it_is_reset() {
    let (_data, kit) = opened();
    let file = kit.dir().join("agents/builder.md");
    let bundled = fs::read_to_string(Path::new(KIT).join("agents/builder.md")).unwrap();
    assert_eq!(fs::read_to_string(&file).unwrap(), bundled);

    let mut edited = role(&kit, "builder").unwrap().role;
    edited.tools.retain(|tool| tool != "Bash");
    edited.prompt = "# Builder\n\nOnly edit.".into();
    let saved = kit.save_role(edited.clone()).unwrap();
    assert_eq!((saved.role, saved.origin), (edited, Origin::Edited));
    let built = fs::read_to_string(&file).unwrap();
    assert!(built.contains("Only edit.") && !built.contains("Bash"), "{built}");

    kit.reset_role("builder").unwrap();
    assert_eq!(fs::read_to_string(&file).unwrap(), bundled);
    assert_eq!(role(&kit, "builder").unwrap().origin, Origin::Builtin);

    let mut own = role(&kit, "tester").unwrap().role;
    own.name = "linter".into();
    assert_eq!(kit.save_role(own).unwrap().origin, Origin::Custom);
    kit.reset_role("linter").unwrap();
    assert!(role(&kit, "linter").is_none());
}

#[test]
fn a_disabled_skill_is_left_out_of_the_built_kit() {
    let (_data, kit) = opened();
    let skill = kit.dir().join("skills/document");
    assert!(skill.join("SKILL.md").is_file());

    kit.set_skill_enabled("document", false).unwrap();
    assert!(!skill.exists());
    let skills = kit.skills().unwrap();
    let bundled = fs::read_dir(Path::new(KIT).join("skills"))
        .unwrap()
        .filter(|entry| entry.as_ref().unwrap().path().is_dir())
        .count();
    assert_eq!(skills.len(), bundled);
    let document = skills.iter().find(|skill| skill.name == "document").unwrap();
    assert!(!document.enabled);
    assert!(document.description.starts_with("Writes and edits prose"));

    kit.set_skill_enabled("document", true).unwrap();
    assert!(skill.join("SKILL.md").is_file());
}

#[test]
fn a_saved_kind_is_in_the_built_config_until_it_is_reset() {
    let (_data, kit) = opened();
    let edited = |kit: &Kit| {
        kit.kinds()
            .unwrap()
            .into_iter()
            .find(|row| row.kind.id == "build")
            .unwrap()
            .edited
    };
    kit.save_kind(Kind {
        id: "build".into(),
        choice: KindChoice {
            role: "builder".into(),
            model: "claude-opus-5-5".into(),
            effort: "high".into(),
        },
    })
    .unwrap();
    let config = built_config(&kit);
    assert_eq!(config["models"]["build"]["model"], "claude-opus-5-5");
    assert_eq!(config["specs"], "docs");
    assert!(edited(&kit));

    kit.reset_kind("build").unwrap();
    assert_eq!(built_config(&kit)["models"]["build"]["model"], "claude-sonnet-5-5");
    assert!(!edited(&kit));
}
