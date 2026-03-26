// 移除顶层重复导入，统一由下层 crate::provider 导入
use anyhow::{Context, Result};
use async_trait::async_trait;
use std::collections::HashMap;
use std::net::{SocketAddr, TcpListener};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::process::{Child, Command};
use tokio::sync::{Mutex, RwLock};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tracing::{info, error, debug, warn};

#[derive(Clone, PartialEq, ::prost::Message)]
pub struct InitMetadata {
    #[prost(string, tag = "1")]
    pub ide_name: ::prost::alloc::string::String,
    #[prost(string, tag = "2")]
    pub extension_version: ::prost::alloc::string::String,
    #[prost(string, tag = "3")]
    pub api_key: ::prost::alloc::string::String,
    #[prost(string, tag = "4")]
    pub locale: ::prost::alloc::string::String,
    #[prost(string, tag = "7")]
    pub ide_version: ::prost::alloc::string::String,
    #[prost(string, tag = "10")]
    pub session_id: ::prost::alloc::string::String,
    #[prost(string, tag = "11")]
    pub editor_name: ::prost::alloc::string::String,
    #[prost(string, tag = "12")]
    pub extension_name: ::prost::alloc::string::String,
    #[prost(string, tag = "24")]
    pub device_fingerprint: ::prost::alloc::string::String,
    #[prost(string, tag = "25")]
    pub trigger_id: ::prost::alloc::string::String,
    #[prost(string, tag = "17")]
    pub extension_path: ::prost::alloc::string::String,
    #[prost(int32, tag = "34")]
    pub detect_and_use_proxy: i32,
}

/// LS 啟動元數據配置 (支持從 constants.rs 注入)
#[derive(Debug, Clone)]
pub struct LsMetadataConfig {
    pub ide_name: String,
    pub ide_version: String,
    pub extension_name: String,
    pub extension_version: String,
    pub extension_path: String,
    pub locale: String,
}

#[allow(dead_code)]
pub struct NativeLsInstance {
    // 使用 Mutex 包裹 Child 防止部分早期 runtime 或泛型的 Sync 越轨报错
    child: Mutex<Child>,
    grpc_addr: SocketAddr,
    csrf_token: Option<String>,
    data_dir: PathBuf,
    id: String,
    identity: String,
    identity_token_fingerprint: String,
    // 追踪最后访问时间以支持 LRU (使用同步锁以适配 LsInstance trait)
    last_accessed: std::sync::Mutex<std::time::Instant>,
    created_at: std::time::Instant,
    // 🚀 Token 容器，用于支持运行时注入与刷新
    pub(crate) oauth_token: Arc<RwLock<String>>,
    pub(crate) token_tx: Arc<tokio::sync::watch::Sender<String>>,
    // 记录过期时间
    pub(crate) expires_at: Arc<RwLock<std::time::Instant>>,
    // 🚀 记录最近一次的 stderr 关键报错 (身份感知的原始报错)
    pub(crate) last_error: Arc<std::sync::RwLock<Option<String>>>,
}

impl Drop for NativeLsInstance {
    fn drop(&mut self) {
        info!("🧹 清理 Native LsInstance 数据目录与僵尸进程: {:?}", self.data_dir);
        let _ = std::fs::remove_dir_all(&self.data_dir);
    }
}

impl LsInstance for NativeLsInstance {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn grpc_addr(&self) -> SocketAddr {
        self.grpc_addr
    }

    fn csrf_token(&self) -> Option<String> {
        self.csrf_token.clone()
    }

    fn id(&self) -> String {
        self.id.clone()
    }

    fn identity(&self) -> String {
        self.identity.clone()
    }

    fn creation_time(&self) -> std::time::Instant {
        self.created_at
    }

    fn last_accessed(&self) -> std::time::Instant {
        *self.last_accessed.lock().unwrap()
    }

    fn set_last_accessed(&self, time: std::time::Instant) {
        *self.last_accessed.lock().unwrap() = time;
    }
}

impl transcoder_core::common::ErrorFetcher for NativeLsInstance {
    fn get_last_error(&self) -> Option<String> {
        self.last_error.read().unwrap().clone()
    }
}

use crate::provider::{LsInstance, LsProvider, LsProviderConfig, InstanceInfo};

pub struct NativeLsProvider {
    base_dir: PathBuf,
    bin_path: PathBuf,
    /// 活跃实例池：Hash -> Instance
    instances: RwLock<HashMap<String, Arc<dyn LsInstance>>>,
    /// 动态治理配置
    config: RwLock<LsProviderConfig>,
    /// 云端网关代理入口
    cloud_code_endpoint: String,
    /// 注入元数据配置
    metadata_config: LsMetadataConfig,
}

impl NativeLsProvider {
    pub fn new(
        base_dir: PathBuf, 
        bin_path: PathBuf, 
        cloud_code_endpoint: String,
        metadata_config: LsMetadataConfig,
    ) -> Arc<Self> {
        let provider = Arc::new(Self {
            base_dir,
            bin_path,
            instances: RwLock::new(HashMap::new()),
            config: RwLock::new(LsProviderConfig::default()),
            cloud_code_endpoint,
            metadata_config,
        });

        // 启动后台 TTL 回收任务
        let provider_clone = provider.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
            loop {
                interval.tick().await;
                provider_clone.perform_ttl_cleanup().await;
            }
        });

        provider
    }

    /// 执行 TTL 扫描与回收
    async fn perform_ttl_cleanup(&self) {
        let (idle_timeout, _max_inst) = {
            let cfg = self.config.read().await;
            (cfg.idle_timeout_secs, cfg.max_instances)
        };

        if idle_timeout == 0 {
            return;
        }

        let now = std::time::Instant::now();
        let timeout_dur = std::time::Duration::from_secs(idle_timeout);

        let mut victims = Vec::new();
        {
            let cache = self.instances.read().await;
            for (id, inst) in cache.iter() {
                if now.duration_since(inst.last_accessed()) > timeout_dur {
                    victims.push(id.clone());
                }
            }
        }

        if !victims.is_empty() {
            info!("🧹 TTL 回收: 发现 {} 个超时闲置实例", victims.len());
            let mut cache = self.instances.write().await;
            for vid in victims {
                info!("🗑 自动回收闲置实例: {}", vid);
                cache.remove(&vid);
            }
        }
    }

    /// 🚀 核心：通过 Refresh Token 换取新鲜的 Access Token (兼容 Go 版逻辑)
    pub(crate) async fn exchange_access_token(refresh_token: &str) -> Result<(String, u64)> {
        let client = reqwest::Client::new();
        
        // 与 auth.rs 保持一致的 Client 配置
        use transcoder_core::constants::*;
        let combinations = [
            (GOOGLE_CLIENT_ID_1, GOOGLE_CLIENT_SECRET_1),
            (GOOGLE_CLIENT_ID_2, GOOGLE_CLIENT_SECRET_2),
        ];

        for (cid, csec) in combinations {
            let res = client.post(OAUTH_TOKEN_URL)
                .form(&[
                    ("client_id", cid),
                    ("client_secret", csec),
                    ("refresh_token", refresh_token),
                    ("grant_type", "refresh_token"),
                ])
                .send()
                .await;

            if let Ok(resp) = res {
                if resp.status().is_success() {
                    let json: serde_json::Value = resp.json().await?;
                    if let Some(at) = json["access_token"].as_str() {
                        let expires_in = json["expires_in"].as_u64().unwrap_or(3600);
                        debug!("🎯 [Native] Token 换取成功 (Client: {})", &cid[..10]);
                        return Ok((at.to_string(), expires_in));
                    }
                }
            }
        }
        
        anyhow::bail!("所有 Client ID 均换取失败，请检查 Refresh Token 是否有效")
    }

    fn get_free_port() -> Result<u16> {
        let listener = TcpListener::bind("127.0.0.1:0")?;
        Ok(listener.local_addr()?.port())
    }

    async fn get_config_internal(&self) -> LsProviderConfig {
        self.config.read().await.clone()
    }

    async fn update_config_internal(&self, config: LsProviderConfig) -> Result<()> {
        let mut cfg = self.config.write().await;
        *cfg = config;
        info!("⚙️ 治理配置已更新: {:?}", *cfg);
        Ok(())
    }
}

#[async_trait]
impl LsProvider for NativeLsProvider {
    async fn acquire_instance(&self, identity: &str, identity_token: &str, slot_id: Option<&str>) -> Result<Arc<dyn LsInstance>> {
        // 确定逻辑 ID：如果有 slot_id 则使用它作为 Key；否则使用 Token MD5
        let logic_id = slot_id.map(|s| s.to_string())
            .unwrap_or_else(|| format!("{:x}", md5::compute(identity_token)));

        // 1. 检查复用池
        {
            let cache = self.instances.read().await;
            if let Some(inst) = cache.get(&logic_id) {
                // 如果是 Slot 模式且 Token 变更了，则需要重启切换
                let is_slot_mismatch = slot_id.is_some() && {
                    if let Some(native) = inst.as_any().downcast_ref::<NativeLsInstance>() {
                        native.identity_token_fingerprint != format!("{:x}", md5::compute(identity_token))
                    } else {
                        false
                    }
                };

                if !is_slot_mismatch {
                    // 🚀 增加过期检查：如果距离过期不足 5 分钟，则视为失效，触发重启
                    let is_expired = if let Some(native) = inst.as_any().downcast_ref::<NativeLsInstance>() {
                        let expires_at = *native.expires_at.read().await;
                        std::time::Instant::now() >= expires_at
                    } else {
                        false
                    };

                    if !is_expired {
                        inst.set_last_accessed(std::time::Instant::now());
                        debug!("♻️ 复用现有 LS 实例: {}", logic_id);
                        return Ok(inst.clone());
                    }
                    
                    info!("⏳ 实例即将过期或已过期，准备重建: {}", logic_id);
                    // 这里暂不手动移除，由后面的代码覆盖写入新实例
                } else {
                    info!("🔄 Slot {} 检测到 Token 变更，执行清理并重启", logic_id);
                }
            }
        }

        // 2. 准备启动新实例，先获取端口以防后续锁竞争期间被抢占
        let lsp_port = Self::get_free_port().context("无法获取 LSP 端口")?;
        let server_port = Self::get_free_port().context("无法获取 Server 端口")?;

        // 3. 执行物理清理与 LRU 剔除 (锁定写锁)
        {
            let mut cache = self.instances.write().await;
            
            // 如果已存在（针对 Slot 切换或并发竞争），先移除旧的
            cache.remove(&logic_id); 

            // LRU 治理 (使用动态配置)
            let max_inst = self.config.read().await.max_instances;
            if cache.len() >= max_inst {
                let mut victim_id = None;
                let mut oldest_time = std::time::Instant::now();
                for (id, inst) in cache.iter() {
                    let last = inst.last_accessed();
                    if last < oldest_time {
                        oldest_time = last;
                        victim_id = Some(id.clone());
                    }
                }
                if let Some(vid) = victim_id {
                    info!("♻️ 资源上限触发 LRU 剔除: {}", vid);
                    cache.remove(&vid);
                }
            }
        }

        // 4. 环境准备
        let instance_tag = format!("isolated_vs_{}", logic_id);
        let data_dir = self.base_dir.join(&instance_tag);
        let _ = std::fs::remove_dir_all(&data_dir); // 确保环境纯净
        std::fs::create_dir_all(&data_dir)?;

        // 🚀 非 Standalone 模式不再需要手动写入本地 token 文件，完全由 ExtensionServer 注入
        let es_csrf_token = uuid::Uuid::new_v4().to_string();
        let es_port = Self::get_free_port().context("无法获取 Extension Server 端口")?;
        
        // 🚀 首屏 Token 换取：在启动前获取一个新鲜的 Access Token
        let (access_token, expires_in) = Self::exchange_access_token(identity_token).await
            .unwrap_or_else(|e| {
                warn!("⚠️ Token 换取失败 (将使用原始 token): {}", e);
                (identity_token.to_string(), 3600)
            });

        // 准备 Token 容器与同步通道 (watch 适用于 1-to-many 实时通知)
        let (token_tx, token_rx) = tokio::sync::watch::channel(access_token.clone());
        let oauth_token_arc = Arc::new(RwLock::new(access_token.clone()));
        let expires_at_val = std::time::Instant::now() + std::time::Duration::from_secs(expires_in - 300);
        let expires_at_arc = Arc::new(RwLock::new(expires_at_val));
        let last_error_arc = Arc::new(std::sync::RwLock::new(None));
        
        // 🚀 在后台启动 Extension Server 监听器 (支持 Connect 协议)
        let es_impl = crate::extension_server::ExtensionServerImpl {
            csrf_token: es_csrf_token.clone(),
            oauth_token: oauth_token_arc.clone(),
            token_rx: token_rx.clone(),
        };
        crate::extension_server::start_extension_server(es_port, Arc::new(es_impl)).await?;
        
        info!("🚀 启动核心进程 (ID: {})...", logic_id);
        debug!("🛠 [Native] 命令执行路径: {:?}", self.bin_path);
        debug!("🛠 [Native] 启动参数: -lsp_port {} -https_server_port {} -extension_server_port {} -extension_server_csrf_token {}", lsp_port, server_port, es_port, es_csrf_token);
        
        let vscode_pid = std::process::id().to_string();
        let session_id = uuid::Uuid::new_v4().to_string();
        let nls_config = serde_json::json!({
            "locale": "en-us",
            "osLocale": "zh-cn",
            "availableLanguages": {},
            "_languagePackSupport": true
        }).to_string();

        let mut cmd = Command::new(&self.bin_path);
        cmd.env("HOME", &data_dir)
           .env("CLOUD_CODE_ENDPOINT", &self.cloud_code_endpoint)
           .env("VSCODE_PID", &vscode_pid)
           .env("ELECTRON_RUN_AS_NODE", "1")
           .env("ANTIGRAVITY_EDITOR_APP_ROOT", &data_dir) 
           .env("VSCODE_NLS_CONFIG", &nls_config)
           .arg("-lsp_port").arg(lsp_port.to_string())
           .arg("-https_server_port").arg(server_port.to_string())
           .arg("-extension_server_port").arg(es_port.to_string())
           .arg("-csrf_token").arg(&es_csrf_token)
           .arg("-extension_server_csrf_token").arg(&es_csrf_token)
           // 🚀 核心变更：不再携带 -standalone
           .arg("--cloud_code_endpoint")
           .arg(&self.cloud_code_endpoint)
           .stdout(Stdio::piped())
           .stderr(Stdio::piped())
           .stdin(Stdio::piped())
           .kill_on_drop(true);
           
        let mut child = cmd.spawn().context("ls_core 启动失败")?;
        
        // 5. 元數據注入 (Stdin)
        if let Some(mut stdin) = child.stdin.take() {
            let metadata = InitMetadata {
                ide_name: self.metadata_config.ide_name.clone(),
                extension_version: self.metadata_config.extension_version.clone(),
                api_key: String::new(), // [FIX] 回归原生，置空 api_key，依靠 Extension Server 发送 Token
                locale: self.metadata_config.locale.clone(),
                ide_version: self.metadata_config.ide_version.clone(),
                session_id: session_id.clone(),
                editor_name: self.metadata_config.ide_name.clone(),
                extension_name: self.metadata_config.extension_name.clone(),
                device_fingerprint: logic_id.clone(),
                trigger_id: uuid::Uuid::new_v4().to_string(),
                extension_path: self.metadata_config.extension_path.clone(),
                detect_and_use_proxy: 1,
            };
            
            use ::prost::Message;
            let mut buf = Vec::new();
            if metadata.encode(&mut buf).is_ok() {
                info!("📥 [Native] 正在注入 Stdin Metadata (來自配置: {} bytes)...", buf.len());
                info!("📥 [Native] 注入內容: ide_version={}, api_key=***, locale={}", metadata.ide_version, metadata.locale);
                let _ = stdin.write_all(&buf).await;
                let _ = stdin.flush().await;
            }
            drop(stdin);
        }

        // 📝 异步收集日志：将 stdout 和 stderr 存盘到各沙箱目录，便于隔离排查
        if let Some(stdout) = child.stdout.take() {
            let log_path = data_dir.join("stdout.log");
            tokio::spawn(async move {
                if let Ok(mut file) = tokio::fs::File::create(&log_path).await {
                    let mut reader = BufReader::new(stdout).lines();
                    while let Ok(Some(line)) = reader.next_line().await {
                        let _ = file.write_all(format!("{}\n", line).as_bytes()).await;
                    }
                }
            });
        }
        
        if let Some(stderr) = child.stderr.take() {
            let log_path = data_dir.join("stderr.log");
            let logical_id_clone = logic_id.clone();
            let last_error_arc = last_error_arc.clone();
            tokio::spawn(async move {
                if let Ok(mut file) = tokio::fs::File::create(&log_path).await {
                    let mut reader = BufReader::new(stderr).lines();
                    while let Ok(Some(line)) = reader.next_line().await {
                        let _ = file.write_all(format!("{}\n", line).as_bytes()).await;
                        if line.contains("ERROR") || line.contains("error:") || line.contains("FATAL") || line.contains("PERMISSION_DENIED") {
                            error!("[ls_core stderr {}] {}", logical_id_clone, line);
                            // 🚀 提取并缓存原始报错，特别是 403 验证引导
                            if line.contains("PERMISSION_DENIED") || line.contains("Verify your account") {
                                if let Ok(mut lock) = last_error_arc.write() {
                                    *lock = Some(line.clone());
                                }
                            }
                        }
                    }
                }
            });
        }

        // ⏳ 就绪探测 (缩短为 10 秒)
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        let mut is_ready = false;
        while std::time::Instant::now() < deadline {
            if tokio::net::TcpStream::connect(("127.0.0.1", server_port)).await.is_ok() {
                is_ready = true;
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        }

        if !is_ready {
            return Err(anyhow::anyhow!("实例 {} 启动就绪超时，请检查 Token 有效性", logic_id));
        }

        let instance = Arc::new(NativeLsInstance {
            child: Mutex::new(child),
            grpc_addr: format!("127.0.0.1:{}", server_port).parse()?,
            csrf_token: Some(es_csrf_token),
            data_dir,
            id: logic_id.clone(),
            identity: identity.to_string(),
            identity_token_fingerprint: format!("{:x}", md5::compute(identity_token)),
            last_accessed: std::sync::Mutex::new(std::time::Instant::now()),
            created_at: std::time::Instant::now(),
            oauth_token: oauth_token_arc.clone(),
            token_tx: Arc::new(token_tx),
            expires_at: expires_at_arc.clone(),
            last_error: last_error_arc.clone(),
        });

        // 🚀 启动 Token 后台续期协程
        let instance_node = instance.clone();
        let identity_token_owned = identity_token.to_string();
        tokio::spawn(async move {
            info!("🔄 [Native] 启动 Token 自动续期任务: {}", instance_node.id());
            loop {
                let wait_dur = {
                    let expires_at = *instance_node.expires_at.read().await;
                    let now = std::time::Instant::now();
                    if expires_at > now {
                        expires_at.duration_since(now).min(std::time::Duration::from_secs(1800))
                    } else {
                        std::time::Duration::from_secs(1)
                    }
                };
                
                tokio::time::sleep(wait_dur).await;
                
                // 执行续期 (调用静态方法)
                match NativeLsProvider::exchange_access_token(&identity_token_owned).await {
                    Ok((new_at, new_expires_in)) => {
                        info!("🎯 [Native] Token 自动续期成功: {}", instance_node.id());
                        *instance_node.oauth_token.write().await = new_at.clone();
                        *instance_node.expires_at.write().await = std::time::Instant::now() + std::time::Duration::from_secs(new_expires_in - 300);
                        let _ = instance_node.token_tx.send(new_at);
                    }
                    Err(e) => {
                        error!("⚠️ [Native] Token 自动续期失败: {:?}. 将在 60s 后重试", e);
                        tokio::time::sleep(std::time::Duration::from_secs(60)).await;
                    }
                }
            }
        });

        {
            let mut cache = self.instances.write().await;
            cache.insert(logic_id.clone(), instance.clone());
        }

        Ok(instance)
    }

    async fn list_instances(&self) -> Result<Vec<InstanceInfo>> {
        let cache = self.instances.read().await;
        let mut infos = Vec::new();
        let now = std::time::Instant::now();
        let sys_now = std::time::SystemTime::now();

        // 收集内存中活跃实例的 ID 集合，用于后续孤儿扫描
        let mut active_ids = std::collections::HashSet::new();

        for inst in cache.values() {
            let last_accessed = inst.last_accessed();
            let created_at = inst.creation_time();

            let last_accessed_diff = now.duration_since(last_accessed).as_secs();
            let created_at_diff = now.duration_since(created_at).as_secs();

            let created_at_unix = sys_now
                .checked_sub(std::time::Duration::from_secs(created_at_diff))
                .unwrap_or(sys_now)
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            
            let last_accessed_unix = sys_now
                .checked_sub(std::time::Duration::from_secs(last_accessed_diff))
                .unwrap_or(sys_now)
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();

            active_ids.insert(inst.id());
            infos.push(InstanceInfo {
                id: inst.id(),
                identity: inst.identity(),
                grpc_addr: inst.grpc_addr().to_string(),
                last_accessed_secs: last_accessed_unix,
                created_at_secs: created_at_unix,
                status: "active".to_string(),
            });
        }

        // 扫描磁盘上遗留的孤儿沙盒目录（服务重启后进程已 kill，但目录未清理）
        if let Ok(entries) = std::fs::read_dir(&self.base_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if let Some(orphan_id) = name.strip_prefix("isolated_vs_") {
                    if active_ids.contains(orphan_id) {
                        continue; // 活跃实例跳过
                    }
                    // 读取目录 mtime 作为最后活跃时间
                    let mtime = entry.metadata().ok()
                        .and_then(|m| m.modified().ok())
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(0);

                    infos.push(InstanceInfo {
                        id: orphan_id.to_string(),
                        identity: "—".to_string(),
                        grpc_addr: "offline".to_string(),
                        last_accessed_secs: mtime,
                        created_at_secs: mtime,
                        status: "orphan".to_string(),
                    });
                }
            }
        }

        Ok(infos)
    }

    async fn remove_instance(&self, id: &str) -> Result<bool> {
        let mut cache = self.instances.write().await;
        let removed_from_cache = cache.remove(id).is_some();
        if removed_from_cache {
            info!("🗑 实例 {} 已从内存池下线", id);
        }

        // 无论内存中是否存在，都尝试清理磁盘沙盒目录（兼容孤儿清理）
        let data_dir = self.base_dir.join(format!("isolated_vs_{}", id));
        if data_dir.exists() {
            let _ = std::fs::remove_dir_all(&data_dir);
            info!("🧹 沙盒目录已清理: {:?}", data_dir);
            return Ok(true);
        }

        Ok(removed_from_cache)
    }

    async fn get_config(&self) -> LsProviderConfig {
        self.get_config_internal().await
    }

    async fn update_config(&self, config: LsProviderConfig) -> Result<()> {
        self.update_config_internal(config).await
    }
}
