import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './api';
import type { AppSettings } from '../types';

const DEMO_SETTINGS: AppSettings = {
  baseBranch: 'master',
  manualKeyPrefix: 'MAN',
  gitUserName: '',
  gitUserEmail: '',
  gitConfigUserName: null,
  gitConfigUserEmail: null,
};

export async function getSettings(): Promise<AppSettings> {
  if (!isTauri()) return DEMO_SETTINGS;
  return invoke<AppSettings>('settings_get');
}

export async function updateSettings(input: {
  baseBranch?: string;
  manualKeyPrefix?: string;
  gitUserName?: string;
  gitUserEmail?: string;
}): Promise<AppSettings> {
  if (!isTauri()) {
    return {
      ...DEMO_SETTINGS,
      baseBranch: input.baseBranch ?? DEMO_SETTINGS.baseBranch,
      manualKeyPrefix: input.manualKeyPrefix ?? DEMO_SETTINGS.manualKeyPrefix,
      gitUserName: input.gitUserName ?? DEMO_SETTINGS.gitUserName,
      gitUserEmail: input.gitUserEmail ?? DEMO_SETTINGS.gitUserEmail,
    };
  }
  return invoke<AppSettings>('settings_update', { input });
}
