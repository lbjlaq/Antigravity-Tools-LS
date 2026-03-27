import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const DEFAULT_BACKEND_PORT = '5173';

const normalizeBackendOrigin = (value) => {
  if (!value) return '';
  return value.replace(/\/v1\/?$/, '').replace(/\/$/, '');
};

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const configuredPort = /^\d+$/.test(env.VITE_BACKEND_PORT || env.PORT || '')
    ? (env.VITE_BACKEND_PORT || env.PORT)
    : DEFAULT_BACKEND_PORT;
  const backendTarget = normalizeBackendOrigin(env.VITE_API_URL) || `http://localhost:${configuredPort}`;

  return {
    base: "./",
    plugins: [react()],
    server: {
      port: 1420,
      host: '0.0.0.0',
      proxy: {
        '/v1': {
          target: backendTarget,
          changeOrigin: true,
          ws: true,
        },
        '/oauth-callback': {
          target: backendTarget,
          changeOrigin: true,
        }
      }
    }
  };
})
