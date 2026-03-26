import React, { useState, useMemo, useEffect } from 'react';
import { useSpotlight } from '../hooks/useSpotlight';
import { useTranslation } from 'react-i18next';
import { 
  Terminal, 
  Copy, 
  Check, 
  Globe, 
  Shield, 
  Code, 
  Cpu, 
  Layers, 
  ExternalLink, 
  Search, 
  Info,
  ChevronRight,
  Zap,
  Box,
  Monitor,
  Smartphone,
  ShieldCheck,
  Activity,
  Clock,
  Filter,
  MoreHorizontal,
  Link,
  Command,
  BrainCircuit,
  BarChart,
  Database,
  Key,
  RefreshCw,
  Table,
  Server,
  X,
  FileJson,
  Plus,
  History,
  Trash2,
  Edit3,
  Eye,
  EyeOff
} from 'lucide-react';
import useAccountStore from '../store/useAccountStore';
import useKeyStore from '../store/useKeyStore';
import useAppStore from '../store/useAppStore';

const FALLBACK_MODELS = [
  { id: 'gemini-3.1-pro-high', name: 'Gemini 3.1 Pro', provider: 'Google', recommended: true, capabilities: ['Chat', 'Thinking'] },
  { id: 'gemini-3.1-pro-low', name: 'Gemini 3.1 Pro Low', provider: 'Google', recommended: false, capabilities: ['Chat', 'Thinking'] },
  { id: 'gemini-3-flash-agent', name: 'Gemini 3 Flash Agent', provider: 'Google', recommended: true, capabilities: ['Chat'] },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet', provider: 'Anthropic', recommended: true, capabilities: ['Chat'] },
  { id: 'claude-opus-4-6-thinking', name: 'Claude Opus Thinking', provider: 'Anthropic', recommended: false, capabilities: ['Chat', 'Thinking'] },
  { id: 'gpt-oss-120b-medium', name: 'GPT OSS 120B Medium', provider: 'OpenAI', recommended: false, capabilities: ['Chat'] },
];

const Integration = () => {
  const { t } = useTranslation();
  const { addToast } = useAppStore();
  const spotlightRef = useSpotlight();
  const spotlightModelsRef = useSpotlight();
  const [activeTab, setActiveTab] = useState('guide'); // 'guide' | 'models'
  const { accounts, fetchAccounts } = useAccountStore();
  const { keys, fetchKeys } = useKeyStore();
  const [copiedField, setCopiedField] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedApi, setSelectedApi] = useState(null);
  const [showKey, setShowKey] = useState(false);

  // 首屏加载时确保有账号和密钥数据
  useEffect(() => {
    if (accounts.length === 0) {
      fetchAccounts();
    }
    if (keys.length === 0) {
      fetchKeys();
    }
  }, []);

  // 端口逻辑：后端核心服务的真实端口是 5173，3000 是 Web 端代理端口
  const protocol = window.location.protocol;
  const hostname = window.location.hostname;
  const backendPort = '5173'; // 核心接口端口
  const baseUrl = `${protocol}//${hostname}:${backendPort}`;
  const apiUrl = `${baseUrl}/v1`;
  
  const defaultKey = keys.length > 0 ? keys[0].key : 'sk-antigravity-none-configure-one-first';
  const maskedKey = defaultKey.length > 12 
    ? `${defaultKey.slice(0, 10)}${'*'.repeat(defaultKey.length - 14)}${defaultKey.slice(-4)}`
    : '****************';

  const commonHeaders = {
    'Authorization': `Bearer ${defaultKey}`,
    'Content-Type': 'application/json'
  };

  const allApiCategories = useMemo(() => [
    {
      id: 'transcoding',
      title: t('integration.categories.transcoding.title'),
      subtitle: t('integration.categories.transcoding.subtitle'),
      icon: Zap,
      accent: 'blue',
      apis: [
        { 
          name: t('integration.categories.transcoding.chat.name'), protocol: 'OpenAI', method: 'POST', path: '/v1/chat/completions', 
          desc: t('integration.categories.transcoding.chat.desc'), accent: 'emerald',
          headers: commonHeaders,
          payload: { model: "gpt-4o", messages: [{ role: "user", content: "Hello" }], stream: true }
        },
        { 
          name: t('integration.categories.transcoding.claude.name'), protocol: 'Anthropic', method: 'POST', path: '/v1/messages', 
          desc: t('integration.categories.transcoding.claude.desc'), accent: 'amber',
          headers: { ...commonHeaders, 'x-api-key': defaultKey },
          payload: { model: "claude-3-5-sonnet-latest", messages: [{ role: "user", content: "Translate hi" }], max_tokens: 1024 }
        },
        { 
          name: t('integration.categories.transcoding.gemini.name'), protocol: 'Google', method: 'POST', path: '/v1beta/models/:model', 
          desc: t('integration.categories.transcoding.gemini.desc'), accent: 'blue',
          headers: commonHeaders,
          payload: { contents: [{ parts: [{ text: "Describe this image" }] }] }
        },
        { 
          name: t('integration.categories.transcoding.models.name'), protocol: 'OpenAI', method: 'GET', path: '/v1/models', 
          desc: t('integration.categories.transcoding.models.desc'), accent: 'emerald',
          headers: commonHeaders
        },
        { 
          name: t('integration.categories.transcoding.assist.name'), protocol: 'System', method: 'POST', path: '/v1/code_assist', 
          desc: t('integration.categories.transcoding.assist.desc'), accent: 'purple',
          headers: commonHeaders,
          payload: { prompt: "Complete this function...", context: "fn main() {" }
        },
        { 
          name: t('integration.categories.transcoding.responses.name'), protocol: 'OpenAI', method: 'POST', path: '/v1/responses', 
          desc: t('integration.categories.transcoding.responses.desc'), accent: 'emerald',
          headers: commonHeaders,
          payload: { assistant_id: "asst_abc123", thread_id: "thread_xyz" }
        }
      ]
    },
    {
      id: 'identity',
      title: t('integration.categories.identity.title'),
      subtitle: t('integration.categories.identity.subtitle'),
      icon: ShieldCheck,
      accent: 'emerald',
      apis: [
        { 
          name: t('integration.categories.identity.ledger.name'), protocol: 'System', method: 'GET', path: '/v1/accounts', 
          desc: t('integration.categories.identity.ledger.desc'), accent: 'blue',
          headers: commonHeaders
        },
        { 
          name: t('integration.categories.identity.delete.name'), protocol: 'System', method: 'DELETE', path: '/v1/accounts/:id', 
          desc: t('integration.categories.identity.delete.desc'), accent: 'rose',
          headers: commonHeaders
        },
        { 
          name: t('integration.categories.identity.alias.name'), protocol: 'System', method: 'POST', path: '/v1/accounts/:id/label', 
          desc: t('integration.categories.identity.alias.desc'), accent: 'indigo',
          headers: commonHeaders,
          payload: { label: "Production-Google-01" }
        },
        { 
          name: t('integration.categories.identity.provision.name'), protocol: 'System', method: 'POST', path: '/v1/accounts/import', 
          desc: t('integration.categories.identity.provision.desc'), accent: 'emerald',
          headers: commonHeaders,
          payload: { refresh_token: "1//0xxxx...", client_id: "...", client_secret: "..." }
        },
        { 
          name: t('integration.categories.identity.sync.name'), protocol: 'System', method: 'POST', path: '/v1/refresh_token', 
          desc: t('integration.categories.identity.sync.desc'), accent: 'amber',
          headers: commonHeaders
        },
        { 
          name: t('integration.categories.identity.tunnel.name'), protocol: 'System', method: 'GET', path: '/v1/auth/login', 
          desc: t('integration.categories.identity.tunnel.desc'), accent: 'blue',
          headers: commonHeaders
        },
        { 
          name: t('integration.categories.identity.quota.name'), protocol: 'System', method: 'POST', path: '/v1/quota', 
          desc: t('integration.categories.identity.quota.desc'), accent: 'amber',
          headers: commonHeaders
        }
      ]
    },
    {
      id: 'orchestration',
      title: t('integration.categories.orchestration.title'),
      subtitle: t('integration.categories.orchestration.subtitle'),
      icon: Server,
      accent: 'purple',
      apis: [
        { 
          name: t('integration.categories.orchestration.instances.name'), protocol: 'System', method: 'GET', path: '/v1/instances', 
          desc: t('integration.categories.orchestration.instances.desc'), accent: 'purple',
          headers: commonHeaders
        },
        { 
          name: t('integration.categories.orchestration.stop.name'), protocol: 'System', method: 'DELETE', path: '/v1/instances/:id', 
          desc: t('integration.categories.orchestration.stop.desc'), accent: 'rose',
          headers: commonHeaders
        },
        { 
          name: t('integration.categories.orchestration.config.name'), protocol: 'System', method: 'PATCH', path: '/v1/instances/config', 
          desc: t('integration.categories.orchestration.config.desc'), accent: 'indigo',
          headers: commonHeaders,
          payload: { max_concurrent_sessions: 10, log_level: "debug" }
        },
        { 
          name: t('integration.categories.orchestration.health.name'), protocol: 'System', method: 'GET', path: '/health', 
          desc: t('integration.categories.orchestration.health.desc'), accent: 'emerald',
          headers: {}
        }
      ]
    },
    {
      id: 'observability',
      title: t('integration.categories.observability.title'),
      subtitle: t('integration.categories.observability.subtitle'),
      icon: Activity,
      accent: 'indigo',
      apis: [
        { 
          name: t('integration.categories.observability.traffic.name'), protocol: 'System', method: 'GET', path: '/v1/monitor/stream', 
          desc: t('integration.categories.observability.traffic.desc'), accent: 'emerald',
          headers: { ...commonHeaders, 'Accept': 'text/event-stream' }
        },
        { 
          name: t('integration.categories.observability.logs.name'), protocol: 'System', method: 'GET', path: '/v1/logs/stream', 
          desc: t('integration.categories.observability.logs.desc'), accent: 'blue',
          headers: { ...commonHeaders, 'Accept': 'text/event-stream' }
        },
        { 
          name: t('integration.categories.observability.usage.name'), protocol: 'System', method: 'GET', path: '/v1/stats/summary', 
          desc: t('integration.categories.observability.usage.desc'), accent: 'purple',
          headers: commonHeaders
        },
        { 
          name: t('integration.categories.observability.hourly.name'), protocol: 'System', method: 'GET', path: '/v1/stats/hourly', 
          desc: t('integration.categories.observability.hourly.desc'), accent: 'indigo',
          headers: commonHeaders
        },
        { 
          name: t('integration.categories.observability.daily.name'), protocol: 'System', method: 'GET', path: '/v1/stats/daily', 
          desc: t('integration.categories.observability.daily.desc'), accent: 'blue',
          headers: commonHeaders
        },
        { 
          name: t('integration.categories.observability.accounts.name'), protocol: 'System', method: 'GET', path: '/v1/stats/accounts', 
          desc: t('integration.categories.observability.accounts.desc'), accent: 'indigo',
          headers: commonHeaders
        },
        { 
          name: t('integration.categories.observability.clear.name'), protocol: 'System', method: 'DELETE', path: '/v1/monitor/logs', 
          desc: t('integration.categories.observability.clear.desc'), accent: 'rose',
          headers: commonHeaders
        }
      ]
    },
    {
      id: 'security',
      title: t('integration.categories.security.title'),
      subtitle: t('integration.categories.security.subtitle'),
      icon: Key,
      accent: 'orange',
      apis: [
        { 
          name: t('integration.categories.security.keys.name'), protocol: 'System', method: 'GET', path: '/v1/keys', 
          desc: t('integration.categories.security.keys.desc'), accent: 'blue',
          headers: commonHeaders
        },
        { 
          name: t('integration.categories.security.create.name'), protocol: 'System', method: 'POST', path: '/v1/keys', 
          desc: t('integration.categories.security.create.desc'), accent: 'emerald',
          headers: commonHeaders,
          payload: { name: "System-Integration-Key", description: "Used by CI/CD" }
        },
        { 
          name: t('integration.categories.security.revoke.name'), protocol: 'System', method: 'DELETE', path: '/v1/keys/:key', 
          desc: t('integration.categories.security.revoke.desc'), accent: 'rose',
          headers: commonHeaders
        },
        { 
          name: t('integration.categories.security.sync.name'), protocol: 'System', method: 'POST', path: '/v1/provision/sync', 
          desc: t('integration.categories.security.sync.desc'), accent: 'slate',
          headers: commonHeaders
        },
        { 
          name: t('integration.categories.security.version.name'), protocol: 'System', method: 'GET', path: '/v1/version', 
          desc: t('integration.categories.security.version.desc'), accent: 'indigo',
          headers: commonHeaders
        }
      ]
    }
  ], [t, commonHeaders, defaultKey]);

  const authoritativeRecommendedIds = useMemo(() => {
    const ids = new Set();
    accounts.forEach(acc => {
      acc.quota?.agentModelSorts?.forEach(sort => {
        sort.groups?.forEach(group => {
          group.modelIds?.forEach(id => ids.add(id));
        });
      });
    });
    return ids;
  }, [accounts]);

  const allModels = useMemo(() => {
    const modelMap = new Map();

    accounts.forEach(acc => {
      acc.quota?.models?.forEach(m => {
        if (m.name.startsWith('chat_') || m.name.startsWith('tab_')) return;
        const existing = modelMap.get(m.name);
        let provider = 'Unknown';
        if (m.model_provider?.includes('GOOGLE')) provider = 'Google';
        else if (m.model_provider?.includes('ANTHROPIC')) provider = 'Anthropic';
        else if (m.model_provider?.includes('OPENAI')) provider = 'OpenAI';
        const capabilities = ['Chat'];
        if (m.supports_images) capabilities.push('Vision');
        if (m.supports_thinking) capabilities.push('Thinking');
        const isRecommended = authoritativeRecommendedIds.has(m.name);
        if (existing) {
          existing.count += 1;
          if (isRecommended) existing.recommended = true;
        } else {
          modelMap.set(m.name, {
            id: m.name,
            name: m.display_name || m.name,
            provider,
            capabilities,
            family: m.name.split('-')[0],
            count: 1,
            is_active: true,
            percentage: m.percentage || 0,
            recommended: isRecommended
          });
        }
      });
    });

    if (modelMap.size === 0) {
      FALLBACK_MODELS.forEach(model => {
        modelMap.set(model.id, {
          ...model,
          family: model.id.split('-')[0],
          count: 0,
          is_active: false,
          percentage: 0,
        });
      });
    }

    return Array.from(modelMap.values()).sort((a, b) => {
      if (a.recommended !== b.recommended) return b.recommended ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
  }, [accounts, authoritativeRecommendedIds]);

  const filteredModels = useMemo(() => 
    allModels.filter(m => 
      m.id.toLowerCase().includes(searchTerm.toLowerCase()) || 
      m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.provider.toLowerCase().includes(searchTerm.toLowerCase())
    ), [allModels, searchTerm]);

  const copyToClipboard = (text, field) => {
    if (!text || text === 'sk-antigravity-none-configure-one-first') {
      addToast(t('integration.copyError') || '请先配置通用密钥', 'error');
      return;
    }

    const performCopy = (txt) => {
      // 优先使用 Clipboard API
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(txt);
      }
      
      // 降级使用 TextArea 方案 (适用于一些限制环境或 localhost 之外的非安全环境)
      const el = document.createElement('textarea');
      el.value = txt;
      el.setAttribute('readonly', '');
      el.style.position = 'absolute';
      el.style.left = '-9999px';
      document.body.appendChild(el);
      el.select();
      const success = document.execCommand('copy');
      document.body.removeChild(el);
      return success ? Promise.resolve() : Promise.reject(new Error('ExecCommand fail'));
    };

    performCopy(text).then(() => {
      setCopiedField(field);
      addToast(t('integration.copiedSuccess') || '已成功复制到剪贴板', 'success');
      setTimeout(() => setCopiedField(null), 2000);
    }).catch(err => {
      console.error('Copy failed:', err);
      addToast(t('integration.copyFailed') || '复制失败，请重试', 'error');
    });
  };

  const getProviderStyle = (provider) => {
    switch(provider) {
      case 'Google': return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
      case 'Anthropic': return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
      case 'OpenAI': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      default: return 'bg-foreground/5 text-foreground/40 border-glass-border';
    }
  };

  return (
    <div ref={activeTab === 'guide' ? spotlightRef : spotlightModelsRef} className="space-y-8 fade-in relative min-h-screen pb-20 mt-4 px-2 spotlight-group">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-10">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
             <div className="p-2 bg-blue-600 rounded-lg shadow-[0_0_15px_rgba(37,99,235,0.4)]">
                <Globe className="w-5 h-5 text-white" />
             </div>
             <h1 className="text-2xl font-black italic tracking-tighter uppercase">{t('integration.title')} <span className="text-foreground/20">{t('integration.subtitle')}</span></h1>
          </div>
          <p className="text-[10px] font-black text-foreground/45 uppercase tracking-[0.4em] mt-1 pl-1">{t('integration.desc')}</p>
        </div>

        <div className="flex bg-foreground/[0.03] border border-glass-border p-1 rounded-full overflow-hidden shadow-inner">
          <button onClick={() => setActiveTab('guide')} className={`px-8 py-2 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'guide' ? 'btn-matrix-pill-active' : 'btn-matrix-pill-inactive'}`}>{t('integration.guideTab')}</button>
          <button onClick={() => setActiveTab('models')} className={`px-8 py-2 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'models' ? 'btn-matrix-pill-active' : 'btn-matrix-pill-inactive'}`}>{t('integration.modelsTab')}</button>
        </div>
      </div>

      {activeTab === 'guide' ? (
        <div className="space-y-12 animate-in slide-in-from-bottom-2 duration-500">
          {/* Global Configuration Section */}
          <div className="glass-card spotlight-card rounded-[2rem] p-8 relative overflow-hidden group border-glass-border bg-foreground/[0.01]">
            <div className="grain-overlay" />
            <div className="absolute -right-20 -top-20 w-80 h-80 bg-blue-600/5 blur-[120px] rounded-full pointer-events-none"></div>
            <div className="flex items-center gap-4 mb-10">
              <div className="flex flex-col">
                <span className="text-[9px] font-black text-blue-500/60 uppercase tracking-[0.4em] mb-1">{t('integration.globalConfig')}</span>
                <div className="text-lg font-black italic tracking-tight">{t('integration.apiBaseUrl')}</div>
              </div>
              <div className="h-px flex-1 bg-foreground/[0.05]"></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-4">
                <div className="flex items-center justify-between px-1">
                  <label className="text-[10px] font-black text-foreground/50 uppercase tracking-[0.3em]">{t('integration.apiBaseUrl')}</label>
                  <span className="text-[9px] font-bold text-emerald-500/40 uppercase tracking-widest flex items-center gap-1"><ShieldCheck className="w-3 h-3" /> {t('integration.sslActive')}</span>
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-3 bg-background/40 border border-white/[0.05] rounded-2xl px-5 py-4 group/field hover:border-blue-500/30 transition-all cursor-pointer" onClick={() => copyToClipboard(apiUrl, 'url')}>
                    <code className="text-sm font-mono text-blue-400 font-bold truncate flex-1">{apiUrl}</code>
                    <button className={`p-2 rounded-lg transition-all ${copiedField === 'url' ? 'bg-emerald-500 text-white' : 'bg-foreground/5 text-foreground/40 hover:text-foreground'}`}>
                      {copiedField === 'url' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="px-2 text-[9px] font-bold text-foreground/45 italic tracking-tight">Backend: 5173 | Dashboard Path: /</p>
                </div>
              </div>
              <div className="space-y-4">
                <div className="flex items-center justify-between px-1">
                  <label className="text-[10px] font-black text-foreground/50 uppercase tracking-[0.3em]">{t('integration.universalKey')}</label>
                  <div className="flex items-center gap-3">
                    <button onClick={() => setShowKey(!showKey)} className="text-[9px] font-bold text-blue-500/60 uppercase tracking-widest flex items-center gap-1 hover:text-blue-500 transition-colors">
                      {showKey ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                      {showKey ? 'Hide' : 'Show'} Key
                    </button>
                    <span className="text-[9px] font-bold text-blue-500/40 uppercase tracking-widest flex items-center gap-1"><Clock className="w-3 h-3" /> {t('integration.jwtActive')}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3 bg-background/40 border border-white/[0.05] rounded-2xl px-5 py-4 group/field hover:border-blue-500/30 transition-all cursor-pointer" onClick={() => copyToClipboard(defaultKey, 'key')}>
                  <code className="text-sm font-mono text-foreground/65 truncate flex-1 italic">{showKey ? defaultKey : maskedKey}</code>
                  <button 
                    onClick={(e) => { e.stopPropagation(); copyToClipboard(defaultKey, 'key'); }}
                    className={`p-2 rounded-lg transition-all ${copiedField === 'key' ? 'bg-emerald-500 text-white' : 'bg-foreground/5 text-foreground/40 hover:text-foreground'}`}
                  >
                    {copiedField === 'key' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Categorized API Matrix */}
          {allApiCategories.map((category) => (
            <div key={category.id} className="space-y-4">
              <div className="flex items-center gap-4 px-2">
                <div className="p-1.5 bg-foreground/5 rounded-lg border border-glass-border group-hover:bg-blue-500/20 transition-all">
                  <category.icon className={`w-4 h-4 text-${category.accent}-400`} />
                </div>
                <div className="flex flex-col">
                  <span className={`text-[9px] font-black text-${category.accent}-500/60 uppercase tracking-[0.4em] mb-0.5`}>{category.title}</span>
                  <div className="text-[14px] font-black italic tracking-tight text-foreground/80">{category.subtitle}</div>
                </div>
                <div className="h-px flex-1 bg-foreground/[0.05]"></div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {category.apis.map((api) => (
                  <div key={api.path + api.method} onClick={() => setSelectedApi(api)} className="glass-card spotlight-card rounded-2xl p-5 border-glass-border bg-foreground/[0.01] hover:bg-foreground/[0.03] transition-all group/item flex flex-col justify-between h-full min-h-[160px] cursor-pointer relative overflow-hidden">
                    <div className="grain-overlay" />
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-black italic text-foreground/90 uppercase truncate max-w-[120px]">{api.name}</span>
                          <div className={`px-1.5 py-0.5 rounded-[3px] bg-${category.accent}-500/10 border border-${category.accent}-500/20 text-[7px] font-black text-${category.accent}-400 uppercase tracking-widest`}>
                            {api.protocol}
                          </div>
                        </div>
                        <div className={`px-1.5 py-0.5 rounded-md bg-background/40 border border-glass-border text-[8px] font-black font-mono tracking-tighter ${
                          api.method === 'POST' ? 'text-blue-400' : 
                          api.method === 'DELETE' ? 'text-rose-400' :
                          api.method === 'PATCH' ? 'text-indigo-400' :
                          'text-emerald-400'
                        }`}>
                          {api.method}
                        </div>
                      </div>
                      <p className="text-[10px] text-foreground/50 font-bold leading-relaxed line-clamp-2">{api.desc}</p>
                    </div>

                    <div className="mt-4 flex items-center justify-between">
                       <code className="text-[9px] text-foreground/60 font-mono truncate">{api.path}</code>
                       <div className="p-1 px-2 rounded-md bg-foreground/5 text-[8px] font-black uppercase tracking-tighter text-foreground/40 group-hover/item:text-blue-500 transition-all">{t('integration.viewDocs')}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* API Detail Modal */}
          {selectedApi && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/80 backdrop-blur-md animate-in fade-in duration-300">
               <div className="glass-card w-full max-w-4xl max-h-[90vh] rounded-[2.5rem] border border-glass-border flex flex-col shadow-[0_0_100px_rgba(37,99,235,0.15)] overflow-hidden">
                  <div className="p-8 border-b border-glass-border flex items-center justify-between bg-foreground/[0.02]">
                     <div className="flex items-center gap-4">
                        <div className={`p-3 rounded-2xl bg-${selectedApi.accent}-500/10 border border-${selectedApi.accent}-500/20 text-${selectedApi.accent}-400`}>
                           <Globe className="w-6 h-6" />
                        </div>
                        <div className="flex flex-col">
                           <div className="flex items-center gap-2">
                              <h2 className="text-xl font-black italic tracking-tighter uppercase">{selectedApi.name}</h2>
                              <span className={`px-2 py-0.5 rounded-md bg-background/60 border border-glass-border text-[10px] font-black font-mono ${selectedApi.method === 'POST' ? 'text-blue-400' : 'text-emerald-400'}`}>{selectedApi.method}</span>
                           </div>
                           <p className="text-[10px] font-bold text-foreground/55 tracking-widest uppercase mt-1">{selectedApi.desc}</p>
                        </div>
                     </div>
                     <button onClick={() => setSelectedApi(null)} className="p-3 rounded-full bg-foreground/5 hover:bg-foreground/10 text-foreground/40 hover:text-foreground transition-all">
                        <X className="w-5 h-5" />
                     </button>
                  </div>

                  <div className="flex-1 overflow-y-auto p-8 space-y-8 scrollbar-hide">
                     <div className="space-y-4">
                        <div className="flex items-center justify-between px-1">
                           <span className="text-[10px] font-black text-foreground/45 uppercase tracking-[0.4em]">{t('integration.requestEndpoint')}</span>
                        </div>
                        <div className="flex items-center gap-3 bg-background/60 border border-glass-border rounded-2xl px-6 py-4">
                           <code className="text-sm font-mono text-blue-400 font-bold flex-1">{baseUrl}{selectedApi.path}</code>
                           <button onClick={() => copyToClipboard(baseUrl + selectedApi.path, 'endpoint')} className={`p-2 rounded-lg transition-all ${copiedField === 'endpoint' ? 'bg-emerald-500 text-white' : 'bg-foreground/5 text-foreground/40 hover:text-foreground'}`}>
                               {copiedField === 'endpoint' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                           </button>
                        </div>
                     </div>

                     <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="space-y-4">
                           <div className="flex items-center gap-2 px-1">
                              <Shield className="w-3 h-3 text-orange-400" />
                               <span className="text-[10px] font-black text-foreground/45 uppercase tracking-[0.4em]">{t('integration.requiredHeaders')}</span>
                           </div>
                           <div className="relative group">
                              <pre className="bg-background/60 border border-glass-border rounded-2xl p-6 text-[11px] font-mono leading-relaxed text-foreground/60 overflow-hidden whitespace-pre-wrap">
                                 {JSON.stringify(selectedApi.headers || commonHeaders, null, 2).replace(new RegExp(defaultKey, 'g'), showKey ? defaultKey : maskedKey)}
                              </pre>
                              <button onClick={() => copyToClipboard(JSON.stringify(selectedApi.headers || commonHeaders, null, 2), 'headers')} className="absolute top-4 right-4 p-2 rounded-lg bg-foreground/5 text-foreground/20 hover:text-foreground opacity-0 group-hover:opacity-100 transition-all">
                                 <Copy className="w-4 h-4" />
                              </button>
                           </div>
                        </div>

                        {selectedApi.payload && (
                           <div className="space-y-4">
                              <div className="flex items-center gap-2 px-1">
                                 <FileJson className="w-3 h-3 text-emerald-400" />
                                  <span className="text-[10px] font-black text-foreground/45 uppercase tracking-[0.4em]">{t('integration.payloadExample')}</span>
                              </div>
                              <div className="relative group">
                                 <pre className="bg-background/60 border border-glass-border rounded-2xl p-6 text-[11px] font-mono leading-relaxed text-blue-400/80 overflow-hidden whitespace-pre-wrap">
                                    {JSON.stringify(selectedApi.payload, null, 2)}
                                 </pre>
                                 <button onClick={() => copyToClipboard(JSON.stringify(selectedApi.payload, null, 2), 'payload')} className="absolute top-4 right-4 p-2 rounded-lg bg-foreground/5 text-foreground/20 hover:text-foreground opacity-0 group-hover:opacity-100 transition-all">
                                    <Copy className="w-4 h-4" />
                                 </button>
                              </div>
                           </div>
                        )}
                     </div>

                     <div className="space-y-4">
                        <div className="flex items-center gap-2 px-1">
                           <Terminal className="w-3 h-3 text-blue-400" />
                            <span className="text-[10px] font-black text-foreground/45 uppercase tracking-[0.4em]">{t('integration.curlOneLiner')}</span>
                        </div>
                        <div className="relative group">
                           <div className="bg-blue-600/5 border border-blue-500/20 rounded-2xl p-6 font-mono text-[11px] leading-relaxed break-all text-blue-400 pr-12">
                              {`curl -X ${selectedApi.method} "${baseUrl}${selectedApi.path}" \\
  -H "Authorization: Bearer ${showKey ? defaultKey : maskedKey}" \\
  -H "Content-Type: application/json" ${selectedApi.payload ? `\\
  -d '${JSON.stringify(selectedApi.payload)}'` : ''}`}
                           </div>
                           <button onClick={() => copyToClipboard(`curl -X ${selectedApi.method} "${baseUrl}${selectedApi.path}" -H "Authorization: Bearer ${defaultKey}" -H "Content-Type: application/json" ${selectedApi.payload ? `-d '${JSON.stringify(selectedApi.payload)}'` : ''}`, 'curl')} className="absolute top-1/2 -translate-y-1/2 right-4 p-3 rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-600/20 hover:scale-105 transition-all">
                              <Copy className="w-4 h-4" />
                           </button>
                        </div>
                     </div>
                  </div>

                  <div className="p-6 bg-foreground/[0.02] border-t border-glass-border text-center">
                     <p className="text-[9px] font-bold text-foreground/45 uppercase tracking-[0.3em]">{t('app.title')} {t('app.subtitle')} Core v0.0.1</p>
                  </div>
               </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-6 animate-in slide-in-from-bottom-2 duration-500">
           <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-foreground/[0.02] border border-glass-border p-4 rounded-3xl">
              <div className="relative group w-full md:w-96">
                 <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/45 group-focus-within:text-blue-500 transition-colors" />
                <input type="text" placeholder={t('integration.searchModels')} className="w-full bg-foreground/[0.03] border border-glass-border px-12 py-3 rounded-2xl text-[12px] font-bold outline-none focus:border-blue-500/50 transition-all font-mono" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
              </div>
              <div className="flex items-center gap-6 px-4">
                  <div className="flex flex-col items-end"><span className="text-[9px] font-black text-foreground/45 uppercase tracking-widest">{t('integration.availableUnits')}</span><span className="text-sm font-black italic">{allModels.length} MATRIX UNITS</span></div>
                 <div className="h-8 w-px bg-foreground/10"></div>
                  <div className="flex flex-col items-end"><span className="text-[9px] font-black text-foreground/45 uppercase tracking-widest">{t('integration.activeProviders')}</span><span className="text-sm font-black italic text-blue-500 uppercase">{[...new Set(allModels.map(m => m.provider))].length} GROUPS</span></div>
              </div>
           </div>

           <div className="bg-foreground/[0.01] border border-glass-border rounded-[2.5rem] overflow-hidden shadow-2xl relative">
               <div className="flex items-center px-8 py-4 bg-foreground/[0.02] border-b border-glass-border text-[10px] font-black uppercase tracking-[0.25em] text-foreground/60">
                <div className="w-[50%]">{t('integration.matrixUnits')}</div>
                <div className="w-[30%]">{t('integration.activeProvidersHeader')}</div>
                <div className="w-[20%] text-right pr-4">{t('integration.copyIdHeader')}</div>
              </div>

              <div className="flex flex-col min-h-[500px]">
                {searchTerm ? (
                  filteredModels.map(m => (
                    <ModelRow key={m.id} m={m} getProviderStyle={getProviderStyle} copyToClipboard={copyToClipboard} copiedField={copiedField} />
                  ))
                ) : (
                  <>
                    {/* 核心资产单元 (Recommended) */}
                    {filteredModels.filter(m => m.recommended).length > 0 && (
                       <>
                         <div className="px-8 py-3 bg-blue-500/[0.03] flex items-center gap-4 border-b border-glass-border">
                            <span className="text-[9px] font-black uppercase tracking-[0.4em] text-foreground/45 whitespace-nowrap">{t('integration.coreAssets')}</span>
                            <div className="h-px flex-1 bg-foreground/[0.03]"></div>
                         </div>
                         {filteredModels.filter(m => m.recommended).map(m => (
                            <ModelRow key={m.id} m={m} getProviderStyle={getProviderStyle} copyToClipboard={copyToClipboard} copiedField={copiedField} />
                         ))}
                       </>
                    )}
                    
                    {/* 基础设施单元 (Other) */}
                    {filteredModels.filter(m => !m.recommended).length > 0 && (
                       <>
                         <div className="px-8 py-3 bg-foreground/[0.005] flex items-center gap-4 border-b border-glass-border mt-10">
                            <span className="text-[9px] font-black uppercase tracking-[0.4em] text-foreground/45 whitespace-nowrap">{t('integration.infrastructure')}</span>
                            <div className="h-px flex-1 bg-foreground/[0.01]"></div>
                         </div>
                         {filteredModels.filter(m => !m.recommended).map(m => (
                            <ModelRow key={m.id} m={m} getProviderStyle={getProviderStyle} copyToClipboard={copyToClipboard} copiedField={copiedField} />
                         ))}
                       </>
                    )}
                  </>
                )}
                
                {filteredModels.length === 0 && (
                  <div className="flex-1 flex flex-col items-center justify-center py-40 opacity-10">
                    <Activity className="w-20 h-20 mb-4 animate-pulse" />
                    <span className="text-sm font-black uppercase tracking-[1em]">{t('keys.empty') || 'MATRIX EMPTY'}</span>
                  </div>
                )}
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

const ModelRow = ({ m, getProviderStyle, copyToClipboard, copiedField }) => {
  const { t } = useTranslation();
  return (
    <div className="group spotlight-card flex items-center px-8 py-5 border-b border-glass-border hover:bg-foreground/[0.03] transition-all group/row relative overflow-hidden" onClick={() => copyToClipboard(m.id, m.id)}>
      <div className="grain-overlay" />
      <div className="w-[50%] flex items-center gap-4">
        <div className={`shrink-0 p-2.5 rounded-xl border transition-all ${getProviderStyle(m.provider)}`}>
          <Cpu className="w-5 h-5 transition-transform group-hover/row:scale-110" />
        </div>
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2">
             <span className="text-[14px] font-black text-foreground/90 truncate italic tracking-tight group-hover:text-blue-400 transition-colors uppercase">{m.name}</span>
             {m.recommended && <span className="px-1.5 py-0.5 rounded-[3px] bg-blue-500 text-white text-[7px] font-black uppercase tracking-tighter shadow-[0_0_100px_rgba(37,99,235,0.4)]">{t('integration.core')}</span>}
          </div>
          <div className="flex items-center gap-1.5 mt-1.5">
             <code className="text-[11px] text-blue-400/80 font-mono font-bold tracking-tight bg-blue-500/5 px-2 py-0.5 rounded-md border border-blue-500/10 group-hover/row:text-blue-400 transition-colors">{m.id}</code>
          </div>
        </div>
      </div>

      <div className="w-[30%]">
         <span className={`px-2.5 py-1 rounded-full border text-[9px] font-black uppercase tracking-widest ${getProviderStyle(m.provider)}`}>
           {m.provider}
         </span>
      </div>

      <div className="w-[20%] text-right flex justify-end">
        <button className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border ${copiedField === m.id ? 'bg-emerald-500 border-emerald-500 text-white' : 'bg-foreground/5 border-glass-border text-foreground/30 group-hover/row:bg-blue-600 group-hover/row:text-white group-hover/row:border-blue-500 shadow-xl'}`}>
          {copiedField === m.id ? t('integration.copied') : t('integration.copyId')}
        </button>
      </div>
    </div>
  );
};

export default Integration;
