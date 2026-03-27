import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Search, RefreshCw, Trash2, ShieldCheck, ShieldAlert, ShieldOff, Cpu, Loader2, Lock, Download, Maximize2, X, Tag, Check, Filter, ChevronRight, ChevronLeft, MoreHorizontal, LayoutGrid, List, ToggleLeft, ToggleRight, ArrowRightLeft, GripVertical } from 'lucide-react';
import { 
  DndContext, 
  closestCenter, 
  KeyboardSensor, 
  PointerSensor, 
  useSensor, 
  useSensors,
  DragOverlay
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  rectSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import useAccountStore from '../store/useAccountStore';
import useAppStore from '../store/useAppStore';
import AddAccountModal from '../components/AddAccountModal';
import { BaseModal, ConfirmModal } from '../components/Modal';
import { useTranslation } from 'react-i18next';
import { useSpotlight } from '../hooks/useSpotlight';
import { resolveApiBaseUrl } from '../api/client';

// 指定要展示的核心代表性模型 (通过代表项观察同家族配额)
const RECOMMENDED_MODELS = [
  "gemini-3.1-pro-high",
  "gemini-3-flash-agent",
  "claude-sonnet-4-6"
];

const ModelDetailsModal = ({ isOpen, onClose, account }) => {
  const { t } = useTranslation();
  if (!isOpen) return null;

  const models = account.quota?.models || [];
  const sorts = account.quota?.agentModelSorts || [];
  
  const targetIds = sorts[0]?.groups?.flatMap(g => g.modelIds) || RECOMMENDED_MODELS;
  const validModels = models.filter(m => m.percentage !== undefined && (m.reset_time?.trim() !== ''));
  
  const recommendedModels = validModels.filter(m => targetIds.includes(m.name));
  const otherModels = validModels.filter(m => !targetIds.includes(m.name));

  return (
    <BaseModal 
      isOpen={isOpen} 
      onClose={onClose} 
      title={t('accounts.quotaMatrix')} 
      subtitle={account.email}
      footerText={t('accounts.exitMatrix')}
    >
      <div className="space-y-8 pt-2 pb-6">
        {recommendedModels.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center gap-4 px-1">
              <span className="text-[9px] font-black uppercase tracking-[0.4em] text-foreground/45 whitespace-nowrap">{t('accounts.coreAssets')}</span>
              <div className="h-px w-full bg-foreground/[0.03]"></div>
            </div>
            <div className="grid grid-cols-1 gap-2">
              {recommendedModels.map(m => {
                const colors = getStatusColor(m.percentage, m.name);
                return (
                  <div key={m.name} className="group/detail relative flex flex-col gap-2 py-2.5 px-5 rounded-2xl border border-white/[0.03] hover:border-glass-border hover:bg-foreground/[0.01] transition-all duration-300 overflow-hidden">
                    <div className="flex justify-between items-center relative z-10">
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-bold text-foreground/80 group-hover/detail:text-foreground transition-colors uppercase tracking-tight italic">
                          {m.display_name || m.name}
                        </span>
                        <code className="text-[9px] text-foreground/65 font-mono tracking-wider group-hover/detail:text-blue-400">
                          {m.name}
                        </code>
                      </div>
                      <div className="scale-95 origin-right">
                        {getStatusDisplay(m.percentage, m.reset_time)}
                      </div>
                    </div>
                    <div className="h-0.5 bg-foreground/[0.02] rounded-full overflow-hidden relative">
                      <div 
                        className={`absolute inset-y-0 left-0 transition-all duration-1000 ${colors.bar} brightness-75`}
                        style={{ width: `${m.percentage}%` }}
                      ></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {otherModels.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center gap-4 px-1">
              <span className="text-[9px] font-black uppercase tracking-[0.4em] text-foreground/45 whitespace-nowrap">{t('accounts.infrastructure')}</span>
              <div className="h-px w-full bg-foreground/[0.02]"></div>
            </div>
            <div className="grid grid-cols-1 gap-1.5">
              {otherModels.map(m => {
                const colors = getStatusColor(m.percentage, m.name);
                return (
                  <div key={m.name} className="flex justify-between items-center py-2 px-5 rounded-xl bg-foreground/[0.01] border border-white/[0.02] hover:bg-foreground/[0.03] transition-all">
                    <span className="text-[10px] font-bold text-foreground/65 uppercase tracking-tighter truncate max-w-[200px]">{m.display_name || m.name}</span>
                    <div className="flex items-center gap-4">
                      <div className="w-24 h-1 bg-foreground/[0.03] rounded-full overflow-hidden">
                        <div className={`h-full ${colors.bar} opacity-40`} style={{ width: `${m.percentage}%` }}></div>
                      </div>
                      {getStatusDisplay(m.percentage, m.reset_time)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </BaseModal>
  );
};

const ForbiddenReasonModal = ({ isOpen, onClose, account }) => {
  const { t } = useTranslation();
  if (!isOpen) return null;

  const reason = account.quota?.forbidden_reason || t('common.none');
  let formattedReason = reason;
  
  try {
    if (reason.startsWith('{') || reason.startsWith('[')) {
      formattedReason = JSON.stringify(JSON.parse(reason), null, 2);
    }
  } catch (e) {}

  return (
    <BaseModal 
      isOpen={isOpen} 
      onClose={onClose} 
      title={t('accounts.bannedDetails')} 
      subtitle={account.email} 
      borderColor="rose-500/20"
      accentColor="bg-rose-500"
      footerText={t('accounts.dismiss')}
    >
      <div className="py-4">
        <div className="bg-rose-500/5 border border-rose-500/10 rounded-2xl p-6 font-mono text-[11px] leading-relaxed text-rose-400/80 break-all whitespace-pre-wrap overflow-x-hidden shadow-inner">
          <div className="flex items-center gap-2 mb-4 text-rose-500 font-black tracking-widest uppercase italic border-b border-rose-500/10 pb-3">
             <ShieldAlert className="w-4 h-4" /> {t('accounts.systemMessage')}
          </div>
          {formattedReason}
        </div>
        
        {account.quota?.appeal_url && (
          <div className="mt-6 flex justify-center">
            <a 
              href={account.quota.appeal_url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-black uppercase tracking-[0.2em] rounded-full transition-all shadow-[0_0_20px_rgba(37,99,235,0.3)] hover:shadow-[0_0_30px_rgba(37,99,235,0.5)] flex items-center gap-2"
            >
              {t('accounts.appealSupport')}
            </a>
          </div>
        )}
      </div>
    </BaseModal>
  );
};

// --- Shared Utility Functions ---
const getStatusColor = (percentage, modelName = '') => {
  if (percentage === 0) return {
    bar: 'bg-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.6)]',
    text: 'text-rose-500',
    icon: 'text-rose-500/50'
  };
  const name = modelName.toLowerCase();
  if (name.includes('pro')) return {
    bar: 'bg-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.6)]',
    text: 'text-blue-400',
    icon: 'text-blue-500/50'
  };
  if (name.includes('flash')) return {
    bar: 'bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.6)]',
    text: 'text-emerald-400',
    icon: 'text-emerald-500/50'
  };
  if (name.includes('claude') || name.includes('gpt')) return {
    bar: 'bg-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.6)]',
    text: 'text-amber-400',
    icon: 'text-amber-500/50'
  };
  return {
    bar: 'bg-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.5)]',
    text: 'text-blue-400',
    icon: 'text-blue-500/50'
  };
};

const formatResetTime = (resetTime) => {
  if (!resetTime) return null;
  try {
    const resetDate = new Date(resetTime);
    const now = new Date();
    const diffMs = resetDate - now;

    const mon = (resetDate.getMonth() + 1).toString().padStart(2, '0');
    const day = resetDate.getDate().toString().padStart(2, '0');
    const hh = resetDate.getHours().toString().padStart(2, '0');
    const mm = resetDate.getMinutes().toString().padStart(2, '0');
    const formattedDate = `${mon}-${day} ${hh}:${mm}`;

    if (diffMs > 0) {
      const totalMinutes = Math.floor(diffMs / (1000 * 60));
      const d = Math.floor(totalMinutes / (24 * 60));
      const h = Math.floor((totalMinutes % (24 * 60)) / 60);
      const m = totalMinutes % 60;
      let relativeTime = '';
      if (d > 0) relativeTime = `${d}d ${h}h `;
      else if (h > 0) relativeTime = `${h}h ${m}m `;
      else relativeTime = `${m}m `;
      
      return `${relativeTime}${formattedDate}`;
    }
    return formattedDate;
  } catch (e) {
    return resetTime;
  }
};

const getStatusDisplay = (percentage, resetTime) => {
  const formattedTime = formatResetTime(resetTime);

  return (
    <div className="flex items-baseline gap-2 min-w-fit">
      <span className={`text-[11px] font-black tracking-tighter tabular-nums ${percentage === 0 ? 'text-rose-500' : 'text-foreground/90'}`}>
        {percentage}%
      </span>
      {resetTime && (
        <span className="text-[9px] font-bold text-foreground/75 tracking-tighter font-mono whitespace-nowrap uppercase">
           {formattedTime || (percentage === 100 ? t('accounts.refreshed') : t('accounts.pending'))}
        </span>
      )}
    </div>
  );
};
// ------------------------------

// --- Sortable Wrapper for AccountCard ---
const SortableAccountCard = ({ id, ...props }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 100 : 1,
    opacity: isDragging ? 0.3 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="h-full">
      <AccountCard {...props} dragHandleProps={{ ...attributes, ...listeners }} isDragging={isDragging} />
    </div>
  );
};

const AccountCard = ({ account, isSelected, onToggleSelect, onSwitch, dragHandleProps, isDragging }) => {
  const { t } = useTranslation();
  const { removeAccount, refreshQuota, exportAccount, updateAccountLabel, toggleProxyStatus } = useAccountStore();
  const { addToast } = useAppStore();
  const [isDeleting, setIsDeleting] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isReasonOpen, setIsReasonOpen] = useState(false);
  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [labelInput, setLabelInput] = useState(account.label || '');
  const [isTogglingProxy, setIsTogglingProxy] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);

  const handleCardClick = (e) => {
    // 如果点击的是链接或按钮及其内部元素，则不触发选中逻辑，允许原生行为冒泡
    if (e.target.closest('a') || e.target.closest('button')) {
      return;
    }
    onToggleSelect(account.id);
  };

  const handleUpdateLabel = async (e) => {
    e.stopPropagation();
    try {
      await updateAccountLabel(account.id, labelInput.trim() || null);
      setIsEditingLabel(false);
      addToast(t('accounts.updateLabelSuccess') || 'Label updated', 'success');
    } catch (err) {
      addToast(t('accounts.updateLabelFailed') + err.message, 'error');
    }
  };

  const handleToggleProxy = async (e) => {
    e.stopPropagation();
    if (isTogglingProxy) return;
    setIsTogglingProxy(true);
    try {
      await toggleProxyStatus(account.id, !account.is_proxy_disabled);
    } catch (err) {
      addToast(t('accounts.toggleProxyFailed') || 'Failed to toggle proxy status: ' + err.message, 'error');
    } finally {
      setIsTogglingProxy(false);
    }
  };

  const handleExport = (e) => {
    e.stopPropagation();
    exportAccount(account);
  };

  const handleSwitch = async (e) => {
    e.stopPropagation();
    if (isSwitching) return;
    setIsSwitching(true);
    try {
      await onSwitch(account);
    } finally {
      setIsSwitching(false);
    }
  };

  const handleRefresh = async (e) => {
    e.stopPropagation();
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await refreshQuota(account.refresh_token);
    } catch (err) {
      console.error('Refresh failed:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleDelete = async (e) => {
    e.stopPropagation();
    setIsConfirmOpen(true);
  };

  const onConfirmDelete = async () => {
    setIsConfirmOpen(false);
    setIsDeleting(true);
    try {
      await removeAccount(account.id);
      addToast(t('accounts.deleteSuccess') || 'Account deleted', 'success');
    } catch (err) {
      addToast(t('accounts.deleteFailed') + err.message, 'error');
      setIsDeleting(false);
    }
  };

  const displayModels = RECOMMENDED_MODELS.map(modelId => {
    const modelData = account.quota?.models?.find(m => m.name === modelId);
    if (!modelData) return null;
    let displayName = modelData.display_name || modelData.name;
    if (modelId === "gemini-3.1-pro-high") displayName = "Gemini 3.1 Pro";
    if (modelId === "gemini-3-flash-agent") displayName = "Gemini 3 Flash Agent";
    if (modelId === "claude-sonnet-4-6") displayName = "Claude Sonnet";
    return { ...modelData, display_name: displayName };
  }).filter(Boolean);

  const finalDisplayModels = displayModels.length > 0 ? displayModels : (account.quota?.models?.slice(0, 3) || []);

  return (
    <div 
      className={`glass-card spotlight-card p-4 rounded-2xl group relative overflow-hidden transition-all border flex flex-col h-full ${isSelected ? 'bg-blue-500/10 border-blue-500/50 ring-1 ring-blue-500/20 shadow-[0_0_30px_rgba(59,130,246,0.1)]' : 'bg-foreground/[0.04] border-glass-border hover:bg-foreground/[0.06]'} ${account.is_proxy_disabled ? 'opacity-60 saturate-[0.8]' : ''}`}
      style={{
        '--glow-color': account.quota?.is_forbidden ? 'rgba(239, 68, 68, 0.15)' : 
                       account.is_proxy_disabled ? 'rgba(245, 158, 11, 0.15)' : 
                       'rgba(59, 130, 246, 0.15)'
      }}
      onClick={handleCardClick}
    >
      <div className="grain-overlay" />
      {isSelected && (
        <div className="absolute top-0 left-0 w-1 h-full bg-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.6)] z-30 magnetic"></div>
      )}
      <div className="absolute -right-4 -top-4 w-24 h-24 bg-blue-500/5 blur-3xl rounded-full transition-all group-hover:bg-blue-500/10"></div>
      
      <div className="flex items-start justify-between mb-4 relative z-20">
        <div className="flex items-center gap-3 flex-1 min-w-0 pr-2">
          <div className={`w-4 h-4 rounded border transition-all flex items-center justify-center shrink-0 ${isSelected ? 'bg-blue-500 border-blue-500 shadow-sm' : 'bg-foreground/5 border-glass-border group-hover:border-white/20'}`}>
            {isSelected && <Check className="w-3 h-3 text-white" strokeWidth={4} />}
          </div>
          
          <div {...dragHandleProps} className="p-1 hover:bg-foreground/10 rounded cursor-grab active:cursor-grabbing text-foreground/45 hover:text-foreground/65 transition-colors">
            <GripVertical className="w-3.5 h-3.5" />
          </div>
          
          <div className="flex-1 min-w-0 flex flex-col gap-1.5 overflow-hidden">
            <h3 className="text-sm font-bold text-foreground/90 truncate tracking-tight" title={account.email}>{account.email}</h3>
            <div className="flex items-center gap-1.5 flex-wrap overflow-hidden">
              {account.quota?.subscription_tier && (
                <a 
                  href={account.quota?.is_forbidden ? account.quota?.appeal_url : undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => { if (!account.quota?.is_forbidden || !account.quota?.appeal_url) e.preventDefault(); }}
                  className={`text-[9px] font-black px-1.5 py-0.5 rounded-[4px] uppercase tracking-wider transition-all flex items-center gap-1 shrink-0 ${account.quota?.is_forbidden ? 'bg-red-500/20 text-red-500 border border-red-500/50 animate-pulse cursor-pointer' : account.quota.subscription_tier.includes('ULTRA') ? 'bg-indigo-600/30 text-indigo-400 border border-indigo-500/40 shadow-sm' : account.quota.subscription_tier.includes('PRO') ? 'bg-amber-500/10 text-amber-400 border border-amber-500/50' : 'bg-foreground/5 text-foreground/85 border border-glass-border'}`}
                >
                  {account.quota?.is_forbidden && <Lock className="w-2.5 h-2.5" />}
                  {account.quota?.subscription_tier?.replace('GOOGLE AI ', '')}
                </a>
              )}
              {account.label && !isEditingLabel && (
                <span onClick={(e) => { e.stopPropagation(); setIsEditingLabel(true); }} className="flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-amber-500/10 border border-amber-500/20 text-amber-500 text-[9px] font-black cursor-pointer hover:bg-amber-500/20 transition-all uppercase tracking-tighter shrink-0 truncate max-w-[120px]">
                  <Tag className="w-2 h-2" />{account.label}
                </span>
              )}
              {isEditingLabel && (
                <div className="flex items-center gap-1 bg-foreground/5 border border-glass-border p-0.5 rounded-md" onClick={e => e.stopPropagation()}>
                  <input autoFocus type="text" value={labelInput} onChange={(e) => setLabelInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleUpdateLabel(e); if (e.key === 'Escape') setIsEditingLabel(false); }} className="bg-transparent border-none outline-none text-[9px] text-foreground w-20 px-1" />
                  <button onClick={handleUpdateLabel} className="text-emerald-400 p-0.5 hover:bg-emerald-400/10 rounded"><Check className="w-2.5 h-2.5" /></button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0 pt-0.5 min-w-fit">
          {account.status === 'Forbidden' || account.quota?.is_forbidden ? (
            <div className="flex items-center gap-1 text-red-500 font-bold text-[9px] uppercase tracking-tighter bg-red-500/10 px-1.5 py-0.5 rounded border border-red-500/30 shadow-sm magnetic"><Lock className="w-2.5 h-2.5" /> {t('accounts.statusForbidden')}</div>
          ) : account.is_proxy_disabled ? (
            <div className="flex items-center gap-1 text-amber-500/80 font-bold text-[9px] uppercase tracking-tighter bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/30 shadow-sm magnetic"><ShieldAlert className="w-2.5 h-2.5" /> {t('accounts.statusBypassed')}</div>
          ) : (
            <div className="flex items-center gap-1 text-emerald-500/80 font-bold text-[9px] uppercase tracking-tighter bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/30 shadow-sm magnetic"><ShieldCheck className="w-2.5 h-2.5" /> {t('accounts.statusActive')}</div>
          )}
          <span className="text-foreground/45 font-mono font-bold uppercase text-[9px] tracking-[0.1em]">{account.quota?.last_updated ? new Date(account.quota.last_updated * 1000).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '00:00'}</span>
        </div>
      </div>

      <div className="flex-1 flex flex-col justify-center space-y-2.5">
        {account.status === 'Forbidden' || account.quota?.is_forbidden ? (
          <div className="py-3 px-3 flex items-center justify-between gap-3 bg-red-500/5 border border-red-500/10 rounded-xl overflow-hidden group/warn transition-all hover:bg-red-500/10 h-12">
            <div className="flex items-center gap-2 relative z-10 flex-1 min-w-0">
              <ShieldAlert className="w-4 h-4 text-red-500/60 shrink-0" />
              <span className="text-[10px] font-bold text-red-500 uppercase truncate">{t('accounts.accountAnomaly')}</span>
            </div>
            <div className="flex items-center gap-1.5 relative z-10 shrink-0">
               <button onClick={(e) => { e.stopPropagation(); setIsReasonOpen(true); }} className="text-[9px] font-black text-foreground/45 hover:text-blue-400 border border-glass-border px-2 py-0.5 rounded-[4px] bg-foreground/5 transition-all">{t('accounts.reason')}</button>
               <a 
                 href={account.quota?.appeal_url} 
                 target="_blank" 
                 rel="noopener noreferrer"
                 className="text-[9px] font-black text-blue-500 hover:text-blue-400 px-2.5 py-1 rounded-[4px] bg-blue-500/10 border border-blue-500/20"
               >
                 {t('accounts.appeal')}
               </a>
            </div>
          </div>
        ) : finalDisplayModels.length > 0 ? (
          <div className="flex flex-col gap-2.5">
            {finalDisplayModels.map((m) => {
              const colors = getStatusColor(m.percentage, m.name);
              return (
                <div key={m.name} className="group/model relative">
                  <div className="flex justify-between items-end mb-1 uppercase font-mono tracking-wider text-[9px] font-black">
                    <span className="flex items-center gap-1.5 text-foreground/45 group-hover/model:text-foreground/75 transition-colors">
                      <Cpu className={`w-2.5 h-2.5 ${colors.icon}`} /> {m.display_name || m.name}
                    </span>
                    {getStatusDisplay(m.percentage, m.reset_time)}
                  </div>
                  <div className="h-1 bg-foreground/[0.03] rounded-full overflow-hidden">
                    <div className={`h-full transition-all duration-1000 ${colors.bar}`} style={{ width: `${m.percentage}%` }}></div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="py-2 text-[10px] text-foreground/45 italic text-center border border-dashed border-glass-border rounded-xl uppercase">{t('accounts.noQuotaSynced')}</div>
        )}
      </div>
        
      <div className="pt-2 mt-auto border-t border-glass-border flex items-center justify-end">
        <div className="flex items-center gap-1.5 magnetic">
          <button onClick={(e) => { e.stopPropagation(); setIsDetailsOpen(true); }} className="p-1.5 text-foreground/65 hover:text-blue-400 bg-foreground/[0.05] border border-glass-border rounded-lg transition-colors shadow-sm" title={t('accounts.details')}><Maximize2 className="w-3.5 h-3.5" /></button>
          <button onClick={(e) => { e.stopPropagation(); setIsEditingLabel(!isEditingLabel); }} className={`p-1.5 bg-foreground/[0.05] border border-glass-border rounded-lg transition-colors shadow-sm ${account.label ? 'text-amber-500' : 'text-foreground/65'}`} title={t('accounts.tag')}><Tag className="w-3.5 h-3.5" /></button>
          <button onClick={handleRefresh} disabled={isRefreshing} className={`p-1.5 bg-foreground/[0.05] border border-glass-border rounded-lg transition-colors shadow-sm ${isRefreshing ? 'text-emerald-400' : 'text-foreground/65 hover:text-emerald-400'}`} title={t('accounts.refresh')}><RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} /></button>
          <button onClick={handleToggleProxy} disabled={isTogglingProxy} className={`p-1.5 bg-foreground/[0.05] border border-glass-border rounded-lg transition-colors shadow-sm ${account.is_proxy_disabled ? 'text-amber-500' : 'text-foreground/65 hover:text-blue-400'}`} title={account.is_proxy_disabled ? t('accounts.enableProxy') : t('accounts.disableProxy')}>
            {isTogglingProxy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : account.is_proxy_disabled ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
          </button>
          <button onClick={handleExport} className="p-1.5 text-foreground/65 hover:text-amber-400 bg-foreground/[0.05] border border-glass-border rounded-lg transition-colors shadow-sm" title={t('accounts.export')}><Download className="w-3.5 h-3.5" /></button>
          <button onClick={handleSwitch} disabled={isSwitching} className={`p-1.5 border rounded-lg transition-all shadow-[0_0_15px_rgba(59,130,246,0.1)] group/switch ${isSwitching ? 'text-emerald-400 bg-foreground/[0.05] border-glass-border' : 'text-blue-500/60 hover:text-blue-400 bg-blue-500/[0.08] hover:bg-blue-500/20 border-blue-500/20'}`} title={t('accounts.switchToIde')}>
            {isSwitching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRightLeft className="w-3.5 h-3.5 group-hover/switch:scale-110 transition-transform" />}
          </button>
          <button onClick={handleDelete} disabled={isDeleting} className="p-1.5 text-foreground/65 hover:text-red-500 bg-foreground/[0.05] border border-glass-border rounded-lg transition-colors shadow-sm" title={t('accounts.delete')}><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      <ModelDetailsModal isOpen={isDetailsOpen} onClose={() => setIsDetailsOpen(false)} account={account} />
      <ForbiddenReasonModal isOpen={isReasonOpen} onClose={() => setIsReasonOpen(false)} account={account} />
      <ConfirmModal 
        isOpen={isConfirmOpen}
        onClose={() => setIsConfirmOpen(false)}
        onConfirm={onConfirmDelete}
        title={t('accounts.deleteAccountTitle')}
        message={t('accounts.deleteAccountMsg', { email: account.email })}
        type="danger"
        confirmText={t('accounts.deleteConfirmBtn')}
      />
    </div>
  );
};

// --- Sortable Wrapper for AccountRow ---
const SortableAccountRow = ({ id, ...props }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 100 : 1,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <AccountRow {...props} dragHandleProps={{ ...attributes, ...listeners }} isDragging={isDragging} />
    </div>
  );
};

const AccountRow = ({ account, isSelected, onToggleSelect, onSwitch, dragHandleProps, isDragging }) => {
  const { t } = useTranslation();
  const { removeAccount, refreshQuota, exportAccount, updateAccountLabel, toggleProxyStatus } = useAccountStore();
  const { addToast } = useAppStore();
  const [isDeleting, setIsDeleting] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isReasonOpen, setIsReasonOpen] = useState(false);
  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [labelInput, setLabelInput] = useState(account.label || '');
  const [isTogglingProxy, setIsTogglingProxy] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);

  const handleUpdateLabel = async (e) => {
    e.stopPropagation();
    try {
      await updateAccountLabel(account.id, labelInput.trim() || null);
      setIsEditingLabel(false);
    } catch (err) {
      addToast(t('accounts.updateLabelFailed') + err.message, 'error');
    }
  };

  const handleToggleProxy = async (e) => {
    e.stopPropagation();
    if (isTogglingProxy) return;
    setIsTogglingProxy(true);
    try {
      await toggleProxyStatus(account.id, !account.is_proxy_disabled);
    } catch (err) {
      addToast(t('accounts.toggleProxyFailed') || 'Failed to toggle proxy status: ' + err.message, 'error');
    } finally {
      setIsTogglingProxy(false);
    }
  };

  const handleRefresh = async (e) => {
    e.stopPropagation();
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await refreshQuota(account.refresh_token);
    } catch (err) {
      console.error('Refresh failed:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSwitch = async (e) => {
    e.stopPropagation();
    if (isSwitching) return;
    setIsSwitching(true);
    try {
      await onSwitch(account);
    } finally {
      setIsSwitching(false);
    }
  };

  const handleRowClick = (e) => {
    if (e.target.closest('a') || e.target.closest('button')) {
      return;
    }
    onToggleSelect(account.id);
  };

  const handleDelete = async (e) => {
    e.stopPropagation();
    setIsConfirmOpen(true);
  };

  const onConfirmDelete = async () => {
    setIsConfirmOpen(false);
    setIsDeleting(true);
    try {
      await removeAccount(account.id);
      addToast(t('accounts.deleteSuccess') || 'Account deleted', 'success');
    } catch (err) {
      addToast(t('accounts.deleteFailed') + err.message, 'error');
      setIsDeleting(false);
    }
  };

  const displayModels = RECOMMENDED_MODELS.map(modelId => {
    const modelData = account.quota?.models?.find(m => m.name === modelId);
    if (!modelData) return null;
    let displayName = modelData.display_name || modelData.name;
    if (modelId === "gemini-3.1-pro-high") displayName = "Gemini 3.1 Pro";
    if (modelId === "gemini-3-flash-agent") displayName = "Gemini 3 Flash Agent";
    if (modelId === "claude-sonnet-4-6") displayName = "Claude Sonnet";
    return { ...modelData, display_name: displayName };
  }).filter(Boolean).slice(0, 3);

  return (
    <div 
      onClick={handleRowClick}
      className={`group spotlight-card flex items-center px-4 py-3 bg-foreground/[0.01] hover:bg-foreground/[0.03] border-b border-glass-border transition-all cursor-pointer ${isSelected ? 'bg-blue-500/[0.04]' : ''} ${account.is_proxy_disabled ? 'opacity-60 saturate-[0.8]' : ''}`}
      style={{
        '--glow-color': account.quota?.is_forbidden ? 'rgba(239, 68, 68, 0.1)' : 
                       account.is_proxy_disabled ? 'rgba(245, 158, 11, 0.1)' : 
                       'rgba(59, 130, 246, 0.1)'
      }}
    >
      <div className="grain-overlay" />
      {/* Column 1: Identity (22%) */}
      <div className="flex items-center gap-3 w-[22%] min-w-[180px]">
        <div onClick={(e) => e.stopPropagation()} className="shrink-0 flex items-center justify-center">
          <div 
            onClick={() => onToggleSelect(account.id)}
            className={`w-4 h-4 rounded border transition-all flex items-center justify-center ${isSelected ? 'bg-blue-500 border-blue-500 shadow-sm' : 'bg-foreground/5 border-glass-border group-hover:border-white/20'}`}
          >
            {isSelected && <Check className="w-3 h-3 text-white" strokeWidth={4} />}
          </div>
        </div>
        <div {...dragHandleProps} className="p-1 hover:bg-foreground/10 rounded cursor-grab active:cursor-grabbing text-foreground/45 hover:text-foreground/65 transition-colors">
          <GripVertical className="w-4 h-4" />
        </div>
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-[13px] md:text-sm font-black text-foreground/95 truncate italic tracking-tight mb-1" title={account.email}>{account.email || 'Unknown Node'}</span>
          <div className="flex flex-wrap gap-1 items-center">
            {account.quota?.subscription_tier && (
              <a 
                href={account.quota?.is_forbidden ? account.quota?.appeal_url : undefined}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => { if (!account.quota?.is_forbidden || !account.quota?.appeal_url) e.preventDefault(); }}
                className={`px-1.5 py-0.5 rounded-[3px] text-[9.5px] font-black uppercase tracking-wider border transition-all ${
                account.quota.is_forbidden ? 'bg-rose-500/30 text-rose-400 border-rose-500/40 shadow-sm animate-pulse cursor-pointer' :
                account.quota.subscription_tier.includes('ULTRA') ? 'bg-indigo-600/30 text-indigo-300 border-indigo-500/40' :
                account.quota.subscription_tier.includes('PRO') ? 'bg-amber-500/25 text-amber-300 border-amber-500/40' :
                'bg-foreground/5 text-foreground/65 border-glass-border'
              }`}
              >
                {account.quota?.is_forbidden && <Lock className="w-2.5 h-2.5 inline mr-1" />}
                {account.quota.subscription_tier.replace('GOOGLE AI ', '')}
              </a>
            )}
            {isEditingLabel ? (
              <div className="flex items-center gap-1 bg-foreground/5 border border-white/20 rounded p-0.5" onClick={e => e.stopPropagation()}>
                <input autoFocus type="text" value={labelInput} onChange={(e) => setLabelInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleUpdateLabel(e); if (e.key === 'Escape') setIsEditingLabel(false); }} className="bg-transparent border-none outline-none text-[9px] text-foreground w-16 px-0.5" />
                <button onClick={handleUpdateLabel} className="text-emerald-400 p-0.5 hover:bg-emerald-400/10 rounded"><Check className="w-2.5 h-2.5" /></button>
              </div>
            ) : (
              <span onClick={(e) => { e.stopPropagation(); setIsEditingLabel(true); }} className={`px-1.5 py-0.5 rounded-[3px] text-[9.5px] font-black italic border border-dashed transition-all ${account.label ? 'text-amber-400 border-amber-500/30 bg-amber-500/10' : 'text-foreground/65 border-glass-border hover:text-foreground/85 hover:bg-foreground/5'}`}>
                {account.label || `+ ${t('accounts.tag')}`}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Column 2: Quotas (flex-1) */}
      <div className="flex-1 flex gap-4 px-6 overflow-hidden min-w-0">
        {account.status === 'Forbidden' || account.quota?.is_forbidden ? (
          <div className="flex items-center justify-between w-full px-4 py-1.5 bg-red-500/5 border border-red-500/10 rounded-lg group/warn transition-all hover:bg-red-500/10 h-10">
            <div className="flex items-center gap-2 relative z-10 flex-1 min-w-0 text-red-500 text-[10px] font-bold uppercase truncate">
              <ShieldAlert className="w-4 h-4 shrink-0 opacity-60" /> {t('accounts.accountAnomaly')}
            </div>
            <div className="flex items-center gap-1.5 relative z-10 shrink-0 ml-2">
               <button onClick={(e) => { e.stopPropagation(); setIsReasonOpen(true); }} className="text-[9px] font-black text-foreground/45 hover:text-blue-400 border border-glass-border px-1.5 py-0.5 rounded-[4px] bg-foreground/5 transition-all truncate">{t('accounts.reason')}</button>
               <a 
                 href={account.quota?.appeal_url} 
                 target="_blank" 
                 rel="noopener noreferrer"
                 className="text-[9px] font-black text-blue-500 hover:text-blue-400 px-2 py-0.5 rounded-[4px] bg-blue-500/10 border border-blue-500/20 truncate"
               >
                 {t('accounts.appeal')}
               </a>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-4 w-full min-w-0">
            {displayModels.map((m) => {
              const colors = getStatusColor(m.percentage, m.name);
              return (
                <div key={m.name} className="flex flex-col gap-1 min-w-0">
                  <div className="flex items-center text-[9px] font-bold uppercase tracking-tight">
                    <span className="flex items-center gap-1.5 text-foreground/80 truncate group-hover:text-foreground transition-colors overflow-hidden">
                      <Cpu className={`w-3 h-3 shrink-0 ${colors.icon}`} /> 
                      <span className="truncate">{m.display_name}</span>
                    </span>
                  </div>
                  <div className="h-1 bg-foreground/[0.06] rounded-full overflow-hidden">
                    <div className={`h-full transition-all duration-1000 ${colors.bar}`} style={{ width: `${m.percentage}%` }}></div>
                  </div>
                  <div className="flex justify-between items-center text-[8px] font-black font-mono tracking-tighter truncate uppercase mt-0.5 min-w-0 gap-1 opacity-60">
                    <span className={`${colors.text} shrink-0`}>{m.percentage}%</span>
                    <span className="text-foreground/65 truncate">{m.reset_time ? formatResetTime(m.reset_time) : t('accounts.refreshed')}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Column 3: Status (12%) */}
      <div className="w-[12%] min-w-[90px] flex flex-col items-start justify-center gap-1 shrink-0 px-4 overflow-hidden">
        {account.status === 'Forbidden' || account.quota?.is_forbidden ? (
          <div className="flex items-center gap-1 text-[9px] font-black tracking-widest text-red-500 truncate">
            <Lock className="w-2.5 h-2.5" />
            <span className="truncate">{t('accounts.statusForbidden')}</span>
          </div>
        ) : (
          <div className={`flex items-center gap-1 text-[9px] font-black tracking-widest ${account.is_proxy_disabled ? 'text-amber-400' : 'text-emerald-400'} truncate`}>
            {account.is_proxy_disabled ? <ShieldAlert className="w-2.5 h-2.5" /> : <ShieldCheck className="w-2.5 h-2.5" />}
            <span className="truncate">{account.is_proxy_disabled ? t('accounts.statusBypassed') : t('accounts.statusActive')}</span>
          </div>
        )}
        <div className="text-[8px] text-foreground/45 font-mono font-bold tracking-[0.1em] flex items-center gap-1 truncate uppercase">
          <span className="shrink-0">{account.quota?.last_updated ? new Date(account.quota.last_updated * 1000).toLocaleDateString([], {month:'2-digit', day:'2-digit'}) : '00/00'}</span>
          <span className="text-foreground/40 shrink-0">{account.quota?.last_updated ? new Date(account.quota.last_updated * 1000).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', hour12: false}) : '00:00'}</span>
        </div>
      </div>

      {/* Column 4: Actions (20%) */}
      <div className="w-[20%] min-w-[170px] flex items-center justify-end gap-1.5 transition-all shrink-0 pr-6 flex-wrap">
        <button onClick={(e) => { e.stopPropagation(); setIsDetailsOpen(true); }} className="p-1.5 text-foreground/65 hover:text-blue-400 bg-foreground/[0.03] hover:bg-blue-400/5 border border-glass-border rounded-lg transition-all" title={t('accounts.details')}><Maximize2 className="w-3.5 h-3.5" /></button>
        <button onClick={handleRefresh} disabled={isRefreshing} className="p-1.5 text-foreground/65 hover:text-emerald-400 bg-foreground/[0.03] hover:bg-emerald-400/5 border border-glass-border rounded-lg transition-all" title={t('accounts.refresh')}><RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} /></button>
        <button onClick={(e) => { e.stopPropagation(); setIsEditingLabel(true); }} className={`p-1.5 border border-glass-border rounded-lg transition-all bg-foreground/[0.03] ${account.label ? 'text-amber-500 hover:text-amber-400 hover:bg-amber-400/5' : 'text-foreground/65 hover:text-foreground hover:bg-foreground/10'}`} title={t('accounts.tag')}><Tag className="w-3.5 h-3.5" /></button>
        <button onClick={handleToggleProxy} disabled={isTogglingProxy} className={`p-1.5 border border-glass-border rounded-lg transition-all bg-foreground/[0.03] ${account.is_proxy_disabled ? 'text-amber-500 hover:text-amber-400 hover:bg-amber-400/5' : 'text-foreground/65 hover:text-blue-400 hover:bg-blue-400/5'}`} title={account.is_proxy_disabled ? t('accounts.enableProxy') : t('accounts.disableProxy')}>
          {isTogglingProxy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : account.is_proxy_disabled ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
        </button>
        <button onClick={(e) => { e.stopPropagation(); exportAccount(account); }} className="p-1.5 text-foreground/65 hover:text-amber-400 bg-foreground/[0.03] hover:bg-amber-400/5 border border-glass-border rounded-lg transition-all" title={t('accounts.export')}><Download className="w-3.5 h-3.5" /></button>
        <button onClick={handleSwitch} disabled={isSwitching} className={`p-1.5 border rounded-lg transition-all group/switch ${isSwitching ? 'text-emerald-400 bg-foreground/[0.03] border-glass-border' : 'text-blue-500/50 hover:text-blue-400 bg-blue-500/[0.05] hover:bg-blue-500/10 border-blue-500/20'}`} title={t('accounts.switchToIde')}>
          {isSwitching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRightLeft className="w-3.5 h-3.5 group-hover/switch:scale-110 transition-transform" />}
        </button>
        <button onClick={handleDelete} disabled={isDeleting} className="p-1.5 text-foreground/65 hover:text-rose-500 bg-foreground/[0.03] hover:bg-rose-500/5 border border-glass-border rounded-lg transition-all" title={t('accounts.delete')}><Trash2 className="w-3.5 h-3.5" /></button>
      </div>

      <ModelDetailsModal isOpen={isDetailsOpen} onClose={() => setIsDetailsOpen(false)} account={account} />
      <ForbiddenReasonModal isOpen={isReasonOpen} onClose={() => setIsReasonOpen(false)} account={account} />
      <ConfirmModal 
        isOpen={isConfirmOpen}
        onClose={() => setIsConfirmOpen(false)}
        onConfirm={onConfirmDelete}
        title={t('accounts.deleteAccountTitle')}
        message={t('accounts.deleteAccountMsg', { email: account.email })}
        type="danger"
        confirmText={t('accounts.deleteConfirmBtn')}
      />
    </div>
  );
};

const Accounts = () => {
  const { t } = useTranslation();
  const spotlightRef = useSpotlight();
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(() => {
    return Number(localStorage.getItem('antigravity_items_per_page')) || 12;
  });

  useEffect(() => {
    localStorage.setItem('antigravity_items_per_page', itemsPerPage);
  }, [itemsPerPage]);

  const [viewMode, setViewMode] = useState(() => {
    return localStorage.getItem('ant_view_mode') || 'grid';
  });

  useEffect(() => {
    localStorage.setItem('ant_view_mode', viewMode);
  }, [viewMode]);

  const [jumpPage, setJumpPage] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTier, setFilterTier] = useState('ALL');
  const [selectedIds, setSelectedIds] = useState([]);
  const [batchRefreshing, setBatchRefreshing] = useState(false);
  const [isGlobalRefreshing, setIsGlobalRefreshing] = useState(false);
  const [isBatchDeleteOpen, setIsBatchDeleteOpen] = useState(false);

  const { accounts, fetchAccounts, loading, refreshQuota, removeAccount, exportAccount, switchAccount, toggleProxyStatus, updateAccountLabel, reorderAccounts } = useAccountStore();
  const { addToast } = useAppStore();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = async (event) => {
    const { active, over } = event;
    if (active && over && active.id !== over.id) {
      const oldIndex = accounts.findIndex(acc => acc.id === active.id);
      const newIndex = accounts.findIndex(acc => acc.id === over.id);
      
      if (oldIndex !== -1 && newIndex !== -1) {
        const newAccounts = arrayMove(accounts, oldIndex, newIndex);
        const newAccountIds = newAccounts.map(acc => acc.id);
        
        try {
          await reorderAccounts(newAccountIds);
        } catch (err) {
          addToast(t('accounts.reorderFailed') || 'Reorder failed', 'error');
        }
      }
    }
  };

  // 🚀 实时同步逻辑: 监听后端 SSE 事件并自动刷新页面
  useEffect(() => {
    let eventSource;
    let disposed = false;

    const startStream = async () => {
      const apiBaseUrl = await resolveApiBaseUrl();
      if (disposed) return;

      eventSource = new EventSource(apiBaseUrl + '/accounts/events');
      eventSource.onmessage = (event) => {
        console.log('📬 收到账号变更通知:', event.data);
        if (event.data !== 'connected') {
          fetchAccounts();
        }
      };

      eventSource.onerror = (err) => {
        console.error('⚠️ SSE 连接异常:', err);
      };
    };

    startStream();

    return () => {
      disposed = true;
      console.log('🔌 关闭账号变更通知连接');
      eventSource?.close();
    };
  }, [fetchAccounts]);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  const handleSwitchToIde = async (account) => {
    try {
      await switchAccount(account.id);
      addToast(t('accounts.switchSuccess') || 'Account switched to IDE successfully', 'success');
    } catch (err) {
      console.error('Switch failed:', err);
      addToast(t('accounts.switchFailed') + err.message, 'error');
    }
  };

  const filteredAccounts = accounts.filter(acc => {
    const matchesSearch = acc.email.toLowerCase().includes(searchQuery.toLowerCase()) || 
                         acc.id.includes(searchQuery.toLowerCase()) || 
                         (acc.label && acc.label.toLowerCase().includes(searchQuery.toLowerCase()));
    if (!matchesSearch) return false;
    if (filterTier === 'ALL') return true;
    if (filterTier === 'ACTIVE') return acc.status === 'Active' && !acc.is_proxy_disabled && !acc.quota?.is_forbidden;
    if (filterTier === 'DISABLED') return acc.quota?.is_forbidden === true || acc.is_proxy_disabled === true;
    if (filterTier === 'PRO') return (acc.quota?.subscription_tier || '').toUpperCase().includes('PRO') && !acc.quota?.is_forbidden;
    if (filterTier === 'FREE') return (acc.quota?.subscription_tier || '').toUpperCase().includes('FREE') && !acc.quota?.is_forbidden;
    return acc.label === filterTier;
  });

  const uniqueLabels = Array.from(new Set(accounts.map(acc => acc.label).filter(Boolean))).sort();

  const totalItems = filteredAccounts.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const pagedAccounts = filteredAccounts.slice(startIndex, startIndex + itemsPerPage);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, filterTier]);

  const toggleSelect = (id) => setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);

  const handleSelectAll = () => {
    if (selectedIds.length === filteredAccounts.length) setSelectedIds([]);
    else setSelectedIds(filteredAccounts.map(a => a.id));
  };

  const handleGlobalRefresh = async () => {
    if (loading || isGlobalRefreshing || accounts.length === 0) return;
    setIsGlobalRefreshing(true);
    try {
      await Promise.all(accounts.map(acc => refreshQuota(acc.refresh_token)));
    } catch (err) {
      console.error('Global refresh failed:', err);
    } finally {
      setIsGlobalRefreshing(false);
    }
  };

  const handleBatchRefresh = async () => {
    if (batchRefreshing || selectedIds.length === 0) return;
    setBatchRefreshing(true);
    try {
      const selectedAccounts = accounts.filter(a => selectedIds.includes(a.id));
      for (const acc of selectedAccounts) await refreshQuota(acc.refresh_token);
    } finally { setBatchRefreshing(false); }
  };

  const handleBatchDelete = () => {
    if (selectedIds.length === 0) return;
    setIsBatchDeleteOpen(true);
  };

  const onConfirmBatchDelete = async () => {
    setIsBatchDeleteOpen(false);
    for (const id of selectedIds) await removeAccount(id);
    setSelectedIds([]);
  };

  const handleBatchExport = () => {
    if (selectedIds.length === 0) return;
    accounts.filter(a => selectedIds.includes(a.id)).forEach(acc => exportAccount(acc));
  };
  
  const handleBatchProxyStatus = async (disabled) => {
    if (selectedIds.length === 0) return;
    for (const id of selectedIds) {
      try {
        await toggleProxyStatus(id, disabled);
      } catch (err) {
        console.error(`批量更新代理状态失败 (ID: ${id}):`, err);
      }
    }
    // 全部处理完后取消选择
    setSelectedIds([]);
  };

  const handleJumpPage = (e) => {
    e.preventDefault();
    const pageNum = parseInt(jumpPage);
    if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages) {
      setCurrentPage(pageNum);
      setJumpPage('');
    }
  };

  return (
    <div className="space-y-8 fade-in relative min-h-screen pb-40">
      <div className="sticky top-0 z-[100] -mx-4 px-4 py-4 mb-8 bg-background/60 backdrop-blur-2xl border-b border-glass-border flex flex-col md:flex-row justify-between items-center gap-4 transition-all duration-300">
        <div className="flex items-center gap-6 px-4">
          <div className="flex flex-col">
            <span className="text-[10px] font-black text-foreground/20 uppercase tracking-[0.3em]">{t('accounts.matrixNodes')}</span>
            <span className="text-xl font-black italic tracking-tight">{accounts.filter(a => a.status === 'Active' && !a.is_proxy_disabled && !a.quota?.is_forbidden).length} <span className="text-foreground/20 text-sm font-normal not-italic mx-1">/</span> {accounts.length}</span>
          </div>
          <div className="h-8 w-px bg-foreground/5 hidden md:block"></div>
          
          <button onClick={handleSelectAll} className={`p-2 rounded-lg transition-all border flex items-center justify-center ${selectedIds.length > 0 && selectedIds.length === filteredAccounts.length ? 'bg-blue-500/20 border-blue-500/40 text-blue-500' : 'bg-foreground/5 border-glass-border text-foreground/20 hover:text-foreground'}`} title={t('accounts.all')}><Check className="w-4 h-4" /></button>

          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/20 group-focus-within:text-blue-500 transition-colors" />
            <input type="text" placeholder={t('accounts.searchPlaceholder')} className="bg-foreground/[0.03] border border-glass-border px-8 py-2 rounded-full text-[10px] font-bold outline-none focus:border-blue-500/50 transition-all w-28 md:w-36 lg:w-48" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          </div>

          <div className="h-6 w-px bg-foreground/5 hidden lg:block"></div>

          <div className="flex gap-2 overflow-x-auto scrollbar-none max-w-[400px]">
            <div className="flex bg-foreground/5 p-1 rounded-full gap-1 border border-glass-border shrink-0">
              {['ALL', 'ACTIVE', 'PRO', 'FREE', 'DISABLED'].map(tier => (
                <button key={tier} onClick={() => setFilterTier(tier)} className={`px-4 py-1.5 rounded-full text-[10px] font-black transition-all uppercase ${filterTier === tier ? 'bg-foreground/10 text-foreground' : 'text-foreground/40 hover:text-foreground/60'}`}>
                  {tier === 'ALL' ? t('accounts.all') : tier === 'ACTIVE' ? t('dashboard.active') : tier === 'PRO' ? t('accounts.pro') : tier === 'FREE' ? t('accounts.free') : tier === 'DISABLED' ? t('accounts.disabled') : tier}
                </button>
              ))}
            </div>
            {uniqueLabels.length > 0 && (
              <div className="flex bg-foreground/5 p-1 rounded-full gap-1 border border-glass-border shrink-0">
                {uniqueLabels.map(label => (
                  <button key={label} onClick={() => setFilterTier(label)} className={`px-4 py-1.5 rounded-full text-[10px] font-black transition-all flex items-center gap-1.5 ${filterTier === label ? 'bg-amber-500 text-background shadow-[0_0_15px_rgba(245,158,11,0.4)]' : 'hover:bg-amber-500/10 text-foreground/40'}`}><Tag className="w-2.5 h-2.5" />{label}</button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
            <button 
              onClick={handleGlobalRefresh} 
               disabled={isGlobalRefreshing}
              className={`w-10 h-10 flex items-center justify-center bg-foreground/[0.03] border border-glass-border rounded-xl transition-all active:scale-95 ${isGlobalRefreshing ? 'text-emerald-400 shadow-[0_0_15px_rgba(52,211,153,0.3)]' : 'text-foreground/40 hover:text-foreground hover:bg-foreground/10'}`}
              title={t('accounts.refresh')}
            >
              <RefreshCw className={`w-4 h-4 ${isGlobalRefreshing ? 'animate-spin' : ''}`} />
            </button>

            <div className="h-10 p-1 bg-foreground/[0.03] border border-glass-border rounded-xl flex gap-1">
              <button 
                onClick={() => setViewMode('grid')}
                className={`w-8 h-8 rounded-lg transition-all flex items-center justify-center ${viewMode === 'grid' ? 'btn-matrix-pill-active' : 'btn-matrix-pill-inactive'}`}
                title={t('accounts.gridView')}
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`w-8 h-8 rounded-lg transition-all flex items-center justify-center ${viewMode === 'list' ? 'btn-matrix-pill-active' : 'btn-matrix-pill-inactive'}`}
                title={t('accounts.listView')}
              >
                <List className="w-4 h-4" />
              </button>
            </div>

            <button
              onClick={() => setIsModalOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 btn-matrix-primary text-[11px] font-black rounded-xl shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              {t('accounts.addAccount')}
            </button>
          </div>

          <ConfirmModal
            isOpen={isBatchDeleteOpen}
            onClose={() => setIsBatchDeleteOpen(false)}
            onConfirm={onConfirmBatchDelete}
            title={t('accounts.batchDeleteTitle')}
            message={t('accounts.batchDeleteMsg', { count: selectedIds.length })}
            type="danger"
            confirmText={t('accounts.batchDeleteConfirmBtn')}
          />
        </div>

        <div className="relative">
          {pagedAccounts.length > 0 ? (
            viewMode === 'grid' ? (
              <DndContext 
                sensors={sensors} 
                collisionDetection={closestCenter} 
                onDragEnd={handleDragEnd}
              >
                <SortableContext 
                  items={pagedAccounts.map(a => a.id)} 
                  strategy={rectSortingStrategy}
                >
                  <div ref={spotlightRef} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 px-6 animate-in slide-in-from-bottom-4 duration-500 spotlight-group">
                    {pagedAccounts.map(account => (
                      <SortableAccountCard
                        key={account.id}
                        id={account.id}
                        account={account}
                        isSelected={selectedIds.includes(account.id)}
                        onToggleSelect={toggleSelect}
                        onSwitch={handleSwitchToIde}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            ) : (
              <DndContext 
                sensors={sensors} 
                collisionDetection={closestCenter} 
                onDragEnd={handleDragEnd}
              >
                <SortableContext 
                  items={pagedAccounts.map(a => a.id)} 
                  strategy={verticalListSortingStrategy}
                >
                  <div ref={spotlightRef} className="flex flex-col px-6 animate-in slide-in-from-bottom-4 duration-500 spotlight-group">
                    {/* Table Header */}
                    <div className="sticky top-0 z-10 flex items-center px-4 py-3 bg-background/90 backdrop-blur-md border-b border-glass-border text-[11px] font-black uppercase tracking-[0.25em] text-foreground/60 shadow-sm">
                      <div className="flex items-center gap-3 w-[22%] min-w-[180px] px-4">{t('accounts.tableHeaderIdentity')}</div>
                      <div className="flex-1 px-6">{t('accounts.tableHeaderQuota')}</div>
                      <div className="w-[12%] min-w-[90px] px-4">{t('accounts.tableHeaderStatus')}</div>
                      <div className="w-[20%] min-w-[170px] text-right pr-6">{t('accounts.tableHeaderActions')}</div>
                    </div>
                    {/* Table Rows */}
                    <div className="flex flex-col">
                      {pagedAccounts.map(account => (
                        <SortableAccountRow
                          key={account.id}
                          id={account.id}
                          account={account}
                          isSelected={selectedIds.includes(account.id)}
                          onToggleSelect={toggleSelect}
                          onSwitch={handleSwitchToIde}
                        />
                      ))}
                    </div>
                  </div>
                </SortableContext>
              </DndContext>
            )
          ) : (
            <div className="mx-6 h-64 flex flex-col items-center justify-center gap-4 bg-foreground/[0.01] border border-dashed border-glass-border rounded-[3rem] text-foreground/10 uppercase tracking-[0.5em] text-[10px] font-black italic cursor-pointer hover:bg-foreground/[0.02] transition-all" onClick={() => setIsModalOpen(true)}>
              {t('accounts.noAccounts')}
            </div>
          )}
        </div>

      <AddAccountModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />

      {/* Combined Action/Navigation Footer */}
      {(filteredAccounts.length > 0 || selectedIds.length > 0) && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[500] flex flex-col items-center gap-3 w-fit transition-all duration-500">

          {/* Pagination Bar */}
          {filteredAccounts.length > 0 && (
            <div className={`flex items-center gap-4 bg-background/80 border border-glass-border p-2 rounded-2xl backdrop-blur-2xl shadow-2xl transition-all duration-500 ${selectedIds.length > 0 ? 'scale-90 opacity-40 hover:opacity-100 hover:scale-100 border-glass-border' : 'scale-100 opacity-100'}`}>
              <div className="flex items-center gap-1.5 shrink-0 px-2 border-r border-glass-border">
                <span className="text-[9px] font-black text-foreground/20 uppercase tracking-tighter">{t('accounts.paginationSize')}</span>
                <select
                  value={itemsPerPage}
                  onChange={(e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }}
                  className="bg-transparent text-[10px] font-black text-blue-500 outline-none cursor-pointer hover:text-blue-400 transition-colors"
                >
                  {[12, 24, 48, 96].map(v => <option key={v} value={v} className="bg-background text-foreground">{v}</option>)}
                </select>
              </div>

              {totalPages > 1 && (
                <>
                  <div className="flex items-center gap-2">
                    <button
                      disabled={currentPage === 1}
                      onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                      className="px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-foreground/40 hover:text-foreground disabled:opacity-20 transition-all border border-glass-border rounded-xl hover:bg-foreground/5"
                    >
                      {t('accounts.prev')}
                    </button>

                    <div className="flex items-center gap-1 px-1">
                      <span className="text-xs font-black italic text-blue-500">{currentPage}</span>
                      <span className="text-[10px] font-bold text-foreground/10 uppercase mx-1">/</span>
                      <span className="text-xs font-black italic text-foreground/40">{totalPages}</span>
                    </div>

                    <button
                      disabled={currentPage === totalPages}
                      onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                      className="px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-foreground/40 hover:text-foreground disabled:opacity-20 transition-all border border-glass-border rounded-xl hover:bg-foreground/5"
                    >
                      {t('accounts.next')}
                    </button>
                  </div>

                   <form onSubmit={handleJumpPage} className="flex items-center gap-1.5 shrink-0 px-2 border-l border-glass-border">
                    <input
                      type="text"
                      value={jumpPage}
                      onChange={(e) => setJumpPage(e.target.value)}
                      placeholder={t('accounts.jump')}
                      className="w-8 bg-foreground/5 border border-glass-border rounded-lg py-1 px-1 text-[10px] font-black text-center text-foreground outline-none focus:border-blue-500/50 transition-all placeholder:text-foreground/10"
                    />
                    <button type="submit" className="text-[9px] font-black text-foreground/20 hover:text-blue-500 transition-colors uppercase tracking-tight">{t('accounts.jump')}</button>
                  </form>
                </>
              )}
            </div>
          )}

          {/* Batch Action Bar */}
          {selectedIds.length > 0 && (
            <div className="bg-background/60 border border-glass-border backdrop-blur-3xl px-6 py-4 rounded-[2rem] flex items-center gap-6 shadow-[0_20px_50px_rgba(0,0,0,0.5)] ring-1 ring-glass-border animate-in slide-in-from-bottom-4 duration-500">
              <div className="flex flex-col"><span className="text-[10px] font-black text-foreground/40 uppercase tracking-[0.2em] whitespace-nowrap">{t('accounts.selected')}</span><span className="text-sm font-black italic text-blue-400">{selectedIds.length} <span className="text-[10px] text-foreground/20 not-italic mx-1">{t('accounts.nodes')}</span></span></div>
              <div className="h-8 w-px bg-foreground/5"></div>
              <div className="flex items-center gap-2">
                <button onClick={handleBatchRefresh} disabled={batchRefreshing} className="flex items-center gap-2 px-4 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 rounded-full text-[10px] font-black text-emerald-400 active:scale-95 disabled:opacity-50"><RefreshCw className={`w-3 h-3 ${batchRefreshing ? 'animate-spin' : ''}`} />{batchRefreshing ? '...' : t('accounts.syncAll')}</button>
                <button onClick={() => handleBatchProxyStatus(true)} className="flex items-center gap-2 px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 rounded-full text-[10px] font-black text-amber-400 active:scale-95"><ShieldOff className="w-3 h-3" />{t('accounts.batchDisable') || '批量禁用'}</button>
                <button onClick={() => handleBatchProxyStatus(false)} className="flex items-center gap-2 px-4 py-2 bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/30 rounded-full text-[10px] font-black text-blue-400 active:scale-95"><ShieldCheck className="w-3 h-3" />{t('accounts.batchEnable') || '批量恢复'}</button>
                <button onClick={handleBatchExport} className="flex items-center gap-2 px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 rounded-full text-[10px] font-black text-amber-400 active:scale-95"><Download className="w-3 h-3" />{t('accounts.exportAll')}</button>
                <button onClick={handleBatchDelete} className="flex items-center gap-2 px-4 py-2 bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/30 rounded-full text-[10px] font-black text-rose-400 active:scale-95"><Trash2 className="w-3 h-3" />{t('accounts.purgeAll')}</button>
                <button onClick={() => setSelectedIds([])} className="w-8 h-8 flex items-center justify-center hover:bg-foreground/5 rounded-full text-foreground/20 hover:text-foreground transition-all ml-2"><X className="w-4 h-4" /></button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Accounts;
