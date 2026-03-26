use axum::{
    body::Body,
    extract::{Request, State},
    http::{header, Response, StatusCode},
    response::IntoResponse,
    routing::post,
    Router,
};
use bytes::{BufMut, Bytes, BytesMut};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{info, warn, debug};
use transcoder_core::proto::exa::extension_server_pb::{
    GetSecretValueResponse, SubscribeToUnifiedStateSyncTopicRequest, LanguageServerStartedRequest,
    LanguageServerStartedResponse, LogEventRequest, LogEventResponse,
    GetChromeDevtoolsMcpUrlResponse, IsAgentManagerEnabledResponse, CheckTerminalShellSupportResponse,
    unified_state_sync_update::UpdateType,
};
use transcoder_core::proto::exa::language_server_pb::OAuthTokenInfo;
use prost_types::Timestamp;
use transcoder_core::proto::exa::unified_state_sync_pb::{Topic, Row, CustomModels};
use transcoder_core::proto::exa::codeium_common_pb::{ModelInfo, Model, ModelType, ApiProvider};
use transcoder_core::transcoder::UnifiedStateSyncUpdate;
use ::prost::Message;
use tokio_stream::StreamExt as _;
use base64::Engine; // Changed from `Engine as _`

pub struct ExtensionServerImpl {
    pub csrf_token: String,
    pub oauth_token: Arc<RwLock<String>>,
    pub token_rx: tokio::sync::watch::Receiver<String>,
}

// 🚀 Connect 协议封装工具
pub struct ConnectWire;

impl ConnectWire {
    // 封装数据帧 (Type 0x00)
    pub fn encode_data<T: Message>(msg: &T) -> Bytes {
        let mut buf = Vec::new();
        msg.encode(&mut buf).unwrap();
        
        let mut frame = BytesMut::with_capacity(5 + buf.len());
        frame.put_u8(0x00); // Data frame
        frame.put_u32(buf.len() as u32);
        frame.put_slice(&buf);
        frame.freeze()
    }

    // 封装流结束帧 (Type 0x02)，Connect 默认使用空 JSON `{}` 表示成功
    pub fn encode_end_stream() -> Bytes {
        let buf = b"{}";
        let mut frame = BytesMut::with_capacity(5 + buf.len());
        frame.put_u8(0x02); // EndStream frame
        frame.put_u32(buf.len() as u32);
        frame.put_slice(buf);
        frame.freeze()
    }

    // 从 Connect 帧中提取 Protobuf 负载 (忽略 5 字节头部)
    pub fn decode_payload(body: Bytes) -> Bytes {
        if body.len() >= 5 {
            body.slice(5..)
        } else {
            body
        }
    }
}

pub async fn start_extension_server(
    port: u16,
    state: Arc<ExtensionServerImpl>,
) -> anyhow::Result<()> {
    let app = Router::new()
        .route("/exa.extension_server_pb.ExtensionServerService/GetSecretValue", post(handle_get_secret_value))
        .route("/exa.extension_server_pb.ExtensionServerService/SubscribeToUnifiedStateSyncTopic", post(handle_subscribe_to_uss))
        .route("/exa.extension_server_pb.ExtensionServerService/SubscribeToUnifiedStateSync", post(handle_subscribe_to_uss))
        .route("/exa.extension_server_pb.ExtensionServerService/LanguageServerStarted", post(handle_ls_started))
        .route("/exa.extension_server_pb.ExtensionServerService/LogEvent", post(handle_log_event))
        .route("/exa.extension_server_pb.ExtensionServerService/GetChromeDevtoolsMcpUrl", post(handle_get_devtools_url))
        .route("/exa.extension_server_pb.ExtensionServerService/CheckTerminalShellSupport", post(handle_check_terminal_shell_support))
        .route("/exa.extension_server_pb.ExtensionServerService/IsAgentManagerEnabled", post(handle_generic_false))
        .route("/exa.extension_server_pb.ExtensionServerService/PushUnifiedStateSyncUpdate", post(handle_push_uss_update))
        .fallback(handle_any_grpc)
        .with_state(state)
        .layer(tower_http::trace::TraceLayer::new_for_http());

    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    info!("🚀 Extension Server (Connect Proto) 正在启动: {}", addr);
    
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            warn!("⚠️ Extension Server 异常退出: {}", e);
        }
    });

    Ok(())
}

// 🛡 CSRF 验证中间逻辑 (封装为函数简化实现)
fn verify_csrf(req: &Request<Body>, expected: &str) -> bool {
    if let Some(token) = req.headers().get("x-codeium-csrf-token") {
        if let Ok(token_str) = token.to_str() {
            return token_str == expected;
        }
    }
    false
}

async fn handle_get_secret_value(
    State(state): State<Arc<ExtensionServerImpl>>,
    req: Request<Body>,
) -> impl IntoResponse {
    if !verify_csrf(&req, &state.csrf_token) {
        return (StatusCode::FORBIDDEN, "Invalid CSRF token").into_response();
    }

    let token = state.oauth_token.read().await;
    let resp = GetSecretValueResponse { value: token.clone() };
    
    Response::builder()
        .header(header::CONTENT_TYPE, "application/connect+proto")
        .status(StatusCode::OK)
        .body(Body::from([ConnectWire::encode_data(&resp), ConnectWire::encode_end_stream()].concat()))
        .unwrap()
}

async fn handle_subscribe_to_uss(
    State(state): State<Arc<ExtensionServerImpl>>,
    req: Request<Body>,
) -> impl IntoResponse {
    if !verify_csrf(&req, &state.csrf_token) {
        return (StatusCode::FORBIDDEN, "Invalid CSRF token").into_response();
    }

    // 提取主题
    let body_bytes = axum::body::to_bytes(req.into_body(), 1024).await.unwrap_or_default();
    let payload = ConnectWire::decode_payload(body_bytes);
    let subscribe_req = SubscribeToUnifiedStateSyncTopicRequest::decode(payload).unwrap_or_default();
    let topic = subscribe_req.topic;
    
    info!("🔄 [ExtensionServer] 收到 LS 订阅请求: Topic={}", topic);
    let token = state.oauth_token.read().await.clone();

    let (tx, rx) = tokio::sync::mpsc::channel(10);
    
    // 默认发送初始状态（哪怕是空的），以满足 LS "expected initial state as first message" 的要求
    let mut initial_topic = Topic::default();

    if topic == "uss-oauth" && !token.is_empty() {
        // ... (existing oauth logic)
        let oauth_info_msg = OAuthTokenInfo {
            access_token: token,
            token_type: "Bearer".to_string(),
            refresh_token: String::new(),
            expiry: Some(Timestamp {
                seconds: 4102444800, // 2100-01-01
                nanos: 0,
            }),
            is_gcp_tos: false,
        };
        let mut oauth_info_bytes = Vec::new();
        let _ = oauth_info_msg.encode(&mut oauth_info_bytes);
        let b64_payload = base64::engine::general_purpose::STANDARD.encode(&oauth_info_bytes);
        
        // 注入多种可能的 Key 以增加撞中概率
        initial_topic.data.insert("oauthTokenInfoSentinelKey".to_string(), Row { value: b64_payload.clone(), e_tag: 1 });
        initial_topic.data.insert("primary-account".to_string(), Row { value: b64_payload.clone(), e_tag: 1 });
        initial_topic.data.insert("active-account".to_string(), Row { value: b64_payload.clone(), e_tag: 1 });
        initial_topic.data.insert("current-account".to_string(), Row { value: b64_payload.clone(), e_tag: 1 });
        initial_topic.data.insert("default-account".to_string(), Row { value: b64_payload.clone(), e_tag: 1 });
    } else if topic == "uss-enterprisePreferences" {
        // 提供一个空的但在架构上合规的企业首选项，防止 LS 因缺失 Key 而挂起
        initial_topic.data.insert("enterprisePreferencesSentinelKey".to_string(), Row { value: "".to_string(), e_tag: 1 });
    } else if topic == "customModels" {
        let mut custom_models = CustomModels::default();
        custom_models.custom_models.insert("MODEL_GOOGLE_GEMINI_RIFTRUNNER_THINKING_LOW".to_string(), ModelInfo {
            model_id: Model::GoogleGeminiRiftrunnerThinkingLow as i32,
            is_internal: true,
            model_type: ModelType::Chat as i32,
            max_tokens: 32000,
            model_name: "Gemini 3.1 Pro Low".to_string(),
            supports_context: true,
            api_provider: ApiProvider::Internal as i32,
            ..Default::default()
        });
        
        let mut cm_bytes = Vec::new();
        let _ = custom_models.encode(&mut cm_bytes);
        let b64_payload = base64::engine::general_purpose::STANDARD.encode(&cm_bytes);
        initial_topic.data.insert("customModelsSentinelKey".to_string(), Row { value: b64_payload, e_tag: 1 });
    }

    let update = UnifiedStateSyncUpdate {
        update_type: Some(UpdateType::InitialState(initial_topic)),
    };
    let _ = tx.send(ConnectWire::encode_data(&update)).await;
    
    // 持续推送心跳与 Token 更新，确保流不中断且状态实时
    let mut token_rx = state.token_rx.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
        loop {
            tokio::select! {
                _ = interval.tick() => {
                    let heartbeat = UnifiedStateSyncUpdate {
                        update_type: Some(UpdateType::AppliedUpdate(Default::default())),
                    };
                    if tx.send(ConnectWire::encode_data(&heartbeat)).await.is_err() {
                        break;
                    }
                }
                _ = token_rx.changed() => {
                    let new_token = token_rx.borrow().clone();
                    if topic == "uss-oauth" && !new_token.is_empty() {
                        info!("🔄 [ExtensionServer] 检测到 Token 变更，正在增量推送到 LS (Topic={})", topic);
                        let oauth_info_msg = OAuthTokenInfo {
                            access_token: new_token,
                            token_type: "Bearer".to_string(),
                            refresh_token: String::new(),
                            expiry: Some(prost_types::Timestamp {
                                seconds: 4102444800, 
                                nanos: 0,
                            }),
                            is_gcp_tos: false,
                        };
                        let mut oauth_info_bytes = Vec::new();
                        let _ = oauth_info_msg.encode(&mut oauth_info_bytes);
                        let b64_payload = base64::engine::general_purpose::STANDARD.encode(&oauth_info_bytes);
                        
                        let keys = ["oauthTokenInfoSentinelKey", "primary-account", "active-account", "current-account", "default-account"];
                        for key in keys {
                            let apply = transcoder_core::proto::exa::unified_state_sync_pb::AppliedUpdate {
                                key: key.to_string(),
                                new_row: Some(Row { value: b64_payload.clone(), e_tag: 1 }),
                                deleted: false,
                                current_e_tag: 0,
                            };

                            let update = UnifiedStateSyncUpdate {
                                update_type: Some(UpdateType::AppliedUpdate(apply)),
                            };
                            if tx.send(ConnectWire::encode_data(&update)).await.is_err() {
                                return;
                            }
                        }
                    }
                }
            }
        }
    });

    let stream = tokio_stream::wrappers::ReceiverStream::new(rx).map(Ok::<_, std::convert::Infallible>);
    
    Response::builder()
        .header(header::CONTENT_TYPE, "application/connect+proto")
        .status(StatusCode::OK)
        .body(Body::from_stream(stream))
        .unwrap()
}

async fn handle_ls_started(
    State(state): State<Arc<ExtensionServerImpl>>,
    req: Request<Body>,
) -> impl IntoResponse {
    if !verify_csrf(&req, &state.csrf_token) {
        return (StatusCode::FORBIDDEN, "Invalid CSRF token").into_response();
    }
    
    let body_bytes = axum::body::to_bytes(req.into_body(), 1024).await.unwrap_or_default();
    debug!("📦 [ExtensionServer] LanguageServerStarted RAW Body: {:?}", body_bytes);
    
    let payload = ConnectWire::decode_payload(body_bytes);
    if let Ok(started) = LanguageServerStartedRequest::decode(payload) {
        info!("🔔 [ExtensionServer] LS 已启动！HTTPS={}, LSP={}, CSRF={}", started.https_port, started.lsp_port, started.csrf_token);
    }

    Response::builder()
        .header(header::CONTENT_TYPE, "application/connect+proto")
        .body(Body::from([ConnectWire::encode_data(&LanguageServerStartedResponse{}), ConnectWire::encode_end_stream()].concat()))
        .unwrap()
}

async fn handle_log_event(
    State(state): State<Arc<ExtensionServerImpl>>,
    req: Request<Body>,
) -> impl IntoResponse {
    if !verify_csrf(&req, &state.csrf_token) {
        return (StatusCode::FORBIDDEN, "Invalid CSRF token").into_response();
    }
    
    let body_bytes = axum::body::to_bytes(req.into_body(), 4096).await.unwrap_or_default();
    let payload = ConnectWire::decode_payload(body_bytes);
    if let Ok(log) = LogEventRequest::decode(payload) {
        debug!("📝 [LS LOG] {:?}: {}", log.event, log.event_string);
    }

    Response::builder()
        .header(header::CONTENT_TYPE, "application/connect+proto")
        .body(Body::from([ConnectWire::encode_data(&LogEventResponse{}), ConnectWire::encode_end_stream()].concat()))
        .unwrap()
}

async fn handle_get_devtools_url(req: Request<Body>) -> impl IntoResponse {
    debug!("🔍 [ExtensionServer] GetChromeDevtoolsMcpUrl Headers: {:?}", req.headers());
    let resp = GetChromeDevtoolsMcpUrlResponse { url: "ws://127.0.0.1:9222/devtools/browser".to_string() };
    Response::builder()
        .header(header::CONTENT_TYPE, "application/connect+proto")
        .body(Body::from([ConnectWire::encode_data(&resp), ConnectWire::encode_end_stream()].concat()))
        .unwrap()
}

async fn handle_check_terminal_shell_support(req: Request<Body>) -> impl IntoResponse {
    let content_type = req.headers().get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/connect+proto");
    let shell_path = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
    let shell_name = std::path::Path::new(&shell_path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("sh")
        .to_string();
    let resp = CheckTerminalShellSupportResponse {
        has_shell_integration: true,
        shell_name,
        shell_path,
    };

    if content_type == "application/proto" {
        let mut buf = Vec::new();
        let _ = resp.encode(&mut buf);
        Response::builder()
            .header(header::CONTENT_TYPE, "application/proto")
            .body(Body::from(buf))
            .unwrap()
    } else {
        Response::builder()
            .header(header::CONTENT_TYPE, "application/connect+proto")
            .body(Body::from([ConnectWire::encode_data(&resp), ConnectWire::encode_end_stream()].concat()))
            .unwrap()
    }
}

async fn handle_generic_false(req: Request<Body>) -> impl IntoResponse {
    let content_type = req.headers().get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/connect+proto");

    let resp = IsAgentManagerEnabledResponse { enabled: false };
    
    if content_type == "application/proto" {
        let mut buf = Vec::new();
        let _ = resp.encode(&mut buf);
        Response::builder()
            .header(header::CONTENT_TYPE, "application/proto")
            .body(Body::from(buf))
            .unwrap()
    } else {
        Response::builder()
            .header(header::CONTENT_TYPE, "application/connect+proto")
            .body(Body::from([ConnectWire::encode_data(&resp), ConnectWire::encode_end_stream()].concat()))
            .unwrap()
    }
}

async fn handle_push_uss_update(
    State(state): State<Arc<ExtensionServerImpl>>,
    req: Request<Body>,
) -> impl IntoResponse {
    if !verify_csrf(&req, &state.csrf_token) {
        return (StatusCode::FORBIDDEN, "Invalid CSRF token").into_response();
    }
    
    // 对于 Connect Protocol Unary 请求 (application/proto)，
    // 直接返回空的 protobuf 二进制字节数组，而不带 Connect 的流式 5 字节 Framer 头。
    // 因 PushUnifiedStateSyncUpdateResponse 全空，编码后长度为 0
    Response::builder()
        .header(header::CONTENT_TYPE, "application/proto")
        .status(StatusCode::OK)
        .body(Body::from(Vec::new())) 
        .unwrap()
}

async fn handle_any_grpc(req: Request<Body>) -> impl IntoResponse {
    let method = req.method().clone();
    let uri = req.uri().clone();
    let headers = req.headers().clone();
    
    let content_type_str = headers.get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/connect+proto")
        .to_string();

    let headers_json = headers.iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("[invalid]").to_string()))
        .collect::<std::collections::HashMap<String, String>>();
    
    info!("👀 [ExtensionServer] 未匹配到路由: {} {} \nHeaders: {:?}", method, uri, headers_json);
    
    if content_type_str == "application/proto" {
        Response::builder()
            .header(header::CONTENT_TYPE, "application/proto")
            .status(StatusCode::OK)
            .body(Body::from(Vec::new()))
            .unwrap()
    } else {
        Response::builder()
            .header(header::CONTENT_TYPE, "application/connect+proto")
            .body(Body::from(ConnectWire::encode_end_stream()))
            .unwrap()
    }
}
