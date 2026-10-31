import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './api';
import type {
  BranchCheck,
  BranchOperationResult,
  RepositoryBranchAnalysis,
} from '../types';

const DEMO_ERROR = {
  code: 'DEMO_MODE',
  message: 'Las ramas requieren la app de escritorio de FlowManager.',
  retryable: false,
};

function requireDesktop(): void {
  if (!isTauri()) throw DEMO_ERROR;
}

export async function checkRequirementBranch(input: {
  requirementId: string;
  repositoryId: string;
}): Promise<BranchCheck> {
  requireDesktop();
  return invoke<BranchCheck>('branches_check', { input });
}

export async function createRequirementBranch(input: {
  requirementId: string;
  repositoryId: string;
  strategy: 'preserve' | 'recreate';
  push?: boolean;
}): Promise<BranchOperationResult> {
  requireDesktop();
  return invoke<BranchOperationResult>('branches_create', { input });
}

export async function analyzeRequirementBranches(input: {
  requirementId: string;
  repositoryId?: string;
}): Promise<RepositoryBranchAnalysis[]> {
  requireDesktop();
  return invoke<RepositoryBranchAnalysis[]>('branches_analyze', { input });
}

/** Misma convención que usa el backend: feature/<key> o fix/<key>. */
export function defaultBranchName(
  type: string | null | undefined,
  externalKey: string,
): string {
  const normalized = (type ?? '').trim().toLowerCase();
  const prefix =
    normalized.includes('bug') || normalized.includes('hotfix')
      ? 'fix'
      : 'feature';
  return `${prefix}/${externalKey}`;
}

