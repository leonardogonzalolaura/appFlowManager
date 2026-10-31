import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './api';
import type {
  AddRepositoryInput,
  BranchInfo,
  CloneRepositoryInput,
  CreateEnvironmentInput,
  EnvironmentDefinition,
  EnvironmentState,
  FetchResult,
  RepositoryDetail,
  RepositorySummary,
  SetEnvironmentInput,
  UpdateEnvironmentInput,
  UpdateRepositoryInput,
} from '../types';

const DEMO_ERROR = {
  code: 'DEMO_MODE',
  message: 'Esta acción requiere la app de escritorio de FlowManager.',
  retryable: false,
};

function requireDesktop(): void {
  if (!isTauri()) {
    throw DEMO_ERROR;
  }
}

export async function listRepositories(): Promise<RepositorySummary[]> {
  if (!isTauri()) {
    return [demoDetail()];
  }
  return invoke<RepositorySummary[]>('repositories_list');
}

export async function getRepository(
  repositoryId: string,
): Promise<RepositoryDetail> {
  if (!isTauri()) {
    return { ...demoDetail(), id: repositoryId };
  }
  return invoke<RepositoryDetail>('repositories_get', { repositoryId });
}

export async function addRepository(
  input: AddRepositoryInput,
): Promise<RepositoryDetail> {
  requireDesktop();
  return invoke<RepositoryDetail>('repositories_add', { input });
}

export async function cloneRepository(
  input: CloneRepositoryInput,
): Promise<RepositoryDetail> {
  requireDesktop();
  return invoke<RepositoryDetail>('repositories_clone', { input });
}

export async function updateRepository(
  input: UpdateRepositoryInput,
): Promise<RepositoryDetail> {
  requireDesktop();
  return invoke<RepositoryDetail>('repositories_update', { input });
}

export async function removeRepository(repositoryId: string): Promise<void> {
  requireDesktop();
  return invoke<void>('repositories_remove', { repositoryId });
}

export async function fetchRepository(
  repositoryId: string,
): Promise<FetchResult> {
  requireDesktop();
  return invoke<FetchResult>('repositories_fetch', { repositoryId });
}

export async function detectEnvironments(
  repositoryId: string,
): Promise<RepositoryDetail> {
  requireDesktop();
  return invoke<RepositoryDetail>('repositories_detect_environments', {
    repositoryId,
  });
}

export async function setEnvironment(
  input: SetEnvironmentInput,
): Promise<RepositoryDetail> {
  requireDesktop();
  return invoke<RepositoryDetail>('repositories_set_environment', { input });
}

export async function listBranches(
  repositoryId: string,
): Promise<BranchInfo[]> {
  if (!isTauri()) {
    return demoDetail().branches;
  }
  return invoke<BranchInfo[]>('repositories_list_branches', { repositoryId });
}

export async function openRepositoryFolder(
  repositoryId: string,
): Promise<string> {
  requireDesktop();
  return invoke<string>('repositories_open_folder', { repositoryId });
}

export async function listEnvironments(): Promise<EnvironmentDefinition[]> {
  if (!isTauri()) {
    return demoEnvironments();
  }
  return invoke<EnvironmentDefinition[]>('environments_list');
}

export async function createEnvironment(
  input: CreateEnvironmentInput,
): Promise<EnvironmentDefinition[]> {
  requireDesktop();
  return invoke<EnvironmentDefinition[]>('environments_create', { input });
}

export async function updateEnvironment(
  input: UpdateEnvironmentInput,
): Promise<EnvironmentDefinition[]> {
  requireDesktop();
  return invoke<EnvironmentDefinition[]>('environments_update', { input });
}

export async function archiveEnvironment(
  key: string,
): Promise<EnvironmentDefinition[]> {
  requireDesktop();
  return invoke<EnvironmentDefinition[]>('environments_archive', { key });
}

export async function reorderEnvironments(
  keys: string[],
): Promise<EnvironmentDefinition[]> {
  requireDesktop();
  return invoke<EnvironmentDefinition[]>('environments_reorder', { keys });
}

function demoEnvironments(): EnvironmentDefinition[] {
  return [
    {
      key: 'dev',
      label: 'DEV',
      color: '#6aa8ff',
      position: 0,
      aliases: ['dev', 'develop', 'development'],
      pattern: null,
      isSystem: true,
      resolvedCount: 1,
      repositoryCount: 1,
    },
    {
      key: 'qas',
      label: 'QAS',
      color: '#f5b84b',
      position: 1,
      aliases: ['qas', 'qa', 'quality'],
      pattern: 'release/*',
      isSystem: true,
      resolvedCount: 1,
      repositoryCount: 1,
    },
    {
      key: 'stage',
      label: 'STAGE',
      color: '#4dd0e1',
      position: 2,
      aliases: ['stage', 'staging'],
      pattern: null,
      isSystem: false,
      resolvedCount: 1,
      repositoryCount: 1,
    },
    {
      key: 'uat',
      label: 'UAT',
      color: '#b08cff',
      position: 3,
      aliases: ['uat', 'preuat', 'pre-uat'],
      pattern: null,
      isSystem: true,
      resolvedCount: 1,
      repositoryCount: 1,
    },
    {
      key: 'prd',
      label: 'PRD',
      color: '#3dd68c',
      position: 4,
      aliases: ['prd', 'prod', 'production', 'main', 'master'],
      pattern: null,
      isSystem: true,
      resolvedCount: 1,
      repositoryCount: 1,
    },
  ];
}

function demoBranch(
  name: string,
  daysAgo: number,
  message: string,
): BranchInfo {
  const date = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  return {
    name,
    sha: `${name.replace(/[^a-z0-9]/gi, '').slice(0, 6)}${daysAgo}0`.padEnd(40, '0'),
    committedAt: date,
    author: 'Leonardo Laura',
    message,
    isRemote: true,
  };
}

function demoEnv(
  environment: EnvironmentState['environment'],
  branchName: string,
  mode: EnvironmentState['mode'],
  note: string,
  daysAgo: number,
): EnvironmentState {
  const meta: Record<string, { label: string; color: string; position: number }> = {
    dev: { label: 'DEV', color: '#6aa8ff', position: 0 },
    qas: { label: 'QAS', color: '#f5b84b', position: 1 },
    stage: { label: 'STAGE', color: '#4dd0e1', position: 2 },
    uat: { label: 'UAT', color: '#b08cff', position: 3 },
    prd: { label: 'PRD', color: '#3dd68c', position: 4 },
  };
  const info = meta[environment] ?? {
    label: environment.toUpperCase(),
    color: '#7c8cff',
    position: 5,
  };
  return {
    environment,
    label: info.label,
    color: info.color,
    position: info.position,
    branchName,
    mode,
    sha: `${environment}${'0'.repeat(30)}`.slice(0, 40),
    resolvedAt: new Date().toISOString(),
    note,
    ambiguous: false,
    available: true,
    usesBaseBranch: false,
    warning: null,
    candidates: [
      {
        name: branchName,
        sha: `${environment}${'0'.repeat(30)}`.slice(0, 40),
        committedAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
        version: branchName.includes('release/')
          ? branchName.replace('release/', '')
          : null,
      },
    ],
  };
}

function demoDetail(): RepositoryDetail {
  const branches: BranchInfo[] = [
    demoBranch('master', 1, 'chore: release 1.0.10'),
    demoBranch('dev', 1, 'feat: checkout v2'),
    demoBranch('release/1.0.10', 2, 'release: 1.0.10'),
    demoBranch('release/1.0.9', 12, 'release: 1.0.9'),
    demoBranch('release/1.0.0', 40, 'release: 1.0.0'),
    demoBranch('main', 3, 'chore: sync main'),
    demoBranch('feature/BPIM-183', 4, 'feat(BPIM-183): payment retry'),
    demoBranch('feature/BPIM-190', 6, 'fix(BPIM-190): tax rounding'),
  ];

  const environments = [
    demoEnv('dev', 'dev', 'auto', "Coincidencia exacta con alias 'dev'", 1),
    demoEnv(
      'qas',
      'release/1.0.10',
      'auto',
      'Mayor versión release/*: 1.0.10 (fecha 29 oct 2026)',
      2,
    ),
    demoEnv('stage', 'stage', 'auto', "Coincidencia exacta con alias 'stage'", 5),
    demoEnv(
      'uat',
      'release/1.0.0',
      'manual',
      'Selección manual del usuario',
      40,
    ),
    demoEnv('prd', 'main', 'auto', "Coincidencia exacta con alias 'main'", 3),
  ];

  const updatedAt = new Date().toISOString();

  return {
    id: 'demo-repo',
    name: 'payments-api',
    localPath: 'C:\\Users\\tu-usuario\\source\\repos\\payments-api',
    remoteName: 'origin',
    remoteUrl: 'https://github.com/acme/payments-api.git',
    provider: 'github',
    githubOwner: 'acme',
    githubRepo: 'payments-api',
    baseBranch: 'master',
    lastFetchedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    environments,
    configuredCount: 5,
    pathWarning: null,
    warnings: [],
    branches,
    headBranch: 'feature/BPIM-183',
    defaultBranch: 'master',
    createdAt: updatedAt,
    updatedAt,
  };
}
