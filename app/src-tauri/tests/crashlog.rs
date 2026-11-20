use factory_lib::crashlog;
use tempfile::TempDir;

#[test]
fn a_panic_in_a_spawned_thread_is_written_to_crash_log_with_a_backtrace() {
    let dir = TempDir::new().unwrap();
    crashlog::install(dir.path().join("logs"));

    let joined = std::thread::Builder::new()
        .name("worker".into())
        .spawn(|| panic!("disk is gone"))
        .unwrap()
        .join();
    assert!(joined.is_err());

    let log = std::fs::read_to_string(dir.path().join("logs").join("crash.log")).unwrap();
    assert!(log.contains("worker"), "{log}");
    assert!(log.contains("disk is gone"), "{log}");
    assert!(log.contains("tests/crashlog.rs"), "{log}");
    assert!(log.contains("a_panic_in_a_spawned_thread"), "{log}");
}
