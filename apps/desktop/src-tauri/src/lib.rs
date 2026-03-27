use tauri::{Manager, State, menu::{Menu, MenuItem}, tray::TrayIconBuilder};

struct BackendConfig {
    port: u16,
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn get_backend_origin(config: State<'_, BackendConfig>) -> String {
    format!("http://127.0.0.1:{}", config.port)
}

#[tauri::command]
fn restart_app(app: tauri::AppHandle) {
    app.request_restart();
}

fn resolve_backend_port() -> u16 {
    let data_dir = transcoder_core::common::get_app_data_dir();
    let settings = cli_server::handlers::settings::AppSettings::load(&data_dir);
    cli_server::resolve_server_port(None, &settings)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let backend_port = resolve_backend_port();

    tauri::Builder::default()
        .manage(BackendConfig { port: backend_port })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = app.get_webview_window("main")
                .map(|window| {
                    #[cfg(target_os = "macos")]
                    app.set_activation_policy(tauri::ActivationPolicy::Regular).unwrap_or(());
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();

                    #[cfg(target_os = "macos")]
                    {
                        let icon_bytes = include_bytes!("../icons/128x128.png");
                        if let Ok(img) = tauri::image::Image::from_bytes(icon_bytes) {
                            let _ = window.set_icon(img);
                        }
                    }
                });
        }))
        .setup(move |app| {
            // --- 系统托盘架构 (System Tray) ---
            let icon_bytes = include_bytes!("../icons/32x32.png");
            let img = tauri::image::Image::from_bytes(icon_bytes)?;

            let quit_i = MenuItem::with_id(app, "quit", "退出 (Quit)", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "显示主窗口 (Show)", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .icon(img)
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            #[cfg(target_os = "macos")]
                            app.set_activation_policy(tauri::ActivationPolicy::Regular).unwrap_or(());
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();

                            #[cfg(target_os = "macos")]
                            {
                                let icon_bytes = include_bytes!("../icons/128x128.png");
                                if let Ok(img) = tauri::image::Image::from_bytes(icon_bytes) {
                                    let _ = window.set_icon(img);
                                }
                            }
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, .. } = event {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            #[cfg(target_os = "macos")]
                            app.set_activation_policy(tauri::ActivationPolicy::Regular).unwrap_or(());
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();

                            #[cfg(target_os = "macos")]
                            {
                                let icon_bytes = include_bytes!("../icons/128x128.png");
                                if let Ok(img) = tauri::image::Image::from_bytes(icon_bytes) {
                                    let _ = window.set_icon(img);
                                }
                            }
                        }
                    }
                })
                .build(app)?;

            // --- 后端服务初始化 (Axum Server) ---
            tauri::async_runtime::spawn(async move {
                tracing::info!("Starting bundled Axum server from Tauri on port {}...", backend_port);
                if let Err(e) = cli_server::run_server(Some(backend_port)).await {
                    tracing::error!("Failed to start Axum server: {}", e);
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // 拦截关闭按钮，改为隐藏至后台（托盘）
                let _ = window.hide();
                #[cfg(target_os = "macos")]
                window.app_handle().set_activation_policy(tauri::ActivationPolicy::Accessory).unwrap_or(());
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![greet, get_backend_origin, restart_app])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                if let Some(window) = app_handle.get_webview_window("main") {
                    app_handle.set_activation_policy(tauri::ActivationPolicy::Regular).unwrap_or(());
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();

                    let icon_bytes = include_bytes!("../icons/128x128.png");
                    if let Ok(img) = tauri::image::Image::from_bytes(icon_bytes) {
                        let _ = window.set_icon(img);
                    }
                }
            }
            let _ = (app_handle, event);
        });
}
