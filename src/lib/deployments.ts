import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './api';
import type {
  BranchCommit,
  DeploymentBatchSummary,
  DeploymentPreview,
  DeploymentReport,
  SquashSession,
} from '../types';

const DEMO_ERROR = {
  code: 'DEMO_MODE',
  message: 'El despliegue requiere la app de escritorio de FlowManager.',
  retryable: false,
};

function requireDesktop(): void {
  if (!isTauri()) throw DEMO_ERROR;
}

export async function previewDeployment(
  requirementIds: string[],
  environment: string,
): Promise<DeploymentPreview> {
  requireDesktop();
  return invoke<DeploymentPreview>('deployment_preview', {
    input: { requirementIds, environment },
  });
}

export async function prepareDeployment(
  requirementIds: string[],
  environment: string,
  repoConfigs?: Array<{ repositoryId: string; strategy: string; selectedCommits: string[] }>,
): Promise<SquashSession[]> {
  requireDesktop();
  return invoke<SquashSession[]>('deployment_prepare', {
    input: {
      requirementIds,
      environment,
      repoConfigs: repoConfigs || [],
    },
  });
}

export async function loadDeploymentCommits(
  repositoryId: string,
  requirementIds: string[],
  targetBranch: string,
  targetSha: string | null,
): Promise<BranchCommit[]> {
  requireDesktop();
  return invoke<BranchCommit[]>('deployment_load_commits', {
    input: {
      repositoryId,
      requirementIds,
      targetBranch,
      targetSha,
    },
  });
}

export async function applyDeployment(
  sessionId: string,
  replaceExisting = false,
): Promise<SquashSession> {
  requireDesktop();
  return invoke<SquashSession>('deployment_apply', { sessionId, replaceExisting });
}

export async function getDeploymentReport(
  sessionId: string,
): Promise<DeploymentReport> {
  requireDesktop();
  return invoke<DeploymentReport>('deployment_report', { sessionId });
}

export async function pushDeployment(sessionId: string): Promise<SquashSession> {
  requireDesktop();
  return invoke<SquashSession>('deployment_push', { sessionId });
}

export async function listDeploymentBatches(): Promise<DeploymentBatchSummary[]> {
  requireDesktop();
  return invoke<DeploymentBatchSummary[]>('deployment_batches_list');
}

export async function getDeploymentBatchSessions(
  batchId: string,
): Promise<SquashSession[]> {
  requireDesktop();
  return invoke<SquashSession[]>('deployment_batch_sessions', { batchId });
}

export async function retryDeploymentBatch(
  batchId: string,
): Promise<SquashSession[]> {
  requireDesktop();
  return invoke<SquashSession[]>('deployment_batch_retry', { batchId });
}
