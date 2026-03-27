import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_BACKEND_PORT,
  getClientApiBaseUrl,
  getPublicApiBaseUrl,
  normalizeBackendOrigin,
} from './runtime.js';

test('normalizeBackendOrigin trims trailing /v1 from explicit API urls', () => {
  assert.equal(
    normalizeBackendOrigin('http://127.0.0.1:5188/v1/'),
    'http://127.0.0.1:5188'
  );
});

test('getClientApiBaseUrl keeps web requests on relative /v1 when no override exists', () => {
  assert.equal(getClientApiBaseUrl(), '/v1');
});

test('getClientApiBaseUrl should respect a custom backend port in tauri fallback mode', () => {
  assert.equal(
    getClientApiBaseUrl({
      isTauri: true,
      backendPort: '5188',
    }),
    'http://127.0.0.1:5188/v1'
  );
});

test('getPublicApiBaseUrl should expose the current web origin for copyable docs urls', () => {
  assert.equal(
    getPublicApiBaseUrl({
      location: {
        origin: 'http://localhost:1420',
      },
    }),
    'http://localhost:1420/v1'
  );
});

test('default backend port remains 5173 when nothing overrides it', () => {
  assert.equal(DEFAULT_BACKEND_PORT, '5173');
});
