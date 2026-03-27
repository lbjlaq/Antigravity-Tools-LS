use axum::{
    routing::{delete, get, post},
    Router,
};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::RwLock;
use std::collections::HashSet;
use tracing::{info, error};
use tower_http::cors::{Any, CorsLayer};
use ls_orchestrator::provider::LsProvider;

// 声明模块
pub mod constants;
pub mod state;
pub mod handlers;
pub mod logger;
pub mod key_manager;
pub mod traffic_db;
pub mod extractors;

use state::AppState;
use ls_orchestrator::native::NativeLsProvider;
use transcoder_core::transcoder::ProvisioningStrategy;
use handlers::{
    health_check,
    auth::{auth_login, oauth_callback, refresh_token_api, add_account_by_callback_url_api, add_account_by_callback_url_query_api, manual_import_account_api, manual_import_account_query_api},
    chat::{chat_completions, anthropic_messages, gemini_generate_content, openai_responses_api},
    probes,
    logs::fetch_memory_logs_api,
    keys::{list_keys_api, create_key_api, delete_key_api, rename_key_api},
    version::get_version_info_api,
    provision::{sync_assets_api, get_provision_status_api, detect_ide_api, select_path_api},
    settings::{get_settings_api, update_settings_api},
};

pub fn resolve_server_port(port: Option<u16>, app_settings: &crate::handlers::settings::AppSettings) -> u16 {
    port.unwrap_or_else(|| {
        std::env::var("PORT")
            .ok()
            .and_then(|p| p.parse::<u16>().ok())
            .filter(|p| *p > 0)
            .unwrap_or(app_settings.backend_port)
    })
}

pub async fn run_server(port: Option<u16>) -> anyhow::Result<()> {
    // 显式安装 Rustls 加密提供程序
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();

    let data_dir = transcoder_core::common::get_app_data_dir();
    let mem_logger = logger::init_logger(data_dir.join("logs"), 2000);
    
    println!("[SYSTEM] Antigravity Transcoder Bridge is starting...");
    println!("[SYSTEM] Data directory: {:?}", data_dir);
    let app_settings = crate::handlers::settings::AppSettings::load(&data_dir);
    let port = resolve_server_port(port, &app_settings);

    let account_manager = Arc::new(ls_accounts::AccountManager::new(data_dir.clone()).await?);
    
    let (sync_tx, _) = tokio::sync::broadcast::channel(16);
    let (account_tx, _) = tokio::sync::broadcast::channel(32);
    
    // 注入自定义路径环境变量 [NEW]
    if let Some(ref path) = app_settings.antigravity_executable {
        std::env::set_var("ANT_EXECUTABLE_PATH", path);
        info!("Custom Antigravity path injected: {}", path);
    }
    
    let shared_state = Arc::new(AppState { 
        provider: RwLock::new(None), 
        account_manager: account_manager.clone(),
        tls_cert: RwLock::new(None), 
        http_client: reqwest::Client::new(),
        port,
        auth_states: RwLock::new(HashSet::new()),
        mem_logger,
        key_manager: Arc::new(crate::key_manager::KeyManager::new(data_dir.clone()).await?),
        stats_mgr: Arc::new(transcoder_core::transcoder::StatsManager::new(data_dir.clone())?),
        traffic_mgr: Arc::new(crate::traffic_db::TrafficManager::new(data_dir.clone())?),
        app_settings: RwLock::new(app_settings),
        sync_tx: sync_tx.clone(),
        last_sync_event: RwLock::new(None),
        account_tx,
    });

    // --- 后台异步引导任务 ---
    {
        let state = shared_state.clone();
        let data_dir = data_dir.clone();
        tokio::spawn(async move {
            println!("[BOOT] Starting Smooth Startup background task...");
            // 1. 自动探测并持久化 Antigravity 路径 [NEW OPTIMIZATION]
            {
                let mut should_save = false;
                let mut detected_path = None;
                
                {
                    let settings = state.app_settings.read().await;
                    if settings.antigravity_executable.is_none() || settings.antigravity_executable.as_ref().map(|s| s.is_empty()).unwrap_or(false) {
                        let (path, args) = transcoder_core::ide::get_process_info_for_api();
                        if let Some(p) = path {
                            let p_str = p.to_string_lossy().to_string();
                            info!("[BOOT] Auto-detected Antigravity: {}", p_str);
                            detected_path = Some((p_str, args));
                            should_save = true;
                        }
                    }
                }

                if should_save {
                    if let Some((path, args)) = detected_path {
                        let mut settings = state.app_settings.write().await;
                        settings.antigravity_executable = Some(path.clone());
                        settings.antigravity_args = args.map(|a| a.iter().map(|s| s.to_string()).collect());
                        
                        // 注入环境变量
                        std::env::set_var("ANT_EXECUTABLE_PATH", &path);
                        
                        // 持久化到磁盘
                        if let Err(e) = settings.save(&data_dir) {
                            error!("[BOOT] Failed to persist auto-detected settings: {}", e);
                        } else {
                            info!("[BOOT] Auto-detected path persisted to app_settings.json");
                        }
                    }
                }
            }

            // 2. 资产校验与下载 (带进度上报)
            use crate::handlers::provision::SyncProgressEvent;
            let sync_tx = state.sync_tx.clone();
            let callback = move |percent, message: &str| {
                let stage = if percent == 100 { "completed" } else { "downloading" };
                let _ = sync_tx.send(SyncProgressEvent {
                    stage: stage.to_string(),
                    percent,
                    speed: "".to_string(),
                    message: message.to_string(),
                });
            };

            let assets = match transcoder_core::transcoder::AssetProvisioner::ensure_assets_with_progress(
                ProvisioningStrategy::Auto, 
                Box::new(callback)
            ).await {
                Ok(a) => a,
                Err(e) => {
                    error!("❌ 异步资产同步失败: {}", e);
                    return;
                }
            };
            info!("Assets verified: {}", assets.version);
            println!("[BOOT] Assets verified: {}", assets.version);

            // 2. 启动证书加载
            if let Ok(bytes) = std::fs::read(&assets.cert_pem_path) {
                *state.tls_cert.write().await = Some(bytes);
            }

            // 3. 启动反代网关
            let shared_project_id = Arc::new(tokio::sync::RwLock::new(crate::handlers::proxy::resolve_project_id(&state.account_manager).await));
            let proxy_port = match crate::handlers::proxy::start_inline_proxy(
                state.account_manager.clone(), 
                shared_project_id, 
                assets.version.clone()
            ).await {
                Ok(p) => p,
                Err(e) => {
                    error!("❌ 异步反代启动失败: {}", e);
                    return;
                }
            };
            let cloud_code_endpoint = format!("http://127.0.0.1:{}", proxy_port);

            // 4. 初始化 NativeLsProvider
            let config = transcoder_core::common::get_runtime_config();
            let provider = NativeLsProvider::new(
                data_dir,
                assets.ls_core_path.clone(),
                cloud_code_endpoint,
                ls_orchestrator::native::LsMetadataConfig {
                    ide_name: config.ide_name,
                    ide_version: assets.version.clone(),
                    extension_name: config.extension_name,
                    extension_version: assets.version.clone(),
                    extension_path: config.extension_path,
                    locale: config.locale,
                },
            );

            // 5. 将完成后的 Provider 注入全局状态
            *state.provider.write().await = Some(provider as Arc<dyn LsProvider>);
            info!("Core engine is hot-activated and ready");
            println!("[BOOT] Core engine is hot-activated and ready");
        });
    }

    // 启动额度自动刷新后台任务
    {
        let state_clone = shared_state.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;
                let (enabled, interval_m) = {
                    let cfg = state_clone.app_settings.read().await;
                    (cfg.auto_refresh_quota, cfg.auto_refresh_interval_minutes)
                };
                if !enabled { continue; }
                
                static LAST_REFRESH: std::sync::OnceLock<tokio::sync::Mutex<std::time::Instant>> = std::sync::OnceLock::new();
                let mutex = LAST_REFRESH.get_or_init(|| tokio::sync::Mutex::new(std::time::Instant::now()));
                let mut last = mutex.lock().await;
                if last.elapsed().as_secs() < interval_m * 60 { continue; }
                *last = std::time::Instant::now();
                drop(last);

                let summaries = state_clone.account_manager.list_accounts().await;
                for summary in summaries {
                    if summary.status != ls_accounts::AccountStatus::Active { continue; }
                    if let Ok(Some(account)) = state_clone.account_manager.get_account(&summary.id).await {
                        let rt = account.token.refresh_token.clone();
                        let s = state_clone.clone();
                        tokio::spawn(async move {
                            let _ = crate::handlers::probes::refresh_quota_internal(s, rt).await;
                        });
                    }
                }
            }
        });
    }

    let app = Router::new()
        .route("/v1/chat/completions", post(chat_completions))
        .route("/v1/models", get(probes::models_api))
        .route("/v1/responses", post(openai_responses_api))
        .route("/v1/messages", post(anthropic_messages))
        .route("/v1beta/models/:model", post(gemini_generate_content))
        .route("/v1/instances", get(handlers::instances::list_instances))
        .route("/v1/instances/:id", get(handlers::instances::get_instance).delete(handlers::instances::remove_instance))
        .route("/v1/instances/config", get(handlers::instances::get_config).patch(handlers::instances::update_config))
        .route("/health", get(handlers::health_check))
        .route("/v1/accounts", get(probes::list_accounts_api).post(handlers::account::reorder_accounts))
        .route("/v1/accounts/events", get(handlers::account_events::account_events_stream))
        .route("/v1/accounts/:id", get(handlers::account::get_account).delete(handlers::account::delete_account))
        .route("/v1/accounts/:id/label", post(handlers::account::update_account_label))
        .route("/v1/accounts/:id/proxy-status", post(handlers::account::update_proxy_status))
        .route("/v1/accounts/:id/switch", post(handlers::account::switch_account_to_ide))
        .route("/v1/accounts/import", post(manual_import_account_api).get(manual_import_account_query_api))
        .route("/v1/auth/callback_url", post(add_account_by_callback_url_api).get(add_account_by_callback_url_query_api))
        .route("/v1/auth/login", get(auth_login))
        .route("/oauth-callback", get(oauth_callback))
        .route("/v1/refresh_token", post(refresh_token_api))
        .route("/v1/quota", post(probes::quota_fetch_api))
        .route("/v1/monitor/logs", get(handlers::monitor::get_logs).delete(handlers::monitor::clear_logs))
        .route("/v1/monitor/stream", get(handlers::monitor::monitor_stream))
        .route("/v1/logs/stream", get(handlers::monitor::system_logs_stream))
        .route("/v1/stats/summary", get(handlers::stats::get_summary_stats_api))
        .route("/v1/stats/hourly", get(handlers::stats::get_hourly_stats_api))
        .route("/v1/stats/daily", get(handlers::stats::get_daily_stats_api))
        .route("/v1/stats/trends", get(handlers::stats::get_hourly_stats_api))
        .route("/v1/stats/models", get(handlers::stats::get_model_stats_api))
        .route("/v1/stats/accounts", get(handlers::stats::get_account_stats_api))
        .route("/v1/stats/model-trends", get(handlers::stats::get_model_trends_api))
        .route("/v1/stats/model-trends-daily", get(handlers::stats::get_model_trends_daily_api))
        .route("/v1/stats/metrics", get(handlers::stats::get_system_metrics_api))
        .route("/v1/code_assist", post(probes::code_assist_api))
        .route("/v1/logs", get(fetch_memory_logs_api).delete(handlers::logs::clear_memory_logs_api))
        .route("/v1/keys", get(list_keys_api).post(create_key_api))
        .route("/v1/keys/:key", delete(delete_key_api).patch(rename_key_api))
        .route("/v1/version", get(get_version_info_api))
        .route("/v1/version/check", get(handlers::version::check_dashboard_updates_api))
        .route("/v1/provision/sync", post(sync_assets_api))
        .route("/v1/provision/progress", get(handlers::provision::sync_progress_stream))
        .route("/v1/provision/status", get(get_provision_status_api))
        .route("/v1/provision/detect_ide", get(detect_ide_api))
        .route("/v1/provision/select_path", get(select_path_api))
        .route("/v1/settings", get(get_settings_api).put(update_settings_api))
        .fallback_service({
            let dist_path = std::env::var("ABV_DIST_PATH").unwrap_or_else(|_| "apps/web-dashboard/dist".to_string());
            tower_http::services::ServeDir::new(&dist_path)
                .fallback(tower_http::services::ServeFile::new(format!("{}/index.html", dist_path)))
        })
        .with_state(shared_state)
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any)
        )
        .layer(
            tower_http::trace::TraceLayer::new_for_http()
                .make_span_with(|_request: &axum::http::Request<_>| {
                    let request_id = uuid::Uuid::new_v4().to_string();
                    tracing::info_span!("request", request_id = %request_id)
                })
        );

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("Server started [Modularized]");
    info!("Listening on port: {}", port);
    println!("[SYSTEM] Server listening on port: {}", port);

    let listener = TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::handlers::settings::AppSettings;
    use crate::resolve_server_port;

    #[test]
    fn resolve_server_port_prefers_saved_settings_when_no_override_is_present() {
        let settings = AppSettings {
            backend_port: 5188,
            ..Default::default()
        };

        assert_eq!(resolve_server_port(None, &settings), 5188);
    }
}
