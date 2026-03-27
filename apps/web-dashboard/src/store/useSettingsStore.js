import { create } from 'zustand';
import { settingsService } from '../api/services/settings';

const useSettingsStore = create((set, get) => ({
  // 全局配置（与后端 AppSettings 对应）
  settings: {
    backend_port: 5173,
    auto_refresh_quota: false,
    auto_refresh_interval_hours: 6,
    traffic_log_retention_days: 30,
  },

  // 系统资产状态
  provisionStatus: null,

  // 版本信息
  versionInfo: null,

  // UI 状态
  isLoading: false,
  isSaving: false,
  isSyncing: false,
  lastSaved: null,
  error: null,

  // 加载全局配置
  fetchSettings: async () => {
    set({ isLoading: true, error: null });
    try {
      const data = await settingsService.get();
      set({ settings: data, isLoading: false });
    } catch (err) {
      set({ error: err.message, isLoading: false });
    }
  },

  // 保存全局配置
  saveSettings: async (newSettings) => {
    set({ isSaving: true, error: null });
    try {
      await settingsService.update(newSettings);
      set({ settings: newSettings, isSaving: false, lastSaved: Date.now() });
    } catch (err) {
      set({ error: err.message, isSaving: false });
      throw err;
    }
  },

  // 加载系统资产状态
  fetchProvisionStatus: async () => {
    try {
      const data = await settingsService.getProvisionStatus();
      set({ provisionStatus: data });
    } catch (err) {
      console.error('Failed to fetch provision status:', err);
    }
  },

  // 触发资产同步
  syncAssets: async (source = 'auto') => {
    set({ isSyncing: true, error: null });
    try {
      const result = await settingsService.syncAssets(source);
      await Promise.all([
        get().fetchProvisionStatus(),
        get().fetchVersionInfo()
      ]);
      set({ isSyncing: false });
      return result;
    } catch (err) {
      set({ error: err.message, isSyncing: false });
      throw err;
    }
  },

  // 加载版本信息
  fetchVersionInfo: async () => {
    try {
      const data = await settingsService.getVersion();
      set({ versionInfo: data });
    } catch (err) {
      console.error('Failed to fetch version info:', err);
    }
  },

  // 检查系统更新
  checkDashboardUpdate: async () => {
    set({ isCheckingUpdate: true, error: null });
    try {
      const data = await settingsService.checkVersion();
      set({ updateInfo: data, isCheckingUpdate: false });
      return data;
    } catch (err) {
      set({ error: err.message, isCheckingUpdate: false });
      throw err;
    }
  },

  // 局部更新配置字段（不立即保存）
  updateField: (field, value) => {
    set((state) => ({
      settings: { ...state.settings, [field]: value },
    }));
  },
}));

export default useSettingsStore;
