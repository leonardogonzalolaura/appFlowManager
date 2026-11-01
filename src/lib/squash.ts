import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './api';
import type {
  SquashCandidate,
  SquashPrepareInput,
  SquashSession,
} from '../types';

const DEMO_ERROR = {
  code: 'DEMO_MODE',
  message: 'El squash requiere la app de escritorio de FlowManager.',
  retryable: false,
};

function requireDesktop(): void {
  if (!isTauri()) throw DEMO_ERROR;
}

export async function listSquashCandidates(
  repositoryId: string,
): Promise<SquashCandidate[]> {
  requireDesktop();
  return invoke<SquashCandidate[]>('squash_candidates', { repositoryId });
}

export async function prepareSquash(
  input: SquashPrepareInput,
): Promise<SquashSession> {
  requireDesktop();
  return invoke<SquashSession>('squash_prepare', { input });
}

export async function listSquashSessions(): Promise<SquashSession[]> {
  if (!isTauri()) return [];
  return invoke<SquashSession[]>('squash_list');
}

export async function getSquashSession(sessionId: string): Promise<SquashSession> {
  requireDesktop();
  return invoke<SquashSession>('squash_get', { sessionId });
}

export async function refreshSquashConflicts(
  sessionId: string,
): Promise<SquashSession> {
  requireDesktop();
  return invoke<SquashSession>('squash_refresh_conflicts', { sessionId });
}

export async function stageSquashFile(
  sessionId: string,
  filePath: string,
): Promise<SquashSession> {
  requireDesktop();
  return invoke<SquashSession>('squash_stage_file', {
    input: { sessionId, filePath },
  });
}

export async function stageAllSquash(
  sessionId: string,
): Promise<SquashSession> {
  requireDesktop();
  return invoke<SquashSession>('squash_stage_all', { sessionId });
}

export async function resolveSquashConflict(
  sessionId: string,
  filePath: string,
  side: 'ours' | 'theirs',
): Promise<SquashSession> {
  requireDesktop();
  return invoke<SquashSession>('squash_resolve_conflict', {
    input: { sessionId, filePath, side },
  });
}

export async function continueSquash(sessionId: string): Promise<SquashSession> {
  requireDesktop();
  return invoke<SquashSession>('squash_continue', { sessionId });
}

export async function abortSquash(sessionId: string): Promise<SquashSession> {
  requireDesktop();
  return invoke<SquashSession>('squash_abort', { sessionId });
}

export async function openSquashEditor(
  sessionId: string,
  filePath?: string,
): Promise<void> {
  requireDesktop();
  return invoke<void>('squash_open_editor', {
    input: { sessionId, filePath },
  });
}

export async function openSquashInTaruGit(sessionId: string): Promise<void> {
  requireDesktop();
  return invoke<void>('squash_open_tarugit', { sessionId });
}

export async function openSquashFolder(sessionId: string): Promise<void> {
  requireDesktop();
  return invoke<void>('squash_open_folder', { sessionId });
}
