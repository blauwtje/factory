pub mod accounts;
pub mod agent;
pub mod audit;
pub mod bus;
pub mod commands;
pub mod crashlog;
pub mod customize;
pub mod customize_edit;
pub mod github;
pub mod kit;
pub mod permission;
pub mod protocol;
pub mod scan;
pub mod store;
pub mod transcripts;
pub mod tray;
pub mod voice;
pub mod worktree;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| tray::show_main_window(app)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            crashlog::install(app.path().app_log_dir()?);
            tray::create(app.handle())?;
            let paths = commands::Paths {
                data: app.path().app_data_dir()?,
                local: app.path().app_local_data_dir()?,
                kit: app.path().resource_dir()?.join("kit"),
            };
            let emit = commands::tauri_emit(app.handle().clone());
            let core = commands::Core::open(paths, emit).map_err(|error| error.to_string())?;
            app.manage(core.clone());
            let model = app.path().app_data_dir()?.join("models").join(voice::MODEL_FILE);
            app.manage(std::sync::Arc::new(voice::Voice::new(model)));
            core.watch_accounts();
            let warm = core.clone();
            std::thread::spawn(move || {
                if let Err(error) = warm.claude_info() {
                    eprintln!("claude info: {error}");
                }
            });
            std::thread::spawn(move || {
                for error in core.resume() {
                    eprintln!("resume: {error}");
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::create_job,
            commands::approve_plan,
            commands::set_agent_model,
            commands::merge_job,
            commands::merge_forecast,
            commands::resolve_conflicts,
            commands::job_changes,
            commands::job_commits,
            commands::job_overlaps,
            commands::clean_up_job,
            commands::send_message,
            commands::answer_permission,
            commands::interrupt_agent,
            commands::agents_idle,
            commands::list_jobs,
            commands::list_accounts,
            commands::refresh_accounts,
            commands::add_account,
            commands::remove_account,
            commands::rename_account,
            commands::set_default_account,
            commands::project_accounts,
            commands::set_project_account,
            commands::list_projects,
            commands::permission_log,
            commands::list_agents,
            commands::claude_info,
            commands::list_roles,
            commands::claude_stats,
            commands::claude_stats_snapshot,
            commands::list_customize,
            commands::measure_customize,
            commands::read_customize_item,
            commands::save_customize_item,
            commands::delete_customize_item,
            commands::session_tokens,
            commands::search_sessions,
            commands::agent_history,
            commands::context_usage,
            commands::job_links,
            commands::open_worktree,
            commands::permission_modes,
            commands::claude_permission_mode,
            commands::set_permission_mode,
            commands::settings_changed,
            commands::output_styles,
            commands::set_output_style,
            commands::mcp_status,
            commands::mcp_reconnect,
            commands::archive_job,
            commands::pin_job,
            commands::rename_job,
            commands::resume_command,
            commands::delete_job,
            commands::save_role,
            commands::reset_role,
            commands::list_tools,
            commands::list_skills,
            commands::set_skill_enabled,
            commands::list_kinds,
            commands::save_kind,
            commands::reset_kind,
            commands::save_attachment,
            commands::attach_path,
            tray::set_tray_status,
            voice::prepare_dictation,
            voice::transcribe,
        ])
        .run(tauri::generate_context!())
        .expect("error while running factory");
}

#[cfg(test)]
mod tests {
    #[test]
    fn crate_name_is_factory() {
        assert_eq!(env!("CARGO_PKG_NAME"), "factory");
    }
}
