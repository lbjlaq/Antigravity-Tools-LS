import React, { useState, useEffect } from 'react';
import { useSpotlight } from '../hooks/useSpotlight';
import {
  Globe,
  RefreshCw,
  HardDrive,
  Package,
  CheckCircle2,
  XCircle,
  Download,
  Cpu,
  Zap,
  Save,
  AlertTriangle,
  ArrowUpCircle,
  Loader2,
  ShieldCheck,
  Activity,
  History,
  Layers,
  Plus,
  Minus,
  Clock8,
  Command,
  Settings as SettingsIcon,
  ChevronRight,
  Shield,
} from 'lucide-react';
import useSettingsStore from '../store/useSettingsStore';
import useAppStore from '../store/useAppStore';
import i18n from '../i18n/config';
import { useTranslation } from 'react-i18next';
import { isTauri, resolveApiBaseUrl, resolveBackendOrigin } from '../api/client';
import { settingsService } from '../api/services/settings';
import {
  createSettingsBaseline,
  DEFAULT_LOCAL_SETTINGS,
  getVisibleSettings,
  updateSettingsDraft,
} from './settingsDraftState';

// ─── Tab 定义 ─────────────────────────────────────────────────────────────────
const getTabs = (t) => [
  { id: 'appearance', icon: Globe,      label: t('settings.appearance') },
  { id: 'refresh',   icon: RefreshCw,   label: t('settings.quotaStatus') },
  { id: 'logs',      icon: HardDrive,   label: t('settings.logs') },
  { id: 'ide',       icon: Command,     label: t('settings.ide') },
  { id: 'assets',    icon: Package,     label: t('settings.assets') },
];

// ─── 通用二级标题 (Compact) ───────────────────────────────────────────────────
const SectionHeader = ({ title, subtitle, accent = "blue" }) => (
  <div className="flex items-center gap-3 mb-5 px-1">
    <div className="flex flex-col">
      <span className={`text-[9.5px] font-black text-${accent}-500/80 uppercase tracking-[0.4em] mb-0.5`}>{title}</span>
      <div className="text-lg font-black italic tracking-tight text-foreground/95">{subtitle}</div>
    </div>
    <div className="h-px flex-1 bg-glass-border"></div>
  </div>
);

// ─── 通用卡片组件 (Glass Card Compact) ────────────────────────────────────────
const SettingsCard = ({ children, className = "" }) => (
  <div className={`glass-card spotlight-card rounded-2xl p-6 border-glass-border bg-foreground/[0.01] hover:bg-foreground/[0.02] transition-all duration-500 group relative overflow-hidden ${className}`}>
    <div className="grain-overlay" />
    <div className="absolute -right-20 -top-20 w-80 h-80 bg-blue-600/5 blur-[120px] rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-1000" />
    <div className="relative z-10">
      {children}
    </div>
  </div>
);

// ─── Number Input (Industrial Style Compact) ──────────────────────────────────
const MinuteInput = ({ value, onChange, label, sublabel, min = 1, max = 10080 }) => {
  const { t } = useTranslation();
  const handleInc = () => onChange(Math.min(max, value + 1));
  const handleDec = () => onChange(Math.max(min, value - 1));
  
  const formatDisplay = (m) => {
    const val = parseInt(m) || 0;
    if (val < 60) return `${val}M`;
    const h = Math.floor(val / 60);
    const mm = val % 60;
    return mm === 0 ? `${h}H` : `${h}H ${mm}M`;
  };

  return (
    <div className="space-y-3.5">
      <div className="flex items-center justify-between px-1">
        <label className="text-[10px] font-black text-foreground/65 uppercase tracking-[0.2em]">{label}</label>
        <span className="text-[9px] font-bold text-blue-400 uppercase tracking-widest flex items-center gap-1 bg-blue-500/10 px-2 py-0.5 rounded-md border border-blue-500/20">
          <Clock8 className="w-2.5 h-2.5" /> {formatDisplay(value)}
        </span>
      </div>
      <div className="flex items-center gap-2.5">
        <button onClick={handleDec} className="p-2.5 rounded-xl bg-foreground/5 border border-glass-border text-foreground/60 hover:text-foreground hover:bg-foreground/15 transition-all active:scale-95 shadow-md">
          <Minus className="w-4 h-4" />
        </button>
        <div className="flex-1 relative group/input">
          <input
            type="number"
            value={value}
            onChange={(e) => {
              const v = parseInt(e.target.value);
              if (!isNaN(v)) onChange(v);
            }}
            className="w-full bg-background/50 border border-glass-border rounded-xl py-3 pr-16 pl-8 text-sm font-mono font-black text-blue-400 focus:outline-none focus:border-blue-500/40 transition-all text-center"
          />
          <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[9px] font-black text-foreground/45 uppercase tracking-widest pointer-events-none group-focus-within/input:text-blue-500/60 transition-colors">{t('settings.mins')}</div>
        </div>
        <button onClick={handleInc} className="p-2.5 rounded-xl bg-foreground/5 border border-glass-border text-foreground/60 hover:text-foreground hover:bg-foreground/15 transition-all active:scale-95 shadow-md">
          <Plus className="w-4 h-4" />
        </button>
      </div>
      {sublabel && <p className="text-[10px] text-foreground/60 font-medium leading-relaxed pl-1">{sublabel}</p>}
    </div>
  );
};

// ─── Toggle (Pill Style Compact) ──────────────────────────────────────────────
const Toggle = ({ checked, onChange, label, description }) => (
  <div className="flex items-center justify-between gap-6 group/toggle px-1">
    <div className="flex flex-col gap-0.5">
      <p className="text-sm font-black italic tracking-tight text-foreground">{label}</p>
      {description && <p className="text-[9px] font-black text-foreground/60 uppercase tracking-widest leading-relaxed">{description}</p>}
    </div>
    <button
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition-all duration-500 flex-shrink-0 ${
        checked ? 'bg-blue-600 shadow-[0_0_15px_rgba(37,99,235,0.4)] border-blue-400/20' : 'bg-foreground/10 border border-glass-border'
      }`}
    >
      <div className={`absolute top-1 w-4 h-4 rounded-full transition-all duration-500 ease-out-back shadow-md ${
        checked ? 'left-6 bg-white scale-110' : 'left-1 bg-foreground/30 scale-90'
      }`} />
    </button>
  </div>
);

const getPortFromOrigin = (origin) => {
  if (!origin) return '';
  try {
    const url = new URL(origin);
    if (url.port) return url.port;
    return url.protocol === 'https:' ? '443' : '80';
  } catch {
    return '';
  }
};

// ─── 具体面板内容 ─────────────────────────────────────────────────────────────
const AppearanceTab = () => {
  const { t } = useTranslation();
  const { language, setLanguage, theme, toggleTheme } = useAppStore();
  return (
    <div className="space-y-8 animate-in slide-in-from-bottom-2 duration-500">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SettingsCard>
          <SectionHeader title={t('settings.languageTitle')} subtitle={t('settings.languageSubtitle')} icon={Globe} />
          <div className="space-y-4">
            <p className="text-xs text-foreground/65 leading-relaxed italic tracking-wide">{t('settings.languageDesc')}</p>
            <div className="flex bg-background/40 border border-glass-border p-1 rounded-xl">
              {[{ v: 'zh', l: '中文' }, { v: 'en', l: 'English' }].map(o => (
                <button key={o.v} onClick={() => { setLanguage(o.v); i18n.changeLanguage(o.v); }}
                  className={`flex-1 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all duration-500 ${
                    language === o.v 
                      ? 'btn-matrix-pill-active scale-[1.02]' 
                      : 'btn-matrix-pill-inactive hover:bg-foreground/[0.05]'
                  }`}>{o.l}</button>
              ))}
            </div>
          </div>
        </SettingsCard>
        
        <SettingsCard>
          <SectionHeader title={t('settings.themeTitle')} subtitle={t('settings.themeSubtitle')} icon={Layers} accent="indigo" />
          <div className="space-y-4">
            <p className="text-xs text-foreground/65 leading-relaxed italic tracking-wide">{t('settings.themeDesc')}</p>
            <div className="bg-background/40 border border-glass-border p-4 rounded-xl">
               <Toggle
                  checked={theme === 'dark'}
                  onChange={toggleTheme}
                  label={t('settings.darkMode')}
                  description={t('settings.darkModeDesc')}
               />
            </div>
          </div>
        </SettingsCard>
      </div>
    </div>
  );
};

const RefreshTab = ({ local, setLocal }) => {
  const { t } = useTranslation();
  return (
    <div className="space-y-8 animate-in slide-in-from-bottom-2 duration-500">
       <SettingsCard>
          <SectionHeader title={t('settings.provisionTitle')} subtitle={t('settings.quotaStatus')} icon={RefreshCw} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
             <div className="space-y-6">
                <div className="bg-background/40 border border-glass-border p-6 rounded-2xl">
                   <Toggle
                      checked={local.auto_refresh_quota}
                      onChange={v => setLocal(s => ({ ...s, auto_refresh_quota: v }))}
                      label={t('settings.autoRefresh')}
                      description={t('settings.syncWithGoogle')}
                   />
                </div>
                <div className="flex items-start gap-3 p-4 rounded-xl bg-blue-500/5 border border-blue-500/10 border-dashed">
                   <Zap className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                   <p className="text-[10px] text-foreground/55 leading-relaxed">
                     {t('settings.refreshDesc')}
                   </p>
                </div>
             </div>
             
             <div className={`${local.auto_refresh_quota ? 'opacity-100' : 'opacity-20 grayscale pointer-events-none'} transition-all duration-500`}>
                <div className="bg-background/60 border border-glass-border p-6 rounded-[1.5rem] shadow-xl">
                   <MinuteInput
                      label={t('settings.refreshInterval')}
                      sublabel={t('settings.refreshIntervalDesc')}
                      value={local.auto_refresh_interval_minutes}
                      onChange={v => setLocal(s => ({ ...s, auto_refresh_interval_minutes: v }))}
                      t={t}
                   />
                </div>
             </div>
          </div>
       </SettingsCard>
    </div>
  );
};

const LogsTab = ({ local, setLocal }) => {
  const { t } = useTranslation();
  return (
    <div className="space-y-8 animate-in slide-in-from-bottom-2 duration-500">
      <SettingsCard>
         <SectionHeader title={t('settings.retentionTitle')} subtitle={t('settings.retentionSubtitle')} icon={History} accent="emerald" />
         <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-4">
               <p className="text-[13px] font-black italic text-foreground leading-relaxed">
                 {t('settings.retentionDesc')}
               </p>
               <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1.5 text-emerald-500/60">
                     <ShieldCheck className="w-3.5 h-3.5" />
                     <span className="text-[9px] font-black uppercase tracking-widest">{t('settings.optimizedStorage')}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-blue-500/60">
                     <Activity className="w-3.5 h-3.5" />
                     <span className="text-[9px] font-black uppercase tracking-widest">{t('settings.autoClean')}</span>
                  </div>
               </div>
            </div>
            
            <div className="bg-background/40 border border-glass-border p-5 rounded-2xl">
               <span className="text-[9px] font-black text-foreground/45 uppercase tracking-[0.3em] mb-4 block text-center">{t('settings.retentionLabel')}</span>
               <div className="grid grid-cols-2 gap-2">
                  {[7,14,30,90].map(n => (
                    <button
                      key={n}
                      onClick={() => setLocal(s => ({ ...s, traffic_log_retention_days: n }))}
                      className={`py-2.5 rounded-lg text-[10px] font-black transition-all duration-500 ${
                        local.traffic_log_retention_days === n 
                          ? 'bg-emerald-600 text-white shadow-lg' 
                          : 'bg-foreground/5 text-foreground/55 border border-glass-border hover:text-foreground/80'
                      }`}
                    >{n}D</button>
                  ))}
               </div>
            </div>
         </div>
      </SettingsCard>
    </div>
  );
};

const AssetsTab = ({ provisionStatus, versionInfo, isSyncing, onSync, local, setLocal }) => {
  const { t } = useTranslation();
  const [syncMsg, setSyncMsg] = useState(null);
  const { syncProgress, setSyncProgress } = useAppStore();
  
  const remoteVer = versionInfo?.remote_latest_version;
  const simVer    = versionInfo?.simulated_version;
  const localVer  = versionInfo?.local_app_version;
  const hasUpdate = remoteVer && simVer && remoteVer !== simVer;

  const handleSync = async (src) => {
    setSyncMsg(null);
    setSyncProgress({ loading: true, percent: 0, stage: 'requesting', message: '正在初始化...' });
    
    // 建立 SSE 监听
    const { fetchProvisionStatus, fetchVersionInfo } = useSettingsStore.getState();
    const apiBaseUrl = await resolveApiBaseUrl();
    const eventSource = new EventSource(apiBaseUrl + '/provision/progress');
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setSyncProgress({ 
        percent: data.percent, 
        stage: data.stage, 
        message: data.message 
      });
      
      if (data.stage === 'completed' || data.stage === 'error') {
        eventSource.close();
        // 无论成功还是错误，最终都要回收加载状态 [FIX]
        if (data.stage === 'completed') {
           // 成功后立即触发全局数据刷新，确保版本号等信息同步更新 [NEW]
           fetchProvisionStatus();
           fetchVersionInfo();
           setTimeout(() => setSyncProgress({ loading: false }), 2000);
        } else {
           setSyncProgress({ loading: false });
        }
      }
    };
    eventSource.onerror = () => {
      eventSource.close();
      setSyncProgress({ loading: false });
    };

    try {
      const r = await onSync(src);
      if (!r?.success && r?.message) {
         setSyncMsg({ ok: false, text: r.message });
      }
    } catch (e) {
      setSyncMsg({ ok: false, text: t('settings.syncFailed') + e.message });
      setSyncProgress({ loading: false });
    }
  };

  return (
    <div className="space-y-8 animate-in slide-in-from-bottom-2 duration-500">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        <SettingsCard>
          <SectionHeader title={t('settings.provisionTitle')} subtitle={t('settings.provisionSubtitle')} icon={ShieldCheck} />
          <div className="space-y-6">
            <div className="bg-background/40 border border-glass-border p-6 rounded-2xl">
              <Toggle
                checked={local.auto_sync_assets}
                onChange={v => setLocal(s => ({ ...s, auto_sync_assets: v }))}
                label={t('settings.autoSyncAssets')}
                description={t('settings.assetsAutoSync')}
              />
            </div>
            
            <div className={`${local.auto_sync_assets ? 'opacity-100' : 'opacity-10 pointer-events-none'} transition-all duration-500`}>
              <MinuteInput
                label={t('settings.syncInterval')}
                sublabel={t('settings.syncIntervalDesc')}
                value={local.auto_sync_interval_minutes}
                onChange={v => setLocal(s => ({ ...s, auto_sync_interval_minutes: v }))}
                t={t}
              />
            </div>
          </div>
        </SettingsCard>

        <SettingsCard>
          <SectionHeader title={t('settings.envTitle')} subtitle={t('settings.envSubtitle')} icon={Activity} accent="indigo" />
          <div className="space-y-6">
            <div className="bg-background/40 border border-glass-border rounded-2xl overflow-hidden divide-y divide-glass-border">
              <div className="flex items-center justify-between p-4 px-6 group/row">
                <span className="text-[10px] text-foreground/65 font-black uppercase tracking-[0.3em]">{t('settings.projectVersion')}</span>
                <span className="text-xs font-mono font-black text-foreground/90 italic">{simVer}</span>
              </div>
              <div className="flex items-center justify-between p-4 px-6 group/row">
                <span className="text-[10px] text-foreground/65 font-black uppercase tracking-[0.3em]">{t('settings.appBinary')}</span>
                <span className="text-xs font-mono font-black text-foreground/90 italic">{localVer}</span>
              </div>
              <div className="flex items-center justify-between p-4 px-6 group/row">
                <span className="text-[10px] text-foreground/65 font-black uppercase tracking-[0.3em]">{t('settings.networkAuth')}</span>
                <div className="flex items-center gap-2">
                   {hasUpdate && <div className="w-1 h-1 rounded-full bg-amber-500 animate-ping" />}
                   <span className={`text-xs font-mono font-black ${hasUpdate ? 'text-amber-400' : 'text-foreground/60'}`}>{remoteVer}</span>
                </div>
              </div>
            </div>
            
            <div className="pt-2">
              <span className="text-[10px] font-black text-foreground/50 uppercase tracking-[0.3em] mb-4 block">{t('settings.integrityMatrix')}</span>
              <div className="grid grid-cols-2 gap-3">
                 <div className={`flex flex-col gap-2 p-4 rounded-xl border transition-all duration-500 ${provisionStatus?.ls_core_exists ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-400' : 'bg-rose-500/10 border-rose-500/30 text-rose-500 animate-[pulse_2s_infinite]'}`}>
                    <div className="flex items-center justify-between">
                       <span className="text-[9px] font-black uppercase tracking-[0.2em]">{t('settings.binaryCore')}</span>
                       {provisionStatus?.ls_core_exists ? <ShieldCheck className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5 animate-bounce" />}
                    </div>
                    <div className="flex items-center gap-2">
                       <div className={`w-1.5 h-1.5 rounded-full ${provisionStatus?.ls_core_exists ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'bg-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.8)]'}`} />
                       <span className={`text-[10px] font-bold ${provisionStatus?.ls_core_exists ? 'opacity-60' : 'opacity-100 uppercase tracking-widest'}`}>
                          {provisionStatus?.ls_core_exists ? t('dashboard.optimal') : t('dashboard.degraded')}
                       </span>
                    </div>
                 </div>
                 <div className={`flex flex-col gap-2 p-4 rounded-xl border transition-all duration-500 ${provisionStatus?.cert_pem_exists ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-400' : 'bg-rose-500/10 border-rose-500/30 text-rose-500 animate-[pulse_2s_infinite]'}`}>
                    <div className="flex items-center justify-between">
                       <span className="text-[9px] font-black uppercase tracking-[0.2em]">{t('settings.tlsKeychain')}</span>
                       {provisionStatus?.cert_pem_exists ? <ShieldCheck className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5 animate-bounce" />}
                    </div>
                    <div className="flex items-center gap-2">
                       <div className={`w-1.5 h-1.5 rounded-full ${provisionStatus?.cert_pem_exists ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'bg-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.8)]'}`} />
                       <span className={`text-[10px] font-bold ${provisionStatus?.cert_pem_exists ? 'opacity-60' : 'opacity-100 uppercase tracking-widest'}`}>
                          {provisionStatus?.cert_pem_exists ? t('dashboard.optimal') : t('dashboard.degraded')}
                       </span>
                    </div>
                 </div>
              </div>
            </div>
          </div>
        </SettingsCard>
      </div>

      <SettingsCard>
        <div className="flex items-center justify-between mb-6">
           <SectionHeader title={t('settings.opsTitle')} subtitle={t('settings.opsSubtitle')} icon={Zap} accent="blue" />
           {syncProgress.loading && (
             <div className="flex items-center gap-3 px-4 py-2 bg-blue-500/10 border border-blue-500/20 rounded-full animate-in fade-in slide-in-from-right-4 duration-700">
                <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />
                <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest leading-none mt-0.5">
                   {syncProgress.message || 'Processing...'}
                </span>
             </div>
           )}
        </div>

        <div className="space-y-6 relative">
          {/* 精美的纤细进度条 */}
          {syncProgress.loading && (
            <div className="absolute -top-4 left-0 w-full z-20 animate-in fade-in slide-in-from-top-2 duration-500">
               <div className="relative h-1 w-full bg-foreground/[0.03] rounded-full overflow-hidden backdrop-blur-sm">
                  <div 
                    className="h-full bg-gradient-to-r from-blue-600 via-indigo-400 to-emerald-400 transition-all duration-1000 ease-out relative"
                    style={{ width: `${syncProgress.percent}%` }}
                  >
                    <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.3)_50%,transparent_100%)] w-20 animate-[shimmer_2s_infinite] -skew-x-12" />
                  </div>
               </div>
            </div>
          )}

          {syncMsg && (
            <div className={`flex items-center gap-3 p-4 rounded-xl border text-[11px] font-bold fade-in ${
              syncMsg.ok ? 'bg-emerald-600/5 border-emerald-500/20 text-emerald-400' : 'bg-rose-600/5 border-rose-500/20 text-rose-400'
            }`}>
              {syncMsg.ok ? <ShieldCheck className="w-4 h-4 opacity-60" /> : <AlertTriangle className="w-4 h-4 opacity-60" />}
              {syncMsg.text}
            </div>
          )}
          
          <div className={`grid grid-cols-1 md:grid-cols-3 gap-4 transition-all duration-700 ${syncProgress.loading ? 'pt-4' : ''}`}>
             {[
               { id: 'auto', label: t('settings.matrixAuto'), sub: t('settings.matrixAutoSub'), icon: Zap, var: 'primary' },
               { id: 'force_remote', label: t('settings.networkPulse'), sub: t('settings.networkPulseSub'), icon: Download, var: 'warning' },
               { id: 'local_only', label: t('settings.localExtract'), sub: t('settings.localExtractSub'), icon: Cpu, var: 'default' }
             ].map(btn => (
               <button 
                 key={btn.id} 
                 onClick={() => handleSync(btn.id)} 
                 disabled={isSyncing || syncProgress.loading} 
                 className={`flex flex-col items-start gap-4 p-6 rounded-3xl border transition-all duration-500 group/btn relative overflow-hidden active:scale-[0.98] ${
                   btn.var === 'primary' ? 'bg-blue-600/5 border-blue-500/30 text-blue-400 hover:bg-blue-600/10 hover:border-blue-500/50 hover:shadow-[0_0_30px_rgba(37,99,235,0.15)]' :
                   btn.var === 'warning' ? 'bg-amber-600/5 border-amber-500/30 text-amber-500 hover:bg-amber-600/10 hover:border-amber-500/50 hover:shadow-[0_0_30px_rgba(245,158,11,0.15)]' :
                   'bg-foreground/[0.02] border-glass-border text-foreground/65 hover:bg-foreground/[0.05] hover:border-foreground/40 hover:text-foreground/90'
                 }`}
               >
                 <div className="flex items-center justify-between w-full">
                    <div className={`p-2 rounded-xl transition-all duration-500 ${
                      btn.var === 'primary' ? 'bg-blue-500/10' :
                      btn.var === 'warning' ? 'bg-amber-500/10' :
                      'bg-foreground/5'
                    }`}>
                       <btn.icon className={`w-5 h-5 ${(isSyncing || syncProgress.loading) ? 'animate-spin' : 'group-hover/btn:scale-110'}`} />
                    </div>
                    <ChevronRight className="w-4 h-4 opacity-0 -translate-x-2 group-hover/btn:opacity-40 group-hover/btn:translate-x-0 transition-all duration-500" />
                 </div>
                 <div className="space-y-1">
                    <span className="text-[11px] font-black uppercase tracking-[0.2em] block">{btn.label}</span>
                    <span className="text-[10px] font-medium opacity-30 uppercase tracking-tight block leading-tight">{btn.sub}</span>
                 </div>
                 
                 <div className={`absolute -bottom-4 -right-4 w-12 h-12 blur-2xl opacity-0 group-hover/btn:opacity-20 transition-opacity duration-1000 ${
                   btn.var === 'primary' ? 'bg-blue-500' :
                   btn.var === 'warning' ? 'bg-amber-500' :
                   'bg-foreground'
                 }`} />
               </button>
             ))}
          </div>
        </div>
      </SettingsCard>
    </div>
  );
};

// ─── IDE 设置页签 [NEW] ──────────────────────────────────────────────────────
const IdeTab = ({ local, setLocal, activeBackendOrigin, activeBackendPort }) => {
  const { t } = useTranslation();
  const restartRequired = activeBackendPort && `${local.backend_port}` !== `${activeBackendPort}`;

  return (
    <div className="space-y-8 animate-in slide-in-from-bottom-2 duration-500">
      <div className="grid grid-cols-1 gap-6">
        <SettingsCard>
          <SectionHeader title={t('settings.ideTitle')} subtitle={t('settings.ideSubtitle')} icon={Command} />
          <div className="space-y-6">
            <div className="bg-background/40 border border-glass-border p-6 rounded-2xl space-y-4">
              <div className="flex justify-between items-start gap-4">
                <div className="flex flex-col gap-0.5">
                  <p className="text-sm font-black italic tracking-tight text-foreground">{t('settings.backendPort')}</p>
                  <p className="text-[9px] font-black text-foreground/55 uppercase tracking-widest leading-relaxed max-w-[320px]">{t('settings.backendPortDesc')}</p>
                </div>
                <div className="px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-[10px] font-black text-blue-400 uppercase tracking-widest">
                  LIVE {activeBackendPort || local.backend_port}
                </div>
              </div>
              <input
                type="number"
                min="1"
                max="65535"
                value={local.backend_port ?? 5173}
                onChange={e => {
                  const next = parseInt(e.target.value, 10);
                  if (Number.isNaN(next)) return;
                  setLocal(s => ({ ...s, backend_port: Math.min(65535, Math.max(1, next)) }));
                }}
                placeholder="5173"
                className="w-full bg-background/50 border border-glass-border rounded-xl py-2.5 px-4 text-xs font-mono font-bold text-blue-400 focus:outline-none focus:border-blue-500/40 transition-all"
              />
              <div className="rounded-xl border border-glass-border bg-background/30 px-4 py-3">
                <div className="text-[9px] font-black text-foreground/45 uppercase tracking-[0.3em] mb-2">{t('settings.backendRuntime')}</div>
                <code className="text-xs font-mono font-bold text-foreground/80 break-all">{activeBackendOrigin || `http://127.0.0.1:${local.backend_port}`}</code>
              </div>
              {restartRequired && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-[10px] font-bold text-amber-400 leading-relaxed">
                  {isTauri
                    ? t('settings.portRestartBannerDesktop', { active: activeBackendPort, next: local.backend_port })
                    : t('settings.portRestartBannerWeb', { active: activeBackendPort, next: local.backend_port })}
                </div>
              )}
            </div>

            <div className="bg-background/40 border border-glass-border p-6 rounded-2xl space-y-3">
              <div className="flex justify-between items-center">
                <div className="flex flex-col gap-0.5">
                   <p className="text-sm font-black italic tracking-tight text-foreground">{t('settings.customPath')}</p>
                   <p className="text-[9px] font-black text-foreground/55 uppercase tracking-widest leading-relaxed max-w-[280px]">{t('settings.customPathDesc')}</p>
                </div>
                <div className="flex gap-2">
                   <button 
                    onClick={async () => {
                      try {
                        const res = await settingsService.selectPath();
                        if (res.success) {
                          setLocal(s => ({ ...s, antigravity_executable: res.executable_path }));
                        }
                      } catch {
                         // 取消或错误不处理
                      }
                    }}
                    className="px-3 py-1.5 bg-background/60 hover:bg-background/80 text-foreground/70 rounded-lg text-xs font-bold transition-all border border-glass-border"
                  >
                    {t('settings.selectBtn')}
                  </button>
                   <button 
                    onClick={async () => {
                      try {
                        const res = await settingsService.detectIde();
                        if (res.success) {
                          setLocal(s => ({ 
                            ...s, 
                            antigravity_executable: res.executable_path,
                            antigravity_args: res.args || []
                          }));
                        } else {
                          alert(res.message);
                        }
                      } catch (e) {
                        alert("探测失败: " + e.message);
                      }
                    }}
                    className="px-3 py-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 rounded-lg text-xs font-bold transition-all border border-blue-500/20"
                  >
                    {t('settings.detectBtn')}
                  </button>
                  <button 
                    onClick={() => setLocal(s => ({ ...s, antigravity_executable: '', antigravity_args: [] }))}
                    className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-xs font-bold transition-all border border-red-500/20"
                  >
                    {t('settings.clearBtn')}
                  </button>
                </div>
              </div>
              <div className="relative group">
                <input
                  type="text"
                  value={local.antigravity_executable || ''}
                  onChange={e => setLocal(s => ({ ...s, antigravity_executable: e.target.value }))}
                  placeholder={t('settings.customPathPlaceholder')}
                  className="w-full bg-background/50 border border-glass-border rounded-xl py-2.5 px-4 text-xs font-mono font-bold text-blue-400 focus:outline-none focus:border-blue-500/40 transition-all pr-12"
                />
              </div>
            </div>

            <div className="bg-background/40 border border-glass-border p-6 rounded-2xl space-y-3">
              <div className="flex flex-col gap-0.5">
                 <p className="text-sm font-black italic tracking-tight text-foreground">{t('settings.argsLabel')}</p>
                 <p className="text-[9px] font-black text-foreground/55 uppercase tracking-widest leading-relaxed">{t('settings.argsDesc')}</p>
              </div>
              <textarea
                value={local.antigravity_args?.join(' ') || ''}
                onChange={e => setLocal(s => ({ ...s, antigravity_args: e.target.value.split(' ').filter(x => x) }))}
                placeholder="--user-data-dir=..."
                rows={2}
                className="w-full bg-background/50 border border-glass-border rounded-xl py-2.5 px-4 text-xs font-mono font-bold text-emerald-400 focus:outline-none focus:border-emerald-500/40 transition-all resize-none"
              />
            </div>
          </div>
        </SettingsCard>
      </div>
    </div>
  );
};

import { useLocation } from 'react-router-dom';

// ─── 主页面 ───────────────────────────────────────────────────────────────────
const Settings = () => {
  const { t } = useTranslation();
  const spotlightRef = useSpotlight();
  const { state } = useLocation();
  const [activeTab, setActiveTab] = useState(state?.tab || 'appearance');
  const [activeBackendOrigin, setActiveBackendOrigin] = useState('');
  const TABS = getTabs(t);
  const {
    settings, provisionStatus, versionInfo,
    isLoading, isSaving, isSyncing, lastSaved,
    fetchSettings, saveSettings, fetchProvisionStatus, fetchVersionInfo,
    syncAssets,
  } = useSettingsStore();

  const [draft, setDraft] = useState(null);

  useEffect(() => {
    let isDisposed = false;

    fetchSettings();
    fetchProvisionStatus();
    fetchVersionInfo();
    resolveBackendOrigin()
      .then((origin) => {
        if (!isDisposed) {
          setActiveBackendOrigin(origin);
        }
      })
      .catch(() => {});

    return () => {
      isDisposed = true;
    };
  }, [fetchSettings, fetchProvisionStatus, fetchVersionInfo]);

  const baselineSettings = createSettingsBaseline(settings);
  const local = getVisibleSettings({ baseline: baselineSettings, draft });
  const setLocal = (updater) => {
    setDraft((currentDraft) => updateSettingsDraft({
      baseline: baselineSettings,
      draft: currentDraft,
      updater,
    }));
  };
  const hasChanges = JSON.stringify(local) !== JSON.stringify(baselineSettings);
  const activeBackendPort = getPortFromOrigin(activeBackendOrigin);

  const { addToast } = useAppStore();
  const handleSave = async () => {
    try { 
      const portChanged = !!activeBackendPort && `${local.backend_port}` !== `${activeBackendPort}`;
      await saveSettings(local);
      setDraft(null);
      addToast(t('settings.syncSuccess') || 'Settings saved', 'success');

      if (portChanged) {
        if (isTauri) {
          const shouldRestart = window.confirm(t('settings.portRestartPrompt', { port: local.backend_port }));
          if (shouldRestart) {
            await settingsService.restartApp();
            return;
          }
          addToast(t('settings.portRestartPendingDesktop', { port: local.backend_port }), 'warning');
        } else {
          addToast(t('settings.portRestartPendingWeb', { port: local.backend_port }), 'warning');
        }
      }
    }
    catch (e) { addToast(t('settings.syncFailed') + e.message, 'error'); }
  };

  if (isLoading) return (
    <div className="flex-1 flex flex-col items-center justify-center py-60 opacity-10">
      <Activity className="w-16 h-16 mb-4 animate-pulse text-blue-500" />
      <span className="text-xs font-black uppercase tracking-[1em]">{t('settings.loading')}</span>
    </div>
  );

  return (
    <div ref={spotlightRef} className="space-y-6 fade-in relative min-h-screen pb-32 mt-4 px-2 spotlight-group">
      {/* Matrix Style Header (Compact) */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-3">
             <div className="p-2 bg-blue-600 rounded-lg shadow-[0_0_15px_rgba(37,99,235,0.4)]">
                <SettingsIcon className="w-5 h-5 text-white" />
             </div>
             <h1 className="text-xl font-black italic tracking-tighter uppercase">{t('settings.title')}</h1>
          </div>
           <p className="text-[9px] font-black text-foreground/45 uppercase tracking-[0.4em] mt-1 pl-1">{t('settings.subtitle')}</p>
        </div>

        <div className="flex bg-foreground/[0.03] border border-glass-border p-1 rounded-full overflow-hidden shadow-inner backdrop-blur-md">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-5 py-2 rounded-full text-[9px] font-black uppercase tracking-widest transition-all duration-500 flex items-center gap-2 ${
                  active 
                    ? 'btn-matrix-pill-active scale-[1.02]' 
                    : 'btn-matrix-pill-inactive'
                }`}
              >
                <Icon className={`w-3 h-3 ${active ? 'text-inherit' : 'text-foreground/50'}`} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab Content Area */}
      <div className="max-w-[1200px] mx-auto">
        <div className="fade-in">
          {activeTab === 'appearance' && <AppearanceTab />}
          {activeTab === 'refresh'    && <RefreshTab local={local} setLocal={setLocal} />}
          {activeTab === 'logs'       && <LogsTab    local={local} setLocal={setLocal} />}
          {activeTab === 'assets'     && <AssetsTab
            provisionStatus={provisionStatus}
            versionInfo={versionInfo}
            isSyncing={isSyncing}
            onSync={syncAssets}
            local={local}
            setLocal={setLocal}
          />}
          {activeTab === 'ide'        && <IdeTab local={local} setLocal={setLocal} activeBackendOrigin={activeBackendOrigin} activeBackendPort={activeBackendPort} />}
        </div>
      </div>

      {/* Floating Action Bar (Compact) */}
      {hasChanges && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 w-[calc(100%-48px)] max-w-2xl z-[200] slide-up">
           <div className="bg-background/90 backdrop-blur-3xl border border-blue-500/20 rounded-3xl p-4 pr-6 flex items-center shadow-[0_40px_80px_rgba(0,0,0,0.8)] ring-1 ring-glass-border">
              <div className="flex items-center gap-4 flex-1">
                 <div className="w-10 h-10 rounded-xl bg-blue-600/10 text-blue-500 flex items-center justify-center border border-blue-500/10">
                    <AlertTriangle className="w-5 h-5 animate-pulse" />
                 </div>
                  <div>
                     <p className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground italic">{t('settings.pendingSync')}</p>
                     <p className="text-[8px] text-foreground/45 mt-0.5 font-bold uppercase tracking-widest">{t('settings.pendingSyncDesc')}</p>
                  </div>
              </div>
              <div className="h-8 w-px bg-glass-border mx-6"></div>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="group flex items-center gap-3 px-8 py-3 btn-matrix-primary disabled:opacity-50 text-[10px] font-black uppercase tracking-[0.3em] rounded-xl"
              >
                {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                {t('settings.submitBtn')}
              </button>
           </div>
        </div>
      )}
      
      {lastSaved && !hasChanges && (
        <div className="mt-12 flex flex-col items-center gap-3 opacity-20 fade-in">
           <div className="flex items-center gap-2">
              <div className="w-1 h-1 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,1)]" />
              <span className="text-[9px] text-emerald-400 font-black uppercase tracking-[0.5em]">
                MATRIX SYNCED — {new Date(lastSaved).toLocaleTimeString()}
              </span>
           </div>
        </div>
      )}
    </div>
  );
};

export default Settings;
