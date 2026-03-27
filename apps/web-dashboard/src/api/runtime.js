export const DEFAULT_BACKEND_PORT = '5173';
const DASHBOARD_DEV_PORTS = new Set(['1420', '3000']);

export const isTauri = typeof window !== 'undefined' && (
  !!window.__TAURI__ ||
  window.location.protocol === 'tauri:' ||
  window.location.hostname === 'tauri.localhost' ||
  window.location.host === 'tauri.localhost'
);

const getRuntimeEnv = (env) => env ?? import.meta.env ?? {};
const getRuntimeLocation = (location) => location ?? (typeof window !== 'undefined' ? window.location : undefined);

export function normalizeBackendPort(port) {
  const value = `${port ?? ''}`.trim();
  return /^\d+$/.test(value) ? value : DEFAULT_BACKEND_PORT;
}

export function normalizeBackendOrigin(apiUrl) {
  if (!apiUrl) {
    return '';
  }

  return apiUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '');
}

export function getConfiguredBackendOrigin({
  apiUrl,
  backendOrigin,
  backendPort,
  env,
  location,
  isTauri: tauri = isTauri,
} = {}) {
  const runtimeEnv = getRuntimeEnv(env);
  const explicitOrigin = normalizeBackendOrigin(backendOrigin || apiUrl || runtimeEnv.VITE_API_URL);
  if (explicitOrigin) {
    return explicitOrigin;
  }

  const port = normalizeBackendPort(backendPort || runtimeEnv.VITE_BACKEND_PORT);
  if (tauri) {
    return `http://127.0.0.1:${port}`;
  }

  const runtimeLocation = getRuntimeLocation(location);
  if (!runtimeLocation) {
    return `http://127.0.0.1:${port}`;
  }

  if (runtimeLocation.port && DASHBOARD_DEV_PORTS.has(runtimeLocation.port) && runtimeLocation.hostname) {
    return `${runtimeLocation.protocol}//${runtimeLocation.hostname}:${port}`;
  }

  return runtimeLocation.origin;
}

export function getPublicApiOrigin({
  apiUrl,
  backendOrigin,
  backendPort,
  env,
  location,
  isTauri: tauri = isTauri,
} = {}) {
  const runtimeEnv = getRuntimeEnv(env);
  const explicitOrigin = normalizeBackendOrigin(backendOrigin || apiUrl || runtimeEnv.VITE_API_URL);
  if (explicitOrigin) {
    return explicitOrigin;
  }

  if (tauri) {
    return getConfiguredBackendOrigin({ backendPort, env: runtimeEnv, isTauri: tauri });
  }

  const runtimeLocation = getRuntimeLocation(location);
  return runtimeLocation?.origin ?? getConfiguredBackendOrigin({ backendPort, env: runtimeEnv, location, isTauri: tauri });
}

export function getClientApiBaseUrl(options = {}) {
  const runtimeEnv = getRuntimeEnv(options.env);
  const explicitOrigin = normalizeBackendOrigin(options.apiUrl || runtimeEnv.VITE_API_URL);
  if (explicitOrigin) {
    return `${explicitOrigin}/v1`;
  }

  if (options.isTauri ?? isTauri) {
    return `${getConfiguredBackendOrigin({ ...options, env: runtimeEnv })}/v1`;
  }

  return '/v1';
}

export function getPublicApiBaseUrl(options = {}) {
  return `${getPublicApiOrigin(options)}/v1`;
}

let tauriBackendOriginPromise;

export function resetResolvedBackendOriginCache() {
  tauriBackendOriginPromise = undefined;
}

export async function resolveBackendOrigin(options = {}) {
  const runtimeEnv = getRuntimeEnv(options.env);
  const explicitOrigin = normalizeBackendOrigin(options.backendOrigin || options.apiUrl || runtimeEnv.VITE_API_URL);
  if (explicitOrigin) {
    return explicitOrigin;
  }

  if (!(options.isTauri ?? isTauri)) {
    return getConfiguredBackendOrigin({ ...options, env: runtimeEnv });
  }

  if (!tauriBackendOriginPromise) {
    tauriBackendOriginPromise = (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const origin = await invoke('get_backend_origin');
        return normalizeBackendOrigin(origin) || getConfiguredBackendOrigin({ ...options, env: runtimeEnv, isTauri: true });
      } catch (error) {
        console.warn('Falling back to default backend origin:', error);
        return getConfiguredBackendOrigin({ ...options, env: runtimeEnv, isTauri: true });
      }
    })();
  }

  return tauriBackendOriginPromise;
}

export async function resolveApiBaseUrl(options = {}) {
  const runtimeEnv = getRuntimeEnv(options.env);
  const explicitOrigin = normalizeBackendOrigin(options.apiUrl || runtimeEnv.VITE_API_URL);
  if (explicitOrigin) {
    return `${explicitOrigin}/v1`;
  }

  if (!(options.isTauri ?? isTauri)) {
    return '/v1';
  }

  return `${await resolveBackendOrigin({ ...options, env: runtimeEnv })}/v1`;
}

export async function resolvePublicApiOrigin(options = {}) {
  const runtimeEnv = getRuntimeEnv(options.env);
  const explicitOrigin = normalizeBackendOrigin(options.backendOrigin || options.apiUrl || runtimeEnv.VITE_API_URL);
  if (explicitOrigin) {
    return explicitOrigin;
  }

  if (!(options.isTauri ?? isTauri)) {
    return getPublicApiOrigin({ ...options, env: runtimeEnv });
  }

  return resolveBackendOrigin({ ...options, env: runtimeEnv });
}

export async function resolvePublicApiBaseUrl(options = {}) {
  return `${await resolvePublicApiOrigin(options)}/v1`;
}
