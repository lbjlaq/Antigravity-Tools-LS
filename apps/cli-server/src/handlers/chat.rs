use axum::{
    extract::{State, Path},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response, Sse},
    Json,
};
use std::sync::Arc;
use crate::state::AppState;
use ls_orchestrator::provider::LsProvider;
use crate::handlers::{ErrorResponse, ErrorDetail,  extract_slot_id};
use transcoder_core::transcoder::{
    ProtocolMapper, handle_generic_stream,
    OpenAiMapper, AnthropicMapper, GeminiMapper,
    TrafficLog, StreamMetadata
};
use crate::extractors::AuthContext;

// 结合鉴权与智能挑号：如果凭据是系统派发的 API Key，则从池中拿有效号码。如果直接提供真实 Token，则回退为直连模式。
pub async fn route_and_resolve(
    state: &Arc<AppState>,
    token_or_key: &str,
    model_name: &str,
) -> Result<(String, Option<String>, i32, String), String> {
    let summaries = state.account_manager.list_accounts().await;
    let mut target_model_name = model_name.to_string();

    let is_virtual_key = state.key_manager.is_valid(token_or_key).await;

    for summary in summaries {
        if (summary.status != ls_accounts::AccountStatus::Active || summary.is_proxy_disabled) && is_virtual_key {
            continue; 
        }
        
        match state.account_manager.get_account(&summary.id).await {
            Ok(Some(account)) => {
                let is_direct_match = !is_virtual_key && (account.token.refresh_token == token_or_key || account.token.access_token == token_or_key);
                
                if is_virtual_key || is_direct_match {
                    if let Some(quota) = account.quota {
                        // 1. 处理动态别名转发
                        if let Some(new_name) = quota.model_forwarding_rules.get(&target_model_name) {
                            target_model_name = new_name.clone();
                        }
    
                        // 2. 匹配真实的 protobuf `internal_model` 和配额存量
                        for m in quota.models {
                            if m.name == target_model_name {
                                if m.percentage <= 0 && is_virtual_key {
                                    continue; 
                                }
                                if let Some(internal) = m.internal_model.as_ref() {
                                    let resolved_id = transcoder_core::transcoder::parse_model_enum_string(internal);
                                    return Ok((account.token.refresh_token.clone(), Some(account.id.clone()), resolved_id, account.email.clone()));
                                }
                            }
                        }
                    }
                }
            },
            _ => {}
        }
    }

    if !is_virtual_key {
        let fallback_id = transcoder_core::transcoder::parse_model_enum_string(model_name);
        return Ok((token_or_key.to_string(), None, fallback_id, "Direct Access".to_string()));
    }

    Err(format!("无法为您分配可用的账号，所有账号的 [{}] 额度可能已耗尽或未被授权", target_model_name))
}

async fn handle_protocol_generic<M: ProtocolMapper>(
    state: &Arc<AppState>,
    auth: AuthContext,
    slot_id: Option<String>,
    payload: M::Request,
) -> Response {
    let start_time = std::time::Instant::now();
    let trace_id = format!("tr-{}", uuid::Uuid::new_v4().to_string().replace("-", ""));
    let model_name = M::get_model(&payload).to_string();
    let protocol = M::get_protocol();
    
    let (real_refresh_token, account_id, resolved_model_id, email) = match route_and_resolve(state, &auth.token_or_key, &model_name).await {
        Ok(res) => res,
        Err(e) => {
            // 记录失败的路由尝试（可选，目前直接返回）
            return (StatusCode::SERVICE_UNAVAILABLE, Json(ErrorResponse { error: ErrorDetail { message: e } })).into_response();
        }
    };

    let target_slot_id = slot_id.or(account_id.clone());

    let access_token = match crate::handlers::resolve_access_token(state, &real_refresh_token).await {
        Ok(at) => at,
        Err(e) => return (StatusCode::UNAUTHORIZED, Json(ErrorResponse { error: ErrorDetail { message: format!("Token 刷新失败: {}", e) } })).into_response(),
    };

    // 尝试获取 Core Provider
    let provider_guard = state.provider.read().await;
    let provider = match provider_guard.as_ref() {
        Some(p) => p.clone(),
        None => return (StatusCode::SERVICE_UNAVAILABLE, Json(ErrorResponse { error: ErrorDetail { message: "核心内核正在后台引导中，请稍候片刻...".to_string() } })).into_response(),
    };
    drop(provider_guard);

    let instance = match provider.acquire_instance(&email, &real_refresh_token, target_slot_id.as_deref()).await {
        Ok(inst) => inst,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: ErrorDetail { message: format!("LS拉起失败: {}", e) } })).into_response(),
    };

    let tls_cert = state.tls_cert.read().await.clone().unwrap_or_default();

    let conn_info = transcoder_core::transcoder::LsConnectionInfo {
        grpc_addr: instance.grpc_addr().to_string(),
        csrf_token: instance.csrf_token(),
        access_token,
        tls_cert,
        resolved_model_id,
        account_email: Some(email.clone()),
        error_fetcher: Some(instance.clone()),
    };

    let (meta_tx, meta_rx) = tokio::sync::oneshot::channel();
    let mut rx = match handle_generic_stream::<M>(payload, conn_info, Some(state.stats_mgr.clone()), Some(meta_tx)).await {
        Ok(r) => r,
        Err(e) => {
            let err_msg = e.to_string();
            let status_code = if err_msg.contains("PERMISSION_DENIED") || err_msg.contains("Verify your account") {
                StatusCode::FORBIDDEN
            } else {
                StatusCode::INTERNAL_SERVER_ERROR
            };

            // 🚀 触发熔断：如果是 403 错误，自动禁用该账号
            if status_code == StatusCode::FORBIDDEN {
                if let Some(ref aid) = account_id {
                    let _ = state.account_manager.mark_account_as_forbidden(aid, &err_msg, None).await;
                    let _ = state.account_tx.send("forbidden".to_string());
                }
            }

            // 🚀 记录流量日志 (修复：早期退出也要记录，以便诊断中心看到 403)
            let duration = start_time.elapsed().as_millis() as u64;
            let log = transcoder_core::transcoder::TrafficLog {
                id: trace_id.clone(),
                timestamp: chrono::Utc::now().timestamp_millis(),
                method: "POST".into(),
                url: "/v1/chat/completions".into(),
                status: status_code.as_u16(),
                duration,
                model: Some(model_name.clone()),
                mapped_model: Some(format!("{}", resolved_model_id)),
                account_email: Some(email.clone()),
                client_ip: Some("127.0.0.1".into()),
                error: Some(err_msg.clone()),
                input_tokens: Some(0),
                output_tokens: Some(0),
                protocol: protocol.clone(),
            };
            let _ = state.traffic_mgr.record_log(log);

            return (status_code, Json(ErrorResponse { error: ErrorDetail { message: err_msg } })).into_response();
        }
    };

    let traffic_mgr = state.traffic_mgr.clone();
    let mapped_model = format!("{}", resolved_model_id);
    let client_ip = "127.0.0.1".to_string(); // TODO: 从 Axum 提取真实 IP

    let stream = async_stream::stream! {
        let _keep_alive = instance;
        while let Some(chunk) = rx.recv().await {
            let mut event = axum::response::sse::Event::default().data(chunk.data);
            if let Some(e) = chunk.event {
                event = event.event(e);
            }
            yield Ok::<axum::response::sse::Event, std::convert::Infallible>(event);
        }

        // 流结束后的扫尾：记录流量日志
        let duration = start_time.elapsed().as_millis() as u64;
        let meta = meta_rx.await.unwrap_or_default();
        
        let log = transcoder_core::transcoder::TrafficLog {
            id: trace_id,
            timestamp: chrono::Utc::now().timestamp_millis(),
            method: "POST".into(),
            url: "/v1/chat/completions".into(), // 可根据 protocol 细化
            status: if meta.error.is_none() { 200 } else { 500 },
            duration,
            model: Some(model_name),
            mapped_model: Some(mapped_model),
            account_email: Some(email),
            client_ip: Some(client_ip),
            error: meta.error,
            input_tokens: Some(meta.input_tokens),
            output_tokens: Some(meta.output_tokens),
            protocol,
        };

        if let Err(e) = traffic_mgr.record_log(log) {
            tracing::error!("❌ [Monitor] 记录流量日志失败: {}", e);
        }
    };

    Sse::new(stream).keep_alive(axum::response::sse::KeepAlive::new()).into_response()
}

pub async fn chat_completions(
    State(state): State<Arc<AppState>>,
    auth: AuthContext,
    headers: HeaderMap,
    Json(payload): Json<transcoder_core::transcoder::OpenAIChatRequest>,
) -> Response {
    let slot_id = extract_slot_id(&headers);
    handle_protocol_generic::<OpenAiMapper>(&state, auth, slot_id, payload).await
}

pub async fn openai_responses_api(
    State(state): State<Arc<AppState>>,
    auth: AuthContext,
    headers: HeaderMap,
    Json(payload): Json<transcoder_core::transcoder::OpenAIChatRequest>,
) -> Response {
    let slot_id = extract_slot_id(&headers);
    handle_protocol_generic::<OpenAiMapper>(&state, auth, slot_id, payload).await
}

pub async fn anthropic_messages(
    State(state): State<Arc<AppState>>,
    auth: AuthContext,
    headers: HeaderMap,
    Json(payload): Json<transcoder_core::transcoder::AnthropicMessageRequest>,
) -> Response {
    let is_stream = payload.stream;
    let slot_id = extract_slot_id(&headers);
    let model_name_str = payload.model.clone();
    
    // 如果是流式请求，直接走泛型流程
    if is_stream {
        return handle_protocol_generic::<AnthropicMapper>(&state, auth, slot_id, payload).await;
    }

    let start_time = std::time::Instant::now();
    let trace_id = format!("tr-{}", uuid::Uuid::new_v4().to_string().replace("-", ""));

    // 非流式请求：由于目前通用引擎仅支持流式，对于非流式我们在此进行简单的聚合缓冲
    let (real_refresh_token, account_id, resolved_model_id, email) = match route_and_resolve(&state, &auth.token_or_key, &model_name_str).await {
        Ok(res) => res,
        Err(e) => return (StatusCode::SERVICE_UNAVAILABLE, Json(ErrorResponse { error: ErrorDetail { message: e } })).into_response(),
    };

    let target_slot_id = slot_id.or(account_id.clone());

    let access_token = match crate::handlers::resolve_access_token(&state, &real_refresh_token).await {
        Ok(at) => at,
        Err(e) => return (StatusCode::UNAUTHORIZED, Json(ErrorResponse { error: ErrorDetail { message: format!("Token 刷新失败: {}", e) } })).into_response(),
    };

    // 尝试获取 Core Provider
    let provider_guard = state.provider.read().await;
    let provider = match provider_guard.as_ref() {
        Some(p) => p.clone(),
        None => return (StatusCode::SERVICE_UNAVAILABLE, Json(ErrorResponse { error: ErrorDetail { message: "核心内核正在后台引导中，请稍候片刻...".to_string() } })).into_response(),
    };
    drop(provider_guard);

    let instance = match provider.acquire_instance(&email, &real_refresh_token, target_slot_id.as_deref()).await {
        Ok(inst) => inst,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: ErrorDetail { message: e.to_string() } })).into_response(),
    };

    let tls_cert = state.tls_cert.read().await.clone().unwrap_or_default();

    let conn_info = transcoder_core::transcoder::LsConnectionInfo {
        grpc_addr: instance.grpc_addr().to_string(),
        csrf_token: instance.csrf_token(),
        access_token,
        tls_cert,
        resolved_model_id,
        account_email: Some(email.clone()),
        error_fetcher: Some(instance.clone()),
    };

    let (meta_tx, meta_rx) = tokio::sync::oneshot::channel();
    let mut rx = match handle_generic_stream::<AnthropicMapper>(payload, conn_info, Some(state.stats_mgr.clone()), Some(meta_tx)).await {
        Ok(r) => r,
        Err(e) => {
            let err_msg = e.to_string();
            let status_code = if err_msg.contains("PERMISSION_DENIED") || err_msg.contains("Verify your account") {
                StatusCode::FORBIDDEN
            } else {
                StatusCode::INTERNAL_SERVER_ERROR
            };

            // 🚀 非流式分支触发熔断
            if status_code == StatusCode::FORBIDDEN {
                if let Some(ref aid) = account_id {
                    let _ = state.account_manager.mark_account_as_forbidden(aid, &err_msg, None).await;
                    let _ = state.account_tx.send("forbidden".to_string());
                }
            }

            // 🚀 记录流量日志 (非流式分支早期退出)
            let duration = start_time.elapsed().as_millis() as u64;
            let log = transcoder_core::transcoder::TrafficLog {
                id: trace_id,
                timestamp: chrono::Utc::now().timestamp_millis(),
                method: "POST".into(),
                url: "/v1/messages".into(),
                status: status_code.as_u16(),
                duration,
                model: Some(model_name_str),
                mapped_model: Some(format!("{}", resolved_model_id)),
                account_email: Some(email),
                client_ip: Some("127.0.0.1".into()),
                error: Some(err_msg.clone()),
                input_tokens: Some(0),
                output_tokens: Some(0),
                protocol: "anthropic".into(),
            };
            let _ = state.traffic_mgr.record_log(log);

            return (status_code, Json(ErrorResponse { error: ErrorDetail { message: err_msg } })).into_response();
        }
    };

    let mut final_text = String::new();
    let mut tool_calls = vec![];
    let _keep_alive = instance; 
    while let Some(msg) = rx.recv().await {
        if msg.event == Some("content_block_delta".into()) {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&msg.data) {
                if let Some(text) = val.get("delta").and_then(|d| d.get("text")).and_then(|v| v.as_str()) {
                    final_text.push_str(text);
                }
            }
        } else if msg.event == Some("content_block_start".into()) {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&msg.data) {
                if let Some(cb) = val.get("content_block") {
                    if cb.get("type").and_then(|v| v.as_str()) == Some("tool_use") {
                        tool_calls.push(cb.clone());
                    }
                }
            }
        }
    }

    // 记录流量日志
    let duration = start_time.elapsed().as_millis() as u64;
    let meta = meta_rx.await.unwrap_or_default();
    let mapped_model = format!("{}", resolved_model_id);
    
    let log = transcoder_core::transcoder::TrafficLog {
        id: trace_id,
        timestamp: chrono::Utc::now().timestamp_millis(),
        method: "POST".into(),
        url: "/v1/messages".into(),
        status: if meta.error.is_none() { 200 } else { 500 },
        duration,
        model: Some(model_name_str),
        mapped_model: Some(mapped_model),
        account_email: Some(email),
        client_ip: Some("127.0.0.1".to_string()),
        error: meta.error,
        input_tokens: Some(meta.input_tokens),
        output_tokens: Some(meta.output_tokens),
        protocol: "anthropic".into(),
    };

    if let Err(e) = state.traffic_mgr.record_log(log) {
        tracing::error!("❌ [Monitor] 记录流量日志失败: {}", e);
    }

    let mut content = vec![];
    if !final_text.is_empty() { content.push(serde_json::json!({"type": "text", "text": final_text})); }
    for tc in tool_calls.into_iter() { content.push(tc); }

    let stop_reason = if content.iter().any(|c| c.get("type").and_then(|v| v.as_str()) == Some("tool_use")) { "tool_use" } else { "end_turn" };

    let response_json = serde_json::json!({
        "id": format!("msg_{}", uuid::Uuid::new_v4().to_string().replace("-", "")),
        "type": "message", "role": "assistant", "model": "claude-3-5-sonnet-20241022",
        "content": content, "stop_reason": stop_reason, "stop_sequence": null,
        "usage": { "input_tokens": 0, "output_tokens": 0 }
    });
    Json(response_json).into_response()
}

pub async fn gemini_generate_content(
    State(state): State<Arc<AppState>>,
    auth: AuthContext,
    Path(model): Path<String>,
    headers: HeaderMap,
    Json(mut payload): Json<transcoder_core::transcoder::GeminiContentRequest>,
) -> Response {
    // Gemini 原生 SDK 会将调用方法拼到路径上，例如
    // gemini-3-flash-agent:streamGenerateContent，需要先还原真实模型名。
    let normalized_model = model.split(':').next().unwrap_or(&model).to_string();
    payload.model = Some(normalized_model);
    let slot_id = extract_slot_id(&headers);
    handle_protocol_generic::<GeminiMapper>(&state, auth, slot_id, payload).await
}
