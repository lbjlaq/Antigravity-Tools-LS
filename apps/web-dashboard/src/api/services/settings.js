import apiClient from '../client';

export const settingsService = {
  // 获取全局配置
  get: () => apiClient.get('/settings'),

  // 更新全局配置
  update: (data) => apiClient.put('/settings', data),

  // 获取系统资产状态
  getProvisionStatus: () => apiClient.get('/provision/status'),

  // 触发资产同步
  syncAssets: (source = 'auto') => apiClient.post('/provision/sync', { source }),

  // 获取版本信息
  getVersion: () => apiClient.get('/version'),

  // 检查系统更新
  checkVersion: () => apiClient.get('/version/check'),

  // 选择安装路径 [NEW]
  selectPath: () => apiClient.get('/provision/select_path'),

  // 探测 IDE [NEW]
  detectIde: () => apiClient.get('/provision/detect_ide'),

  // 重启桌面应用以应用新的本地配置
  restartApp: async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('restart_app');
  },
};
