import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Globe, FileCode, CheckCircle2, XCircle, Loader2, Link2, Plus, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isTauri, resolveBackendOrigin, resolvePublicApiOrigin } from '../api/client';
import { openUrl as tauriOpen } from '@tauri-apps/plugin-opener';
import useAccountStore from '../store/useAccountStore';

const AddAccountModal = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('oauth');
  const [callbackUrl, setCallbackUrl] = useState('');
  const [tokensText, setTokensText] = useState('');
  const [status, setStatus] = useState('idle'); // idle, loading, success, error
  const [message, setMessage] = useState('');

  const { importByCallbackUrl, importByTokens } = useAccountStore();

  function resetState() {
    setStatus('idle');
    setMessage('');
    setCallbackUrl('');
    setTokensText('');
  }

  // 监听 OAuth 成功消息 (从弹出的授权页传回)
  useEffect(() => {
    const handleOAuthMessage = (event) => {
      if (event.data?.type === 'oauth-success') {
        setStatus('success');
        setMessage(t('accounts.oauthSuccess'));
        setTimeout(() => {
          onClose();
          resetState();
        }, 1500);
      }
    };
    window.addEventListener('message', handleOAuthMessage);
    return () => window.removeEventListener('message', handleOAuthMessage);
  }, [onClose, t]);

  // [桌面端专用] 监听后端发出的账号导入成功事件
  useEffect(() => {
    if (status !== 'loading' || !isTauri) return;
  
    const { fetchAccounts } = useAccountStore.getState();
    const initialCount = useAccountStore.getState().accounts.length;
    let pollInterval;
    let eventSource;
    let disposed = false;
    
    const handleSuccess = () => {
      if (disposed) return;
      setStatus('success');
      setMessage(t('accounts.oauthSuccess'));
      setTimeout(() => {
        onClose();
        resetState();
      }, 1500);
    };

    const startListeners = async () => {
      const apiOrigin = await resolveBackendOrigin();
      if (disposed) return;

      eventSource = new EventSource(`${apiOrigin}/v1/accounts/events`);
      eventSource.onmessage = (event) => {
        if (event.data === 'imported') {
          console.log('SSE: Received imported event');
          handleSuccess();
          eventSource.close();
        }
      };

      pollInterval = setInterval(async () => {
        try {
          await fetchAccounts();
          const currentCount = useAccountStore.getState().accounts.length;
          if (currentCount > initialCount) {
            console.log('Polling: Account count increased, success');
            handleSuccess();
            clearInterval(pollInterval);
            eventSource?.close();
          }
        } catch (e) {
          console.warn('Polling check failed:', e);
        }
      }, 2000);

      eventSource.onerror = () => eventSource.close();
    };

    startListeners();

    return () => {
      disposed = true;
      eventSource?.close();
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [status, onClose, t]);

  const handleOAuthStart = async () => {
    const apiOrigin = await resolvePublicApiOrigin();
    const loginUrl = `${apiOrigin}/v1/auth/login`;
    
    setStatus('loading');
    setMessage(t('accounts.oauthPending'));

    if (isTauri) {
      try {
        // 在桌面端，直接请求后端的 /v1/auth/login 接口以触发其内部的 open::that()
        // 既然 isTauri 的检测已经修正，fetch 能够稳定触发后端逻辑
        console.log('Fetching OAuth login URL:', loginUrl);
        await fetch(loginUrl, { mode: 'no-cors' });
      } catch (err) {
        // 只有在请求完全失败时（例如网络异常），才尝试使用桌面插件强行唤起
        console.warn('OAuth fetch attempt failed, trying fallback:', err);
        await tauriOpen(loginUrl).catch(e => {
          console.error('All OAuth methods failed:', e);
          setStatus('error');
          setMessage(t('accounts.importFailed', { error: e.message || 'Browser could not be opened' }));
        });
      }
    } else {
      // 纯 Web 环境下使用普通的 window.open，后端也会调用 open::that
      window.open(loginUrl, '_blank', 'width=600,height=700');
    }
  };

  const handleUrlSubmit = async () => {
    if (!callbackUrl.trim()) return;
    setStatus('loading');
    setMessage(t('accounts.importingUrl'));
    try {
      await importByCallbackUrl(callbackUrl.trim());
      setStatus('success');
      setMessage(t('accounts.importUrlSuccess'));
      setTimeout(() => {
        onClose();
        resetState();
      }, 1500);
    } catch (err) {
      setStatus('error');
      setMessage(t('accounts.importFailed', { error: err.message }));
    }
  };

  const handleTokenSubmit = async () => {
    if (!tokensText.trim()) return;
    setStatus('loading');
    
    // 正则提取所有以 1// 开头的 Refresh Token
    const regex = /1\/\/[a-zA-Z0-9_-]+/g;
    const tokens = [...new Set(tokensText.match(regex) || [])];
    
    if (tokens.length === 0) {
      setStatus('error');
      setMessage(t('accounts.noTokenFound'));
      return;
    }

    setMessage(t('accounts.importingTokens', { count: tokens.length }));
    const count = await importByTokens(tokens);
    
    if (count > 0) {
      setStatus('success');
      setMessage(t('accounts.importTokensSuccess', { count }));
      setTimeout(() => {
        onClose();
        resetState();
      }, 1500);
    } else {
      setStatus('error');
      setMessage(t('accounts.importTokensFailed'));
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
      <div 
        className="absolute inset-0 bg-background/80 backdrop-blur-md animate-in fade-in duration-300" 
        onClick={onClose}
      ></div>
      
      <div className="w-full max-w-lg bg-background border border-glass-border rounded-2xl shadow-2xl overflow-hidden relative z-10 animate-in fade-in zoom-in-95 duration-300">
        {/* Header */}
        <div className="px-6 py-4 border-b border-glass-border flex justify-between items-center bg-foreground/[0.02]">
          <h3 className="text-lg font-bold text-foreground/90 flex items-center gap-2">
            <Plus className="w-5 h-5 text-blue-500" />
            {t('accounts.addAccount')}
          </h3>
          <button onClick={onClose} className="text-foreground/65 hover:text-foreground transition-colors">✕</button>
        </div>

        {/* Tabs */}
        <div className="p-1 mx-6 mt-6 bg-foreground/5 rounded-xl grid grid-cols-2 gap-1 text-sm font-medium">
          <button 
            onClick={() => { setActiveTab('oauth'); resetState(); }}
            className={`py-2 rounded-lg flex items-center justify-center gap-2 transition-all ${activeTab === 'oauth' ? 'btn-matrix-pill-active' : 'btn-matrix-pill-inactive'}`}
          >
            <Globe className="w-4 h-4" /> {t('accounts.oauthTab')}
          </button>
          <button 
            onClick={() => { setActiveTab('token'); resetState(); }}
            className={`py-2 rounded-lg flex items-center justify-center gap-2 transition-all ${activeTab === 'token' ? 'btn-matrix-pill-active' : 'btn-matrix-pill-inactive'}`}
          >
            <FileCode className="w-4 h-4" /> {t('accounts.tokenTab')}
          </button>
        </div>

        {/* Content */}
        <div className="p-6 min-h-[320px] flex flex-col justify-between">
          <div>
            {/* Status Alert */}
            {status !== 'idle' && (
              <div className={`mb-6 p-4 rounded-xl flex items-center gap-3 border ${
                status === 'loading' ? 'bg-blue-500/10 border-blue-500/20 text-blue-400' :
                status === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
                'bg-red-500/10 border-red-500/20 text-red-400'
              }`}>
                {status === 'loading' ? <Loader2 className="w-5 h-5 animate-spin" /> :
                 status === 'success' ? <CheckCircle2 className="w-5 h-5" /> :
                                       <XCircle className="w-5 h-5" />}
                <span className="text-sm font-medium">{message}</span>
              </div>
            )}

            {activeTab === 'oauth' ? (
              <div className="space-y-6">
                <div className="text-center py-6 bg-foreground/[0.02] border border-dashed border-glass-border rounded-2xl">
                  <div className="w-16 h-16 bg-blue-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Globe className="w-8 h-8 text-blue-500" />
                  </div>
                  <h4 className="text-foreground font-medium mb-1">{t('accounts.viaBrowser')}</h4>
                  <p className="text-foreground/65 text-xs px-10">{t('accounts.viaBrowserDesc')}</p>
                  <button 
                    onClick={handleOAuthStart}
                    disabled={status === 'loading'}
                    className="mt-6 px-10 py-3 btn-matrix-primary text-sm font-semibold rounded-xl disabled:opacity-50"
                  >
                    {t('accounts.startOauth')}
                  </button>
                </div>
                
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs text-foreground/55 font-medium px-1 uppercase tracking-wider">
                    <div className="h-px flex-1 bg-glass-border"></div>
                    {t('accounts.orCallbackUrl')}
                    <div className="h-px flex-1 bg-glass-border"></div>
                  </div>
                  <div className="flex gap-2">
                    <div className="relative flex-1 group">
                      <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/45 group-focus-within:text-blue-500 transition-colors" />
                      <input 
                        className="w-full bg-foreground/[0.03] border border-glass-border rounded-xl py-2.5 pl-10 pr-4 text-xs text-foreground outline-none focus:border-blue-500/50 transition-all"
                        placeholder={t('accounts.callbackUrlPlaceholder')}
                        value={callbackUrl}
                        onChange={(e) => setCallbackUrl(e.target.value)}
                      />
                    </div>
                    <button 
                      onClick={handleUrlSubmit}
                      disabled={!callbackUrl.trim() || status === 'loading'}
                      className="px-4 py-2 btn-matrix-primary text-xs font-black rounded-xl disabled:opacity-50"
                    >
                      {t('common.submit')}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                   <span className="text-xs text-foreground/65 font-medium">{t('accounts.batchPasteTokens')}</span>
                   <div className="flex items-center gap-1 text-[10px] text-blue-400 bg-blue-400/10 px-2 py-0.5 rounded-full border border-blue-400/20">
                     <Info className="w-3 h-3" />
                     {t('accounts.autoExtractTokens')}
                   </div>
                </div>
                <textarea 
                  className="w-full h-48 bg-foreground/[0.03] border border-glass-border rounded-2xl p-4 text-xs text-foreground/80 font-mono outline-none focus:border-blue-500/30 transition-all resize-none placeholder:text-foreground/10"
                  placeholder={t('accounts.tokensPlaceholder')}
                  value={tokensText}
                  onChange={(e) => setTokensText(e.target.value)}
                />
                <button 
                  onClick={handleTokenSubmit}
                  disabled={!tokensText.trim() || status === 'loading'}
                  className="w-full py-4 btn-matrix-primary text-sm font-black rounded-xl disabled:opacity-50"
                >
                  {t('accounts.parseAndImport')}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Footer info */}
        <div className="px-6 py-4 bg-foreground/[0.01] border-t border-glass-border flex items-center gap-2">
          <Info className="w-3.5 h-3.5 text-foreground/45" />
          <p className="text-[10px] text-foreground/45 italic">
            {t('accounts.storageInfo')}
          </p>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default AddAccountModal;
