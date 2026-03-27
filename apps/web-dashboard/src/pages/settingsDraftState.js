export const DEFAULT_LOCAL_SETTINGS = {
  backend_port: 5173,
  auto_refresh_quota: false,
  auto_refresh_interval_minutes: 360,
  traffic_log_retention_days: 30,
  auto_sync_assets: true,
  auto_sync_interval_minutes: 1440,
  antigravity_executable: '',
  antigravity_args: [],
};

export function createSettingsBaseline(settings) {
  return {
    ...DEFAULT_LOCAL_SETTINGS,
    ...(settings ?? {}),
  };
}

export function getVisibleSettings({ baseline, draft }) {
  return draft ?? baseline;
}

export function updateSettingsDraft({ baseline, draft, updater }) {
  const current = getVisibleSettings({ baseline, draft });
  return typeof updater === 'function' ? updater(current) : updater;
}
