use axum::{
    extract::{State, Path},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use std::sync::Arc;
use crate::state::AppState;
use crate::handlers::extract_token;

#[derive(serde::Deserialize)]
struct GoogleQuotaResponse {
    models: std::collections::HashMap<String, GoogleModelInfo>,
    #[serde(rename = "deprecatedModelIds")]
    deprecated_model_ids: Option<std::collections::HashMap<String, GoogleDeprecatedModelInfo>>,
}

#[derive(serde::Deserialize)]
struct GoogleDeprecatedModelInfo {
    #[serde(rename = "newModelId")]
    new_model_id: String,
}

#[derive(serde::Deserialize)]
struct GoogleModelInfo {
    #[serde(rename = "quotaInfo")]
    quota_info: Option<GoogleQuotaInfo>,
    #[serde(rename = "displayName")]
    display_name: Option<String>,
    #[serde(rename = "supportsImages")]
    supports_images: Option<bool>,
    #[serde(rename = "supportsThinking")]
    supports_thinking: Option<bool>,
    #[serde(rename = "thinkingBudget")]
    thinking_budget: Option<i32>,
    #[serde(rename = "minThinkingBudget")]
    min_thinking_budget: Option<i32>,
    #[serde(rename = "tokenizerType")]
    tokenizer_type: Option<String>,
    #[serde(rename = "apiProvider")]
    api_provider: Option<String>,
    #[serde(rename = "modelProvider")]
    model_provider: Option<String>,
    #[serde(rename = "supportsVideo")]
    supports_video: Option<bool>,
    #[serde(rename = "tagTitle")]
    tag_title: Option<String>,
    #[serde(rename = "supportedMimeTypes")]
    supported_mime_types: Option<std::collections::HashMap<String, bool>>,
    recommended: Option<bool>,
    #[serde(rename = "maxTokens")]
    max_tokens: Option<i32>,
    #[serde(rename = "maxOutputTokens")]
    max_output_tokens: Option<i32>,
    model: Option<String>,
}

#[derive(serde::Deserialize)]
struct GoogleQuotaInfo {
    #[serde(rename = "remainingFraction")]
    remaining_fraction: Option<f64>,
    #[serde(rename = "resetTime")]
    reset_time: Option<String>,
}

pub async fn quota_fetch_api(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let token_or_key = match extract_token(&headers) {
        Some(t) => t,
        None => return (StatusCode::UNAUTHORIZED, "Missing token").into_response(),
    };

    // 🚀 [Phase 5 优化] 核心拦截器：完全阻断虚拟 Key 的对等网络探活
    if token_or_key.starts_with("sk-") {
        if !state.key_manager.is_valid(&token_or_key).await {
            return (StatusCode::UNAUTHORIZED, "Invalid API Key").into_response();
        }

        // 直接从本地账号池遍历，组装出“上帝视角”的最高可用额度给调用方
        let mut final_models: std::collections::HashMap<String, ls_accounts::ModelQuota> = std::collections::HashMap::new();
        let summaries = state.account_manager.list_accounts().await;
        
        for summary in summaries {
            if summary.status != ls_accounts::AccountStatus::Active {
                continue;
            }
            if let Ok(Some(account)) = state.account_manager.get_account(&summary.id).await {
                if let Some(quota) = account.quota {
                    for m in quota.models {
                        let entry = final_models.entry(m.name.clone()).or_insert_with(|| m.clone());
                        if m.percentage > entry.percentage {
                            *entry = m.clone();
                        }
                    }
                }
            }
        }
        
        let quota_data = ls_accounts::QuotaData {
            models: final_models.into_values().collect(),
            last_updated: chrono::Utc::now().timestamp(),
            is_forbidden: false,
            forbidden_reason: None,
            subscription_tier: None,
            model_forwarding_rules: std::collections::HashMap::new(),
            extra: std::collections::HashMap::new(),
        };

        tracing::info!("⚡ 拦截虚拟 Key 配额探活，耗时 < 1ms。已瞬间组装并返回本地 {} 个模型的最高可用额度，完全免除外部 API 通信", quota_data.models.len());
        
        return (StatusCode::OK, Json(quota_data)).into_response();
    }

    // ==========================================
    // 以下逻辑仅在客户端传入真实的 Refresh Token (如管理面板) 时触发
    // ==========================================

    let real_refresh_token = match crate::handlers::resolve_real_refresh_token(&state, &token_or_key).await {
        Ok(rt) => rt,
        Err(e) => return (StatusCode::UNAUTHORIZED, e.to_string()).into_response(),
    };

    match refresh_quota_internal(state, real_refresh_token).await {
        Ok(quota_data) => (StatusCode::OK, Json(quota_data)).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

/// 核心函数：执行配额拉取、Project ID 补全及持久化
pub async fn refresh_quota_internal(
    state: Arc<AppState>,
    real_refresh_token: String,
) -> anyhow::Result<ls_accounts::QuotaData> {
    // 1. 确保获取有效的 Access Token (处理 RT 到 AT 的转换)
    let access_token = match crate::handlers::resolve_access_token(&state, &real_refresh_token).await {
        Ok(at) => at,
        Err(e) => anyhow::bail!("Token resolution failed: {}", e),
    };

    // 2. 尝试获取 Project ID 和订阅类型 (通过 loadCodeAssist 动态解析)
    let mut project_id_opt = None;
    let mut subscription_tier = None;
    let account_id_opt = state.account_manager.find_account_id_by_token(&real_refresh_token).await;
    
    if let Some(ref account_id) = account_id_opt {
        if let Ok(Some(account)) = state.account_manager.get_account(account_id).await {
            project_id_opt = account.project_id;
        }
    }

    // 无论 project_id 是否存在，我们都请求一次 loadCodeAssist 以获取最新的订阅信息 (复刻 Manager 逻辑)
    tracing::info!("🔍 请求 v1internal:loadCodeAssist 以识别账号订阅等级与项目...");
    let load_url = "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:loadCodeAssist";
    if let Ok(load_resp) = crate::handlers::build_google_api_req(&state.http_client, reqwest::Method::POST, load_url, &access_token)
        .json(&serde_json::json!({"metadata": {"ideType": "ANTIGRAVITY"}}))
        .send().await {
        let status = load_resp.status();
        if let Ok(load_data) = load_resp.json::<serde_json::Value>().await {
            tracing::info!("🔍 loadCodeAssist 原始响应 (Status: {}): {:?}", status, load_data);
            #[derive(serde::Deserialize)]
            struct LoadProjectResponse {
                #[serde(rename = "cloudaicompanionProject")]
                project_id: Option<String>,
                #[serde(rename = "currentTier")]
                current_tier: Option<serde_json::Value>,
                #[serde(rename = "paidTier")]
                paid_tier: Option<serde_json::Value>,
                #[serde(rename = "allowedTiers")]
                allowed_tiers: Option<Vec<serde_json::Value>>,
                #[serde(rename = "ineligibleTiers")]
                ineligible_tiers: Option<Vec<serde_json::Value>>,
            }

            if let Ok(data) = serde_json::from_value::<LoadProjectResponse>(load_data) {
                // 1. 提取 Project ID
                if let Some(pid) = data.project_id {
                    project_id_opt = Some(pid);
                }

                // [NEW] 提取封禁详情
                let mut load_forbidden_reason = None;
                let mut load_appeal_url = None;
                if let Some(ref ineligible) = data.ineligible_tiers {
                    for tier in ineligible {
                        if let Some(msg) = tier.get("validationErrorMessage").or_else(|| tier.get("reasonMessage")).and_then(|v| v.as_str()) {
                            load_forbidden_reason = Some(msg.to_string());
                        }
                        if let Some(url) = tier.get("validationUrl").and_then(|v| v.as_str()) {
                            load_appeal_url = Some(url.to_string());
                        }
                    }
                }

                // 2. 提取订阅类型 (复刻 Manager 精准逻辑)
                let mut tier = data.paid_tier.as_ref().and_then(|t| t.get("name").or_else(|| t.get("id"))).and_then(|v| v.as_str()).map(|s| s.to_string());
                
                let is_ineligible = data.ineligible_tiers.as_ref().map_or(false, |v| !v.is_empty());

                if tier.is_none() {
                    if !is_ineligible {
                        tier = data.current_tier.as_ref().and_then(|t| t.get("name").or_else(|| t.get("id"))).and_then(|v| v.as_str()).map(|s| s.to_string());
                    } else if let Some(allowed) = data.allowed_tiers {
                        if let Some(default_tier) = allowed.iter().find(|t| t.get("isDefault") == Some(&serde_json::json!(true))) {
                            let name = default_tier.get("name").or_else(|| default_tier.get("id")).and_then(|v| v.as_str()).unwrap_or("FREE");
                            tier = Some(format!("{} (受限)", name));
                        }
                    }
                }

                // 3. 将 Google 内部名称映射为用户直观标签 (FREE/PRO/ULTRA)
                subscription_tier = tier.map(|s| {
                    let cleaned = s.to_lowercase();
                    if cleaned.contains("google_one_ai_premium") || cleaned.contains("premium") || cleaned == "pro" {
                        if s.contains("(受限)") { "PRO (受限)".to_string() } else { "PRO".to_string() }
                    } else if cleaned.contains("ultra") || cleaned.contains("enterprise") {
                        if s.contains("(受限)") { "ULTRA (受限)".to_string() } else { "ULTRA".to_string() }
                    } else if cleaned.contains("antigravity") || cleaned.contains("standard") || cleaned.contains("free") {
                        if s.contains("(受限)") { "FREE (受限)".to_string() } else { "FREE".to_string() }
                    } else {
                        s.to_uppercase()
                    }
                });
                
                if let Some(ref t) = subscription_tier {
                    tracing::info!("🎯 成功识别订阅等级: {}", t);
                    if t.contains("(受限)") {
                        if let Some(ref aid) = account_id_opt {
                            tracing::warn!("⚠️ 账号 {} 订阅等级受限，自动切换至禁用（绕过）状态: {:?}", aid, load_forbidden_reason);
                            let _ = state.account_manager.update_proxy_disabled(aid, true).await;
                            let _ = state.account_tx.send("forbidden".to_string());
                            
                            // 🚀 核心修复：如果是受限模式，立即将详细原因持久化，防止前端显示“无”
                            if let Some(reason) = load_forbidden_reason {
                                let _ = state.account_manager.mark_account_as_forbidden(aid, &reason, load_appeal_url).await;
                            }
                        }
                    }
                } else {
                    tracing::warn!("⚠️ loadCodeAssist 响应中未包含有效订阅等级信息");
                }
            } else {
                tracing::warn!("⚠️ 无法将 loadCodeAssist 响应解析为 LoadProjectResponse 结构");
            }
        } else {
            tracing::warn!("⚠️ 无法将 loadCodeAssist 响应解析为 JSON");
        }
    } else {
        tracing::error!("❌ 请求 loadCodeAssist 失败 (网络或超时)");
    }
    
    // [NEW] 如果动态解析仍缺失 Project ID，应用强型兜底 ID
    if project_id_opt.is_none() {
        let fallback_pid = "bamboo-precept-lgxtn".to_string();
        project_id_opt = Some(fallback_pid);
    }

    if let (Some(ref pid), Some(ref aid)) = (&project_id_opt, &account_id_opt) {
        let _ = state.account_manager.update_project_id(aid, pid.clone()).await;
    }

    let project_id = project_id_opt.unwrap_or_else(|| "bamboo-precept-lgxtn".to_string());
    if let Some(ref tier) = subscription_tier {
        tracing::info!("✅ 账号特性识别成功: 项目={:?}, 订阅={}", project_id, tier);
    }


    // 3. 使用 Access Token 真正请求 Google 接口
    let target_url = format!("{}/v1internal:fetchAvailableModels", crate::constants::PROXY_UPSTREAM_HOST);
    let resp = crate::handlers::build_google_api_req(&state.http_client, reqwest::Method::POST, &target_url, &access_token)
        .json(&serde_json::json!({"project": project_id}))
        .send().await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let err_text = resp.text().await.unwrap_or_default();
        
        // [NEW] 处理 403 Forbidden - 识别为被禁账号并提取申诉链接
        if status == reqwest::StatusCode::FORBIDDEN {
            tracing::warn!("🚫 账号因违反 Terms of Service 被 Google 禁用 (403)");
            
            let mut appeal_url = None;
            if let Ok(err_val) = serde_json::from_str::<serde_json::Value>(&err_text) {
                if let Some(details) = err_val.get("error").and_then(|e| e.get("details")).and_then(|d| d.as_array()) {
                    for detail in details {
                        if let Some(metadata) = detail.get("metadata") {
                            if let Some(url) = metadata.get("appeal_url").and_then(|v| v.as_str()) {
                                appeal_url = Some(url.to_string());
                            }
                        }
                    }
                }
            }

            let quota_data = ls_accounts::QuotaData {
                models: vec![],
                last_updated: chrono::Utc::now().timestamp(),
                is_forbidden: true,
                forbidden_reason: Some(format!("BANNED: {}", err_text)),
                subscription_tier: subscription_tier.or(Some("403".to_string())),
                model_forwarding_rules: std::collections::HashMap::new(),
                extra: if let Some(url) = appeal_url.clone() {
                    let mut m = std::collections::HashMap::new();
                    m.insert("appeal_url".to_string(), serde_json::Value::String(url));
                    m
                } else {
                    std::collections::HashMap::new()
                },
            };

            // [FIX] 被封禁状态也要持久化，否则前台刷新会丢失状态
            if let Some(account_id) = account_id_opt {
                let _ = state.account_manager.mark_account_as_forbidden(&account_id, &err_text, appeal_url).await;
                let _ = state.account_tx.send("forbidden".to_string());
                tracing::info!("✅ 已成功持久化封禁状态并自动禁用账号 {}", account_id);
            }

            return Ok(quota_data);
        }
        
        anyhow::bail!("Google API Error ({}): {}", status, err_text);
    }

    let raw_json: serde_json::Value = resp.json().await?;
    if let Some(obj) = raw_json.as_object() {
        let keys: Vec<_> = obj.keys().collect();
        tracing::info!("🔍 Google API 原始响应顶级字段: {:?}", keys);
    }

    let google_resp: GoogleQuotaResponse = serde_json::from_value(raw_json.clone())?;
    tracing::info!("🔍 解析成功，共捕获 {} 个模型。正在检查过滤逻辑...", google_resp.models.len());

    let mut models = Vec::new();
    for (name, info) in google_resp.models {
        let (percentage, reset_time) = if let Some(qi) = info.quota_info {
            (
                (qi.remaining_fraction.unwrap_or(0.0) * 100.0) as i32,
                qi.reset_time.unwrap_or_default(),
            )
        } else {
            // 如果没有配额信息，默认为 100% 可用
            (100, "".to_string())
        };

        models.push(ls_accounts::ModelQuota {
            name,
            percentage,
            reset_time,
            display_name: info.display_name,
            supports_images: info.supports_images,
            supports_thinking: info.supports_thinking,
            thinking_budget: info.thinking_budget,
            min_thinking_budget: info.min_thinking_budget,
            tokenizer_type: info.tokenizer_type,
            api_provider: info.api_provider,
            model_provider: info.model_provider,
            supports_video: info.supports_video,
            tag_title: info.tag_title,
            supported_mime_types: info.supported_mime_types,
            recommended: info.recommended,
            max_tokens: info.max_tokens,
            max_output_tokens: info.max_output_tokens,
            internal_model: info.model,
        });
    }

    let mut model_forwarding_rules = std::collections::HashMap::new();
    if let Some(deprecated) = google_resp.deprecated_model_ids {
        for (old_id, info) in deprecated {
            model_forwarding_rules.insert(old_id, info.new_model_id);
        }
    }

    // [NEW] 捕获所有其它顶级字段以便全量返回
    let mut extra = std::collections::HashMap::new();
    if let Some(obj) = raw_json.as_object() {
        for (k, v) in obj {
            // 排除掉已经显式处理过的核心字段
            if k != "models" && k != "deprecatedModelIds" {
                extra.insert(k.clone(), v.clone());
            }
        }
    }

    let quota_data = ls_accounts::QuotaData {
        models,
        last_updated: chrono::Utc::now().timestamp(),
        is_forbidden: false,
        forbidden_reason: None,
        subscription_tier, 
        model_forwarding_rules,
        extra,
    };

    // 持久化到账号库
    if let Some(account_id) = account_id_opt {
        if let Err(e) = state.account_manager.update_quota(&account_id, quota_data.clone()).await {
            tracing::error!("❌ 持久化额度失败 (账号: {}): {}", account_id, e);
        } else {
            tracing::info!("✅ 已成功更新并持久化账号 {} 的额度信息", account_id);
            // 🚀 发送变更通知给 SSE (用于实时刷新 UI)
            let _ = state.account_tx.send("refreshed".to_string());
        }
    }

    Ok(quota_data)
}

pub async fn code_assist_api(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let token_or_key = match extract_token(&headers) {
        Some(t) => t,
        None => return (StatusCode::UNAUTHORIZED, "Missing token").into_response(),
    };

    // 1. 解析真实身份 (支持虚拟 Key)
    let real_refresh_token = match crate::handlers::resolve_real_refresh_token(&state, &token_or_key).await {
        Ok(rt) => rt,
        Err(e) => return (StatusCode::UNAUTHORIZED, e.to_string()).into_response(),
    };

    // 2. 确保获取有效的 Access Token (处理 RT 到 AT 的转换)
    let access_token = match crate::handlers::resolve_access_token(&state, &real_refresh_token).await {
        Ok(at) => at,
        Err(e) => return (StatusCode::UNAUTHORIZED, e.to_string()).into_response(),
    };

    let target_url = format!("{}/v1internal:loadCodeAssist?alt=json", crate::constants::PROXY_UPSTREAM_HOST);
    match crate::handlers::build_google_api_req(&state.http_client, reqwest::Method::POST, &target_url, &access_token)
        .json(&serde_json::json!({"mode": 1}))
        .send().await {
        Ok(resp) => {
            let status = resp.status();
            let data: serde_json::Value = resp.json().await.unwrap_or_default();
            (status, Json(data)).into_response()
        },
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

pub async fn list_accounts_api(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let summaries = state.account_manager.list_accounts().await;
    let mut detailed_accounts = Vec::new();

    for summary in summaries {
        if let Ok(Some(account)) = state.account_manager.get_account(&summary.id).await {
            tracing::debug!("DEBUG: Account {} quota is_some: {}", account.email, account.quota.is_some());
            
            let quota_percentage = account.quota.as_ref().map(|q| {
                if q.models.is_empty() { return 0; }
                let sum: i32 = q.models.iter().map(|m| m.percentage).sum();
                sum / q.models.len() as i32
            }).unwrap_or(0);

            detailed_accounts.push(serde_json::json!({
                "id": account.id,
                "email": account.email,
                "status": account.status,
                "project_id": account.project_id,
                "label": account.label,
                "quota_percentage": quota_percentage,
                "refresh_token": account.token.refresh_token,
                "last_used": account.last_used,
                "quota": account.quota,
                "is_proxy_disabled": account.is_proxy_disabled,
            }));
        }
    }

    Json(detailed_accounts)
}

pub async fn remove_account_api(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    tracing::info!("🗑️ 收到删除请求，目标 ID: {}", id);
    match state.account_manager.remove_account(&id).await {
        Ok(true) => (StatusCode::OK, "账号已删除").into_response(),
        Ok(false) => {
            tracing::warn!("⚠️ 删除失败：ID {} 不存在", id);
            (StatusCode::NOT_FOUND, "账号不存在").into_response()
        },
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, format!("删除失败: {}", e)).into_response(),
    }
}

#[derive(serde::Serialize)]
pub struct OpenAiModelList {
    pub object: String,
    pub data: Vec<OpenAiModel>,
}

#[derive(serde::Serialize)]
pub struct OpenAiModel {
    pub id: String,
    pub object: String,
    pub created: i64,
    pub owned_by: String,
}

const DOCUMENTED_MODEL_IDS: &[&str] = &[
    "gemini-3.1-pro-high",
    "gemini-3.1-pro-low",
    "gemini-3-flash-agent",
    "claude-sonnet-4-6",
    "claude-opus-4-6-thinking",
    "gpt-oss-120b-medium",
];

pub async fn models_api(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let mut model_names = std::collections::HashSet::new();
    let summaries = state.account_manager.list_accounts().await;
    
    for summary in summaries {
        if summary.status != ls_accounts::AccountStatus::Active {
            continue;
        }
        
        if let Ok(Some(account)) = state.account_manager.get_account(&summary.id).await {
            if let Some(quota) = account.quota {
                for m in quota.models {
                    if !m.name.trim().is_empty() {
                        model_names.insert(m.name);
                    }
                }
            }
        }
    }

    if model_names.is_empty() {
        for model_id in DOCUMENTED_MODEL_IDS {
            model_names.insert((*model_id).to_string());
        }
    }

    let mut data: Vec<OpenAiModel> = model_names
        .into_iter()
        .map(|name| OpenAiModel {
            id: name,
            object: "model".to_string(),
            created: chrono::Utc::now().timestamp(),
            owned_by: "system".to_string(),
        })
        .collect();

    // 为了输出稳定，进行名称排序
    data.sort_by(|a, b| a.id.cmp(&b.id));

    axum::Json(OpenAiModelList {
        object: "list".to_string(),
        data,
    })
}

#[derive(serde::Deserialize)]
pub struct UpdateLabelReq {
    pub label: Option<String>,
}

pub async fn update_account_label_api(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateLabelReq>,
) -> impl IntoResponse {
    match state.account_manager.update_label(&id, payload.label).await {
        Ok(_) => (StatusCode::OK, "Label updated").into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to update label: {}", e)).into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        handlers::{provision::SyncProgressEvent, settings::AppSettings},
        key_manager::KeyManager,
        logger::MemoryLogRing,
        state::AppState,
        traffic_db::TrafficManager,
    };
    use axum::{body::to_bytes, response::IntoResponse};
    use ls_accounts::{Account, AccountStatus, OAuthToken, QuotaData};
    use std::{
        collections::{HashMap, HashSet},
        sync::Arc,
    };
    use tokio::sync::RwLock;
    use transcoder_core::transcoder::StatsManager;

    fn make_model(name: &str, percentage: i32) -> ls_accounts::ModelQuota {
        ls_accounts::ModelQuota {
            name: name.to_string(),
            percentage,
            reset_time: String::new(),
            display_name: None,
            supports_images: None,
            supports_thinking: None,
            thinking_budget: None,
            recommended: None,
            max_tokens: None,
            max_output_tokens: None,
            min_thinking_budget: None,
            tokenizer_type: None,
            api_provider: None,
            model_provider: None,
            supports_video: None,
            tag_title: None,
            supported_mime_types: None,
            internal_model: None,
        }
    }

    async fn make_test_state() -> Arc<AppState> {
        let data_dir = std::env::temp_dir().join(format!(
            "antigravity-tools-ls-tests-{}",
            uuid::Uuid::new_v4()
        ));
        tokio::fs::create_dir_all(&data_dir).await.unwrap();

        let account_manager = Arc::new(ls_accounts::AccountManager::new(data_dir.clone()).await.unwrap());
        let key_manager = Arc::new(KeyManager::new(data_dir.clone()).await.unwrap());
        let stats_mgr = Arc::new(StatsManager::new(&data_dir).unwrap());
        let traffic_mgr = Arc::new(TrafficManager::new(&data_dir).unwrap());
        let (sync_tx, _) = tokio::sync::broadcast::channel(8);
        let (account_tx, _) = tokio::sync::broadcast::channel(8);

        Arc::new(AppState {
            provider: RwLock::new(None),
            account_manager,
            tls_cert: RwLock::new(None),
            http_client: reqwest::Client::new(),
            port: 5173,
            auth_states: RwLock::new(HashSet::new()),
            mem_logger: MemoryLogRing::new(32),
            key_manager,
            stats_mgr,
            traffic_mgr,
            app_settings: RwLock::new(AppSettings::default()),
            sync_tx,
            last_sync_event: RwLock::new(None::<SyncProgressEvent>),
            account_tx,
        })
    }

    async fn insert_account(
        state: &Arc<AppState>,
        email: &str,
        status: AccountStatus,
        models: Vec<ls_accounts::ModelQuota>,
    ) {
        let account = Account {
            id: format!("{:x}", md5::compute(email.as_bytes())),
            email: email.to_string(),
            name: None,
            token: OAuthToken {
                access_token: format!("access-{email}"),
                refresh_token: format!("refresh-{email}"),
                expires_in: 3600,
                token_type: "Bearer".to_string(),
                updated_at: chrono::Utc::now(),
            },
            status,
            disabled_reason: None,
            project_id: None,
            label: None,
            is_proxy_disabled: false,
            created_at: chrono::Utc::now().timestamp(),
            last_used: chrono::Utc::now().timestamp(),
            quota: Some(QuotaData {
                models,
                last_updated: chrono::Utc::now().timestamp(),
                is_forbidden: false,
                forbidden_reason: None,
                subscription_tier: None,
                model_forwarding_rules: HashMap::new(),
                extra: HashMap::new(),
            }),
            device_profile: None,
        };

        state.account_manager.upsert_account(account).await.unwrap();
    }

    async fn fetch_model_ids(state: Arc<AppState>) -> Vec<String> {
        let response = models_api(State(state)).await.into_response();
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();

        json["data"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item["id"].as_str().unwrap().to_string())
            .collect()
    }

    #[tokio::test]
    async fn models_api_keeps_zero_quota_models_visible() {
        let state = make_test_state().await;
        insert_account(
            &state,
            "active@example.com",
            AccountStatus::Active,
            vec![make_model("claude-sonnet-4-6", 0)],
        )
        .await;

        let ids = fetch_model_ids(state).await;

        assert!(
            ids.contains(&"claude-sonnet-4-6".to_string()),
            "expected exhausted models to stay discoverable, got {ids:?}"
        );
    }

    #[tokio::test]
    async fn models_api_returns_documented_models_without_accounts() {
        let ids = fetch_model_ids(make_test_state().await).await;

        for expected in [
            "gemini-3.1-pro-high",
            "gemini-3.1-pro-low",
            "gemini-3-flash-agent",
            "claude-sonnet-4-6",
            "claude-opus-4-6-thinking",
            "gpt-oss-120b-medium",
        ] {
            assert!(
                ids.contains(&expected.to_string()),
                "expected fallback model {expected} to be present, got {ids:?}"
            );
        }
    }
}
