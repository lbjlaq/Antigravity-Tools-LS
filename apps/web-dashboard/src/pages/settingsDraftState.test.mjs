import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_LOCAL_SETTINGS,
  createSettingsBaseline,
  getVisibleSettings,
  updateSettingsDraft,
} from './settingsDraftState.js';

test('createSettingsBaseline merges backend settings onto defaults', () => {
  assert.deepEqual(
    createSettingsBaseline({
      backend_port: 5188,
      auto_refresh_quota: true,
    }),
    {
      ...DEFAULT_LOCAL_SETTINGS,
      backend_port: 5188,
      auto_refresh_quota: true,
    }
  );
});

test('getVisibleSettings prefers the in-progress draft over persisted settings', () => {
  const baseline = createSettingsBaseline({ backend_port: 5173 });
  const draft = { ...baseline, backend_port: 5188 };

  assert.deepEqual(getVisibleSettings({ baseline, draft }), draft);
});

test('updateSettingsDraft derives the next draft from the current visible settings', () => {
  const baseline = createSettingsBaseline({ auto_sync_assets: false });
  const nextDraft = updateSettingsDraft({
    baseline,
    draft: null,
    updater: (current) => ({
      ...current,
      auto_sync_assets: true,
    }),
  });

  assert.equal(nextDraft.auto_sync_assets, true);
  assert.equal(nextDraft.backend_port, 5173);
});
