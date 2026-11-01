import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './api';
import type { AppSettings } from '../types';

const DEMO_SETTINGS: AppSettings = {
  baseBranch: 'master',
  manualKeyPrefix: 'MAN',
};

export async function getSettings(): Promise<AppSettings> {
  if (!isTauri()) return DEMO_SETTINGS;
  return invoke<AppSettings>('settings_get');
}

export async function updateSettings(input: {
  baseBranch?: string;
  manualKeyPrefix?: string;
}): Promise<AppSettings> {
  if (!isTauri()) {
    return {
      baseBranch: input.baseBranch ?? DEMO_SETTINGS.baseBranch,
      manualKeyPrefix: input.manualKeyPrefix ?? DEMO_SETTINGS.manualKeyPrefix,
    };
  }
  return invoke<AppSettings>('settings_update', { input });
}
