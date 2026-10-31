import { describe, expect, it } from 'vitest';
import { buildChecklist, setupProgress } from './setup';
import type { SystemInfo } from '../types';

function makeInfo(overrides: Partial<SystemInfo['setup']> = {}): SystemInfo {
  return {
    appVersion: '0.1.0',
    os: 'windows',
    arch: 'x86_64',
    dataDir: 'C:\\data',
    dbPath: 'C:\\data\\flowmanager.db',
    dbReady: true,
    dbError: null,
    dbSizeBytes: 2048,
    schemaVersion: 1,
    logsDir: 'C:\\data\\logs',
    backupsDir: 'C:\\data\\backups',
    worktreesDir: 'C:\\worktrees',
    git: { available: true, version: 'git version 2.45.1', message: null },
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
      ...overrides,
    },
    startedAt: '2026-10-31T12:00:00Z',
  };
}

describe('buildChecklist', () => {
  it('marca el entorno como completado cuando Git y la base están bien', () => {
    const items = buildChecklist(makeInfo());
    expect(items).toHaveLength(4);
    expect(items[0].done).toBe(true);
    expect(items[0].detail).toContain('Todo en orden');
    expect(items[1].available).toBe(true);
    expect(items[1].phase).toBe('Fase 1');
    expect(items[2].available).toBe(false);
  });

  it('marca pendiente si falta Git', () => {
    const info = makeInfo({ gitOk: false });
    info.git = { available: false, version: null, message: 'No está' };
    const items = buildChecklist(info);
    expect(items[0].done).toBe(false);
    expect(items[0].detail).toContain('Git no está disponible');
  });

  it('explica cuando la base local falla', () => {
    const info = makeInfo({ databaseOk: false });
    info.dbReady = false;
    const items = buildChecklist(info);
    expect(items[0].done).toBe(false);
    expect(items[0].detail).toContain('base local');
  });

  it('refleja repositorios y requerimientos configurados', () => {
    const info = makeInfo({ repositoriesOk: true, requirementsOk: true });
    info.counts = { ...info.counts, repositories: 2, requirements: 10 };
    const items = buildChecklist(info);
    expect(items[1].done).toBe(true);
    expect(items[1].detail).toContain('2 repositorio');
    expect(items[2].done).toBe(true);
    expect(items[2].detail).toContain('10 requerimiento');
  });
});

describe('setupProgress', () => {
  it('calcula el porcentaje y evita dividir por cero', () => {
    const info = makeInfo();
    expect(setupProgress(info.setup)).toBe(50);
    expect(
      setupProgress({ ...info.setup, completedSteps: 0, totalSteps: 0 }),
    ).toBe(0);
    expect(
      setupProgress({ ...info.setup, completedSteps: 4, totalSteps: 4 }),
    ).toBe(100);
  });
});
