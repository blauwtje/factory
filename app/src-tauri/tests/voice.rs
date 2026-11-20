use std::path::{Path, PathBuf};
use std::process::Command;

use factory_lib::voice::{Voice, MODEL_FILE};
use tempfile::TempDir;

fn model() -> PathBuf {
    let home = std::env::var("HOME").unwrap();
    Path::new(&home)
        .join("Library/Application Support/dev.factory.app/models")
        .join(MODEL_FILE)
}

fn installed_voice(locale: &str, preferred: &str) -> Option<String> {
    let listing = Command::new("say").args(["-v", "?"]).output().ok()?;
    let names: Vec<String> = String::from_utf8_lossy(&listing.stdout)
        .lines()
        .filter_map(|line| {
            let (name, voice_locale) = line.split('#').next()?.trim().rsplit_once(' ')?;
            (voice_locale == locale).then(|| name.trim().to_string())
        })
        .collect();
    names
        .iter()
        .find(|name| name.starts_with(preferred))
        .or(names.first())
        .cloned()
}

fn speak(dir: &Path, voice: &str, text: &str) -> Vec<f32> {
    let wav = dir.join("speech.wav");
    let status = Command::new("say")
        .args([
            "-v",
            voice,
            "--file-format=WAVE",
            "--data-format=LEF32@16000",
            "-o",
        ])
        .arg(&wav)
        .arg(text)
        .status()
        .unwrap();
    assert!(status.success(), "say -v {voice} failed");
    wav_samples(&std::fs::read(wav).unwrap())
}

fn wav_samples(wav: &[u8]) -> Vec<f32> {
    let mut at = 12;
    while at + 8 <= wav.len() {
        let size = u32::from_le_bytes(wav[at + 4..at + 8].try_into().unwrap()) as usize;
        let body = &wav[at + 8..at + 8 + size];
        if &wav[at..at + 4] == b"data" {
            return body
                .chunks_exact(4)
                .map(|chunk| f32::from_le_bytes(chunk.try_into().unwrap()))
                .collect();
        }
        at += 8 + size + size % 2;
    }
    panic!("wav without a data chunk");
}

#[test]
fn recognises_english_dutch_and_dutch_with_english_words() {
    let model = model();
    if !model.exists() {
        eprintln!("skipped: no whisper model at {}", model.display());
        return;
    }
    let (Some(english), Some(dutch)) = (
        installed_voice("en_US", "Samantha"),
        installed_voice("nl_NL", "Xander"),
    ) else {
        eprintln!("skipped: needs installed en_US and nl_NL voices for say");
        return;
    };
    let dir = TempDir::new().unwrap();
    let voice = Voice::new(model);
    let cases = [
        (
            vec![(
                &english,
                "Please refactor the sidebar and open a pull request.",
            )],
            &["refactor", "sidebar", "pull request"][..],
        ),
        (
            vec![(&dutch, "Kun je de knop groter maken en de tekst aanpassen?")],
            &["knop", "groter", "tekst", "aanpassen"][..],
        ),
        (
            vec![
                (&dutch, "Kun je de"),
                (&english, "sidebar"),
                (&dutch, "refactoren en een"),
                (&english, "pull request"),
                (&dutch, "openen?"),
            ],
            &["sidebar", "refactoren", "pull request", "openen"][..],
        ),
    ];
    for (parts, keywords) in cases {
        let audio: Vec<f32> = parts
            .iter()
            .flat_map(|(speaker, words)| speak(dir.path(), speaker, words))
            .collect();
        let text = voice.transcribe(&audio).unwrap();
        eprintln!("{parts:?} -> {text}");
        let heard = text.to_lowercase();
        for keyword in keywords {
            assert!(heard.contains(keyword), "{keyword:?} missing from {text:?}");
        }
    }
}
