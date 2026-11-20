use std::backtrace::Backtrace;
use std::io::Write;
use std::panic::PanicHookInfo;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub fn install(dir: PathBuf) {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let _ = append(&dir, &entry(info));
        previous(info);
    }));
}

fn entry(info: &PanicHookInfo) -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs());
    let thread = std::thread::current();
    let name = thread.name().unwrap_or("<unnamed>");
    let backtrace = Backtrace::force_capture();
    format!("[{seconds}] thread '{name}' {info}\n{backtrace}\n\n")
}

fn append(dir: &Path, entry: &str) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("crash.log"))?
        .write_all(entry.as_bytes())
}
