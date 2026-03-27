import axios from 'axios';
import {
  getClientApiBaseUrl,
  getPublicApiBaseUrl,
  getPublicApiOrigin,
  isTauri,
  resolveApiBaseUrl,
  resolveBackendOrigin,
  resolvePublicApiBaseUrl,
  resolvePublicApiOrigin,
} from './runtime';

export const baseURL = getClientApiBaseUrl();
export const publicApiBaseUrl = getPublicApiBaseUrl();
export const publicApiOrigin = getPublicApiOrigin();
export {
  isTauri,
  resolveApiBaseUrl,
  resolveBackendOrigin,
  resolvePublicApiBaseUrl,
  resolvePublicApiOrigin,
};

const apiClient = axios.create({
  timeout: 300000, // 延长至 5 分钟，适配核心资产下载
  headers: {
    'Content-Type': 'application/json',
  },
});

apiClient.interceptors.request.use(async (config) => {
  if (!config.baseURL) {
    config.baseURL = await resolveApiBaseUrl();
  }
  return config;
});

// 响应拦截器：统一处理数据解包与错误日志
apiClient.interceptors.response.use(
  (response) => {
    // 如果后端返回结构是 { success: true, data: ... }
    if (response.data && typeof response.data === 'object' && 'success' in response.data) {
      if (response.data.success) {
        // 只有当存在 data 字段时才解包，否则返回整个 response.data
        return 'data' in response.data ? response.data.data : response.data;
      } else {
        return Promise.reject(new Error(response.data.message || '业务逻辑错误'));
      }
    }
    // 否则直接返回 data (适配部分原始 OpenAI 兼容接口)
    return response.data;
  },
  (error) => {
    const message = error.response?.data?.message || error.message || '网络请求失败';
    console.error('🌐 [API Client Error]:', message);
    return Promise.reject(error);
  }
);

export default apiClient;
