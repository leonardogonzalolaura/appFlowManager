import { invoke } from '@tauri-apps/api/core';
import type { ApiError, SystemInfo } from '../types';

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function normalizeError(error: unknown): ApiError {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error
  ) {
    const candidate = error as Partial<ApiError>;
    return {
      code: String(candidate.code ?? 'UNEXPECTED'),
      message: String(candidate.message ?? 'Ocurrió un error inesperado.'),
      details: candidate.details ?? null,
      retryable: Boolean(candidate.retryable),
      context: candidate.context,
    };
  }

  if (error instanceof Error) {
    return {
      code: 'UNEXPECTED',
      message: error.message,
      details: null,
      retryable: true,
    };
  }

  return {
    code: 'UNEXPECTED',
    message: typeof error === 'string' ? error : 'Ocurrió un error inesperado.',
    details: null,
    retryable: true,
  };
}

export async function getSystemInfo(): Promise<SystemInfo> {
  if (!isTauri()) {
    return demoSystemInfo();
  }
  return invoke<SystemInfo>('system_get_info');
}

export async function openAppDir(
  kind: 'data' | 'logs' | 'backups' | 'worktrees',
): Promise<string> {
  if (!isTauri()) {
    throw {
      code: 'DEMO_MODE',
      message: 'Abrir carpetas solo está disponible en la app de escritorio.',
      retryable: false,
    } satisfies ApiError;
  }
  return invoke<string>('system_open_dir', { kind });
}

function demoSystemInfo(): SystemInfo {
  return {
    appVersion: '0.1.0',
    os: 'windows',
    arch: 'x86_64',
    dataDir: 'C:\\Users\\tu-usuario\\AppData\\Roaming\\com.leona.flowmanager',
    dbPath: 'C:\\Users\\tu-usuario\\AppData\\Roaming\\com.leona.flowmanager\\flowmanager.db',
    dbReady: true,
    dbError: null,
    dbSizeBytes: 81920,
    schemaVersion: 1,
    logsDir: 'C:\\Users\\tu-usuario\\AppData\\Roaming\\com.leona.flowmanager\\logs',
    backupsDir: 'C:\\Users\\tu-usuario\\AppData\\Roaming\\com.leona.flowmanager\\backups',
    worktreesDir: 'C:\\Users\\tu-usuario\\AppData\\Local\\com.leona.flowmanager\\worktrees',
    git: {
      available: true,
      version: 'git version 2.45.1.windows.1',
      message: null,
    },
    counts: {
      repositories: 0,
      requirements: 0,
      databaseConnections: 0,
      activeRuns: 0,
    },
    setup: {
      gitOk: true,
      databaseOk: true,
      repositoriesOk: false,
      requirementsOk: false,
      databaseConfigured: false,
      completedSteps: 2,
      totalSteps: 4,
    },
    startedAt: new Date().toISOString(),
    demo: true,
  };
}
