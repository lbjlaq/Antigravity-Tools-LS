pub mod auth;
pub mod chat;
pub mod instances;
pub mod probes;
pub mod proxy;
pub mod logs;
pub mod keys;
pub mod stats;
pub mod version;
pub mod provision;
pub mod account;
pub mod monitor;
pub mod settings;
pub mod account_events;

use axum::response::IntoResponse;
use axum::http::StatusCode;
use axum::Json;
use serde::Serialize;
use tracing::info;

#[derive(Serialize)]
pub struct HealthResponse {
    pub status: String,
}

#[derive(Serialize)]
pub struct ErrorResponse {
    pub error: ErrorDetail,
}

#[derive(Serialize)]
pub struct ErrorDetail {
    pub message: String,
}

pub async fn health_check() -> impl IntoResponse {
    (StatusCode::OK, Json(HealthResponse { status: "ok".into() }))
}

pub fn extract_token(headers: &axum::http::HeaderMap) -> Option<String> {
    if let Some(token) = headers.get("x-refresh-token") {
        return token.to_str().ok().map(|s| s.to_string());
    }
    
    // 支持 Anthropic 特有的 x-api-key
    if let Some(token) = headers.get("x-api-key") {
        return token.to_str().ok().map(|s| s.to_string());
    }

    // 兼容 Gemini SDK / Gemini CLI 使用的原生头
    if let Some(token) = headers.get("x-goog-api-key") {
        return token.to_str().ok().map(|s| s.to_string());
    }
    
    if let Some(auth) = headers.get("authorization") {
        let auth_str = auth.to_str().ok()?;
        if auth_str.starts_with("Bearer ") {
            return Some(auth_str["Bearer ".len()..].to_string());
        }
    }
    None
}

pub fn extract_slot_id(headers: &axum::http::HeaderMap) -> Option<String> {
    headers.get("x-instance-id")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
}

/// 辅助函数：将用户传入的凭据（可能是虚拟 Key、真实的 RT 或 AT）解析为真实的 Refresh Token
/// 如果是虚拟 Key，则自动轮转选择一个可用账号。
pub async fn resolve_real_refresh_token(
    state: &std::sync::Arc<crate::state::AppState>,
    token_or_key: &str,
) -> anyhow::Result<String> {
    // 1. 校验是否为系统派发的虚拟 API Key
    if state.key_manager.is_valid(token_or_key).await {
        // 尝试获取一个最佳可用账号
        if let Ok(Some(account)) = state.account_manager.get_best_account().await {
            return Ok(account.token.refresh_token);
        }
        anyhow::bail!("当前无可用的受监管 Google 账号，请检查账号状态");
    }

    // 2. 否则视为直连模式，直接返回
    Ok(token_or_key.to_string())
}

/// 辅助函数：确保获取到一个有效的 Access Token
/// 逻辑：如果是 AT 则直接返回；如果是 RT 则优先查缓存，缓存失效则调用 Google 刷新。
pub async fn resolve_access_token(
    state: &std::sync::Arc<crate::state::AppState>,
    real_token: &str,
) -> anyhow::Result<String> {
    // 1. 如果本身就是 access_token (ya29.)
    if real_token.starts_with("ya29.") {
        return Ok(real_token.to_string());
    }

    // 2. 尝试从账号库缓存中查找并进行预校验
    let summaries = state.account_manager.list_accounts().await;
    let mut target_account = None;

    for summary in summaries {
        if let Ok(Some(account)) = state.account_manager.get_account(&summary.id).await {
            if account.token.refresh_token == real_token {
                // 增加过期校验：预留 5 分钟 Buffer
                let now = chrono::Utc::now();
                let expiry_limit = account.token.updated_at + chrono::Duration::seconds(account.token.expires_in as i64 - 300);
                
                if now < expiry_limit && account.token.access_token.starts_with("ya29.") {
                    return Ok(account.token.access_token);
                }
                
                target_account = Some(account);
                break;
            }
        }
    }

    // 3. 进入刷新环节，必须获取针对该 RT 的互斥锁，防止并发冲突导致 invalid_grant
    let lock_arc = state.account_manager.get_refresh_lock(real_token).await;
    let _refresh_lock = lock_arc.lock().await;

    // 获取锁后，二次检查账户状态（可能其它线程刚刚刷新完并写入了磁盘/内存）
    if let Some(ref acc) = target_account {
        if let Ok(Some(account)) = state.account_manager.get_account(&acc.id).await {
             let now = chrono::Utc::now();
             let expiry_limit = account.token.updated_at + chrono::Duration::seconds(account.token.expires_in as i64 - 300);
             if now < expiry_limit && account.token.access_token.starts_with("ya29.") {
                info!("🔓 [Lock-Double-Check] Token 已由其它线程刷新成功，直接复用: {}", account.email);
                return Ok(account.token.access_token);
             }
        }
    }

    // 4. 执行真实刷新
    match crate::handlers::auth::get_access_token_full(state, real_token).await {
        Some(new_token_data) => {
            // 如果有关联账号，同步更新磁盘存档
            if let Some(mut account) = target_account {
                account.token = new_token_data.clone();
                let _ = state.account_manager.upsert_account(account).await;
            }
            Ok(new_token_data.access_token)
        }
        None => {
            // 最后退化尝试：如果上面 get_account 没对上，但这是个直接传入的 RT，也试着全局搜一下
            anyhow::bail!("无法刷新 OAuth Token，请检查 Refresh Token 权限或网络");
        }
    }
}

/// 辅助函数：构造带有统一 User-Agent 和 Access Token 的 Google API 请求
pub fn build_google_api_req(
    client: &reqwest::Client,
    method: reqwest::Method,
    url: &str,
    access_token: &str,
) -> reqwest::RequestBuilder {
    client.request(method, url)
        .header("Authorization", format!("Bearer {}", access_token))
        .header("User-Agent", crate::constants::DEFAULT_USER_AGENT)
}
