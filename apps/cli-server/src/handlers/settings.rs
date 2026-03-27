use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use crate::state::AppState;

/// 全局应用配置结构体，持久化至 data/app_settings.json
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppSettings {
    /// 后端服务监听端口
    pub backend_port: u16,
    /// 是否开启账号额度自动刷新
    pub auto_refresh_quota: bool,
    /// 额度自动刷新间隔 (分钟)
    pub auto_refresh_interval_minutes: u64,
    /// 流量日志保留天数，有效值：7 / 14 / 30 / 90
    pub traffic_log_retention_days: u32,
    /// 是否开启系统资产自动检查并同步 (ls_core, cert.pem)
    pub auto_sync_assets: bool,
    /// 系统资产自动检查间隔 (分钟)
    pub auto_sync_interval_minutes: u64,
    /// 自定义 Antigravity 可执行文件路径
    pub antigravity_executable: Option<String>,
    /// 自定义 Antigravity 启动参数 [NEW]
    pub antigravity_args: Option<Vec<String>>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            backend_port: 5173,
            auto_refresh_quota: false,
            auto_refresh_interval_minutes: 360, // 6h
            traffic_log_retention_days: 30,
            auto_sync_assets: true,
            auto_sync_interval_minutes: 1440, // 24h
            antigravity_executable: None,
            antigravity_args: None,
        }
    }
}

impl AppSettings {
    /// 从 data/app_settings.json 加载，文件不存在则返回默认值
    pub fn load(data_dir: &std::path::Path) -> Self {
        let path = data_dir.join("app_settings.json");
        if let Ok(content) = std::fs::read_to_string(&path) {
            if let Ok(s) = serde_json::from_str::<AppSettings>(&content) {
                return s;
            }
        }
        Self::default()
    }

    /// 持久化到 data/app_settings.json
    pub fn save(&self, data_dir: &std::path::Path) -> anyhow::Result<()> {
        let path = data_dir.join("app_settings.json");
        let content = serde_json::to_string_pretty(self)?;
        std::fs::write(path, content)?;
        Ok(())
    }
}

/// GET /v1/settings — 返回当前全局配置
pub async fn get_settings_api(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let settings = state.app_settings.read().await.clone();
    (StatusCode::OK, Json(settings))
}

/// PUT /v1/settings — 更新全局配置并持久化
pub async fn update_settings_api(
    State(state): State<Arc<AppState>>,
    Json(new_settings): Json<AppSettings>,
) -> impl IntoResponse {
    if new_settings.backend_port == 0 {
        return (StatusCode::BAD_REQUEST, "backend_port 至少为 1").into_response();
    }

    // 校验参数合理性 (分钟数最低限制为 1)
    if new_settings.auto_refresh_interval_minutes < 1 {
        return (StatusCode::BAD_REQUEST, "auto_refresh_interval_minutes 至少为 1").into_response();
    }
    if new_settings.auto_sync_interval_minutes < 1 {
        return (StatusCode::BAD_REQUEST, "auto_sync_interval_minutes 至少为 1").into_response();
    }
    
    let valid_retention = [7u32, 14, 30, 90];
    if !valid_retention.contains(&new_settings.traffic_log_retention_days) {
        return (StatusCode::BAD_REQUEST, "traffic_log_retention_days 必须是 7/14/30/90 之一").into_response();
    }

    // 写入内存
    {
        let mut settings = state.app_settings.write().await;
        *settings = new_settings.clone();
    }

    // 同步更新环境变量 [NEW]
    if let Some(ref path) = new_settings.antigravity_executable {
        std::env::set_var("ANT_EXECUTABLE_PATH", path);
    } else {
        std::env::remove_var("ANT_EXECUTABLE_PATH");
    }
    std::env::set_var("PORT", new_settings.backend_port.to_string());

    // 持久化到磁盘
    let data_dir = transcoder_core::common::get_app_data_dir();
    if let Err(e) = new_settings.save(&data_dir) {
        tracing::error!("❌ 配置持久化失败: {}", e);
        return (StatusCode::INTERNAL_SERVER_ERROR, format!("持久化失败: {}", e)).into_response();
    }

    tracing::info!("⚙️ 全局配置已更新并持久化: {:?}", new_settings);
    (StatusCode::OK, "配置更新成功").into_response()
}

#[cfg(test)]
mod tests {
    use super::AppSettings;

    #[test]
    fn legacy_settings_payloads_fall_back_to_default_backend_port() {
        let settings: AppSettings = serde_json::from_str(
            r#"{
                "auto_refresh_quota": true,
                "auto_refresh_interval_minutes": 30,
                "traffic_log_retention_days": 14,
                "auto_sync_assets": false,
                "auto_sync_interval_minutes": 60
            }"#,
        )
        .expect("legacy settings json should still deserialize");

        assert_eq!(settings.backend_port, 5173);
    }
}
