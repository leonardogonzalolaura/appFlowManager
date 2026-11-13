import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './api';
import type { AppSettings } from '../types';

const DEMO_SETTINGS: AppSettings = {
  baseBranch: 'master',
  manualKeyPrefix: 'MAN',
  mondaySubdomain: 'belcorp',
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
  mondaySubdomain?: string;
  gitUserName?: string;
  gitUserEmail?: string;
}): Promise<AppSettings> {
  if (!isTauri()) {
    return {
      ...DEMO_SETTINGS,
      baseBranch: input.baseBranch ?? DEMO_SETTINGS.baseBranch,
      manualKeyPrefix: input.manualKeyPrefix ?? DEMO_SETTINGS.manualKeyPrefix,
      mondaySubdomain: input.mondaySubdomain ?? DEMO_SETTINGS.mondaySubdomain,
      gitUserName: input.gitUserName ?? DEMO_SETTINGS.gitUserName,
      gitUserEmail: input.gitUserEmail ?? DEMO_SETTINGS.gitUserEmail,
    };
  }
  return invoke<AppSettings>('settings_update', { input });
}
