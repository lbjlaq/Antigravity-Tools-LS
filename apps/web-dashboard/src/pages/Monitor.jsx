import React, { useState, useEffect, useRef } from 'react';
import { useSpotlight } from '../hooks/useSpotlight';
import { 
  Terminal, 
  Search, 
  Trash2, 
  Pause, 
  Play, 
  Filter,
  ArrowRight,
  Activity,
  Timer,
  Hash,
  Globe,
  Mail,
  Box
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ConfirmModal } from '../components/Modal';
import { resolveApiBaseUrl } from '../api/client';
import { monitorService } from '../api/services/monitor';

const Monitor = () => {
  const { t } = useTranslation();
  const spotlightRef = useSpotlight();
  const [activeTab, setActiveTab] = useState('traffic'); // 'traffic' | 'system'
  const [logs, setLogs] = useState([]);
  const [sysLogs, setSysLogs] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isPaused, setIsPaused] = useState(false);
  const [filterLevel, setFilterLevel] = useState('all');
  const [selectedLog, setSelectedLog] = useState(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  
  const scrollRef = useRef(null);
  const sysScrollRef = useRef(null);
  const trafficESRef = useRef(null);
  const sysESRef = useRef(null);
  const isPausedRef = useRef(isPaused);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    // 1. 流量日志订阅
    monitorService.getTrafficLogs(50)
      .then(data => Array.isArray(data) && setLogs(data))
      .catch(err => console.error("Traffic history failed:", err));

    // 2. 系统日志订阅
    monitorService.getSystemLogs()
      .then(data => data.lines && setSysLogs(data.lines.reverse())) // 保持最新在前
      .catch(err => console.error("Sys history failed:", err));
    
    let disposed = false;
    const startStreams = async () => {
      const apiBaseUrl = await resolveApiBaseUrl();
      if (disposed) return;

      const tES = new EventSource(apiBaseUrl + '/monitor/stream');
      tES.onmessage = (event) => {
        if (isPausedRef.current) return;
        try {
          const newLog = JSON.parse(event.data);
          setLogs(prev => [newLog, ...prev.slice(0, 499)]);
        } catch (err) {}
      };
      trafficESRef.current = tES;

      const sES = new EventSource(apiBaseUrl + '/logs/stream');
      sES.onmessage = (event) => {
        if (isPausedRef.current) return;
        try {
          const newEntry = JSON.parse(event.data);
          setSysLogs(prev => [newEntry, ...prev.slice(0, 999)]);
        } catch (err) {}
      };
      sysESRef.current = sES;
    };

    startStreams();

    return () => {
      disposed = true;
      if (trafficESRef.current) trafficESRef.current.close();
      if (sysESRef.current) sysESRef.current.close();
    };
  }, []);

  // --- 流量日志 渲染 ---
  const renderTrafficItem = (log) => {
    const isError = log.status >= 400;
    const protocolColor = {
      openai: 'text-green-400',
      anthropic: 'text-amber-400',
      gemini: 'text-blue-400'
    }[log.protocol] || 'text-foreground/65';

    return (
      <div 
        key={log.id}
        onClick={() => setSelectedLog(log)}
        className={`group spotlight-card flex items-center gap-4 px-4 py-2 border-b border-glass-border hover:bg-foreground/[0.03] cursor-pointer transition-colors relative overflow-hidden ${selectedLog?.id === log.id ? 'bg-foreground/[0.05]' : ''}`}
      >
        <div className="grain-overlay" />
        <div className="w-16 shrink-0 font-mono text-[10px] text-foreground/45">
          {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </div>
        <div className={`w-12 shrink-0 font-bold text-xs ${isError ? 'text-red-500' : 'text-emerald-500'}`}>{log.status}</div>
        <div className="w-16 shrink-0 font-black text-[10px] uppercase tracking-tighter text-foreground/65">{log.method}</div>
        <div className={`w-20 shrink-0 font-mono text-[10px] font-bold ${protocolColor}`}>{log.protocol}</div>
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className="text-foreground/80 text-xs font-medium truncate">{log.model || 'unknown'}</span>
          <ArrowRight className="w-3 h-3 text-foreground/45 shrink-0" />
          <span className="text-foreground/65 text-[10px] font-mono truncate tracking-tight italic">{log.mapped_model || 'none'}</span>
        </div>
        <div className="w-20 shrink-0 text-right font-mono text-[10px] text-foreground/65">{log.duration}ms</div>
      </div>
    );
  };

  // --- 系统日志 渲染 ---
  const renderSysLogItem = (entry) => {
    const levelColor = {
      ERROR: 'text-red-500',
      WARN: 'text-amber-500',
      INFO: 'text-emerald-500',
      DEBUG: 'text-blue-400',
      TRACE: 'text-purple-400'
    }[entry.level] || 'text-foreground/65';

    return (
      <div key={entry.id} className="flex gap-4 px-4 py-1.5 border-b border-glass-border font-mono text-[11px] leading-relaxed group hover:bg-foreground/[0.01]">
        <div className="w-20 shrink-0 text-foreground/45 tracking-tighter">
          {new Date(entry.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </div>
        <div className={`w-12 shrink-0 font-black tracking-tighter text-center rounded bg-background/40 ${levelColor}`}>
          {entry.level}
        </div>
        <div className="w-32 shrink-0 text-foreground/55 truncate italic">[{entry.target}]</div>
        <div className="flex-1 text-foreground/80 break-all select-text">{entry.message}</div>
      </div>
    );
  };

  const filteredTraffic = logs.filter(log => {
    const matchesSearch = !searchTerm || 
      log.model?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.account_email?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesLevel = filterLevel === 'all' || (filterLevel === 'error' && log.status >= 400);
    return matchesSearch && matchesLevel;
  });

  const filteredSys = sysLogs.filter(entry => {
    const matchesSearch = !searchTerm || entry.message.toLowerCase().includes(searchTerm.toLowerCase()) || entry.target.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesLevel = filterLevel === 'all' || (filterLevel === 'error' && entry.level === 'ERROR');
    return matchesSearch && matchesLevel;
  });

  const handleConfirmClear = async () => {
    setIsDeleteModalOpen(false);
    if (activeTab === 'traffic') {
      try {
        await monitorService.clearTrafficLogs();
      } catch (err) {}
      setLogs([]);
    } else {
      try {
        await monitorService.clearSystemLogs();
      } catch (err) {}
      setSysLogs([]);
    }
  };

  return (
    <div ref={spotlightRef} className="flex flex-col h-[calc(100vh-100px)] gap-6 animate-in fade-in duration-500 spotlight-group">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-black italic tracking-tighter flex items-center gap-3">
              <Activity className="text-blue-500 w-8 h-8" />
              {t('monitor.title')} v1.0
            </h1>
            <div className="flex bg-foreground/5 p-1 rounded-xl border border-glass-border">
              <button 
                onClick={() => setActiveTab('traffic')}
                className={`px-4 py-1.5 rounded-lg text-xs font-black transition-all ${activeTab === 'traffic' ? 'btn-matrix-pill-active' : 'btn-matrix-pill-inactive'}`}
              >
                {t('monitor.trafficLogs')}
              </button>
              <button 
                onClick={() => setActiveTab('system')}
                className={`px-4 py-1.5 rounded-lg text-xs font-black transition-all ${activeTab === 'system' ? 'btn-matrix-pill-active !text-emerald-500 !bg-emerald-500/10 !border-emerald-500/20' : 'btn-matrix-pill-inactive'}`}
              >
                {t('monitor.systemTerminal')}
              </button>
            </div>
          </div>
          <p className="text-foreground/65 text-sm font-medium mt-1">
            {activeTab === 'traffic' ? t('monitor.trafficDesc') : t('monitor.systemDesc')}
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/45" />
            <input 
              type="text" 
              placeholder={activeTab === 'traffic' ? t('monitor.searchTrafficPlaceholder') : t('monitor.searchSystemPlaceholder')}
              className="bg-foreground/5 border border-glass-border rounded-xl pl-10 pr-4 py-2 text-sm focus:outline-none focus:border-blue-500/50 transition-all w-64"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          
          <button 
            onClick={() => setIsPaused(!isPaused)}
            className={`p-2.5 rounded-xl transition-all ${isPaused ? 'btn-matrix-pill-active !text-amber-500 !bg-amber-500/10 !border-amber-500/20' : 'btn-matrix-glass text-foreground/65'}`}
          >
            {isPaused ? <Play className="w-5 h-5" /> : <Pause className="w-5 h-5" />}
          </button>

          <button 
            onClick={() => setIsDeleteModalOpen(true)}
            className="p-2.5 rounded-xl btn-matrix-glass text-foreground/65 hover:!text-red-500 hover:!border-red-500/20"
          >
            <Trash2 className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="flex-1 flex gap-6 min-h-0">
        <div className="flex-1 bg-foreground/[0.01] border border-glass-border rounded-2xl flex flex-col overflow-hidden shadow-2xl backdrop-blur-xl">
          <div className="px-4 py-3 bg-foreground/[0.03] border-b border-glass-border flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3 text-[10px] font-black uppercase tracking-widest text-foreground/55">
              <Terminal className="w-3.5 h-3.5" />
              {activeTab === 'traffic' ? t('monitor.liveTraffic') : t('monitor.liveSystem')}
            </div>
            
            <div className="flex border border-glass-border rounded-lg overflow-hidden shrink-0">
              <button 
                onClick={() => setFilterLevel('all')}
                className={`px-3 py-1 text-[10px] font-bold uppercase transition-all ${filterLevel === 'all' ? 'btn-matrix-pill-active' : 'btn-matrix-pill-inactive'}`}
              >
                {t('monitor.all')}
              </button>
              <button 
                onClick={() => setFilterLevel('error')}
                className={`px-3 py-1 text-[10px] font-bold uppercase border-l border-glass-border transition-all ${filterLevel === 'error' ? (activeTab === 'traffic' ? 'bg-red-500/20 text-red-500' : 'bg-red-500/30 text-red-400') : 'text-foreground/45 hover:text-foreground/65'}`}
              >
                {activeTab === 'traffic' ? t('monitor.errorsOnly') : t('monitor.fatalOnly')}
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-hide" ref={activeTab === 'traffic' ? scrollRef : sysScrollRef}>
            {activeTab === 'traffic' ? (
              filteredTraffic.length > 0 ? (
                filteredTraffic.map(renderTrafficItem)
              ) : (
                <EmptyState icon={Activity} label={t('monitor.waitingTraffic')} />
              )
            ) : (
              filteredSys.length > 0 ? (
                <div className="bg-background/20">{filteredSys.map(renderSysLogItem)}</div>
              ) : (
                <EmptyState icon={Terminal} label={t('monitor.waitingSystem')} />
              )
            )}
          </div>
        </div>

        {activeTab === 'traffic' && selectedLog && (
          <div className="w-[450px] bg-foreground/[0.02] border border-glass-border rounded-2xl flex flex-col overflow-hidden animate-in slide-in-from-right-4 duration-300 shadow-2xl backdrop-blur-3xl spotlight-card relative">
            <div className="grain-overlay" />
            <div className="p-6 border-b border-glass-border flex items-center justify-between shrink-0">
              <h2 className="text-lg font-black italic tracking-tighter text-blue-400">{t('monitor.detailsTitle')}</h2>
              <button onClick={() => setSelectedLog(null)} className="text-foreground/45 hover:text-foreground transition-all text-sm uppercase font-black tracking-tighter">{t('common.close')}</button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-8 scrollbar-hide font-mono">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-foreground/[0.03] border border-glass-border">
                  <div className="flex items-center gap-2 text-[10px] font-black uppercase text-foreground/45 mb-2">
                    <Timer className="w-3 h-3 text-emerald-500/60" />
                    {t('monitor.latency')}
                  </div>
                  <div className="text-2xl font-black italic text-emerald-500 tracking-tighter">{selectedLog.duration}ms</div>
                </div>
                <div className="p-4 rounded-xl bg-foreground/[0.03] border border-glass-border">
                  <div className="flex items-center gap-2 text-[10px] font-black uppercase text-foreground/45 mb-2">
                    <Activity className="w-3 h-3 text-blue-500/60" />
                    {t('monitor.status')}
                  </div>
                  <div className={`text-2xl font-black italic tracking-tighter ${selectedLog.status < 400 ? 'text-emerald-500' : 'text-red-500'}`}>{selectedLog.status}</div>
                </div>
              </div>

              <div className="space-y-4">
                <DetailRow icon={Hash} label={t('monitor.traceId')} value={selectedLog.id} mono />
                <DetailRow icon={Box} label={t('monitor.protocol')} value={selectedLog.protocol} uppercase />
                <DetailRow icon={Globe} label={t('monitor.clientIp')} value={selectedLog.client_ip} />
                <DetailRow icon={Mail} label={t('monitor.account')} value={selectedLog.account_email} />
              </div>

              <div className="p-4 rounded-xl bg-background/40 border border-glass-border">
                <div className="text-[10px] font-black uppercase text-foreground/20 mb-3 tracking-widest">{t('monitor.modelTranscoding')}</div>
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-[9px] text-foreground/55 uppercase font-black px-1">{t('monitor.original')}</span>
                    <div className="bg-foreground/5 px-3 py-2 rounded-lg text-sm font-medium border border-glass-border text-foreground/70">{selectedLog.model}</div>
                  </div>
                  <div className="flex justify-center -my-1">
                    <ArrowRight className="w-4 h-4 text-blue-500/40 rotate-90" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[9px] text-blue-500/60 uppercase font-black px-1">{t('monitor.mapped')}</span>
                    <div className="bg-blue-500/10 px-3 py-2 rounded-lg text-sm font-black border border-blue-500/20 text-blue-400">{selectedLog.mapped_model}</div>
                  </div>
                </div>
              </div>

              {(selectedLog.input_tokens > 0 || selectedLog.output_tokens > 0) && (
                <div className="p-4 rounded-xl bg-foreground/5 border border-glass-border">
                  <div className="text-[10px] font-black uppercase text-foreground/45 mb-4 tracking-widest">{t('monitor.tokenUsage')}</div>
                  <div className="flex items-center gap-8">
                    <div className="flex-1 italic">
                      <div className="text-3xl font-black text-foreground tracking-tighter">{selectedLog.input_tokens}</div>
                      <div className="text-[10px] uppercase font-black tracking-widest text-emerald-500 mt-1 opacity-70">{t('monitor.input')}</div>
                    </div>
                    <div className="flex-1 italic text-right border-l border-glass-border pl-8">
                      <div className="text-3xl font-black text-foreground tracking-tighter">{selectedLog.output_tokens}</div>
                      <div className="text-[10px] uppercase font-black tracking-widest text-blue-500 mt-1 opacity-70">{t('monitor.output')}</div>
                    </div>
                  </div>
                </div>
              )}

              {selectedLog.error && (
                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30">
                  <div className="text-[10px] font-black uppercase text-red-500 mb-2 italic tracking-widest">{t('monitor.errorTrace')}</div>
                  <div className="text-sm font-mono text-foreground/90 leading-relaxed font-bold break-all">{selectedLog.error}</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <ConfirmModal 
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={handleConfirmClear}
        title={t('common.confirmTitle')}
        message={t('monitor.confirmClear')}
        type="danger"
      />
    </div>
  );
};

const EmptyState = ({ icon: Icon, label }) => (
  <div className="h-full flex flex-col items-center justify-center gap-4 text-foreground/45">
    <Icon className="w-12 h-12 stroke-[1]" />
    <p className="text-xs font-black uppercase tracking-[0.3em]">{label}</p>
  </div>
);

const DetailRow = ({ icon: Icon, label, value, mono, uppercase }) => (
  <div className="flex items-center justify-between py-2 border-b border-glass-border">
    <div className="flex items-center gap-2 text-foreground/65 italic">
      <Icon className="w-3.5 h-3.5" />
      <span className="text-[11px] font-bold uppercase tracking-tight">{label}</span>
    </div>
    <div className={`text-sm font-medium ${mono ? 'font-mono' : ''} ${uppercase ? 'uppercase' : ''} text-foreground/80`}>
      {value || 'N/A'}
    </div>
  </div>
);

export default Monitor;
