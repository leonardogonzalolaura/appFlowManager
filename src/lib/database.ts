import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './api';
import type {
  DbConnectionInput,
  DbConnectionSummary,
  DbConnectionTestResult,
  DbExecutionSummary,
  DbScriptExecutionResult,
  DbScriptInput,
  DbScriptSummary,
  DbScriptValidation,
} from '../types';

const DEMO_ERROR = {
  code: 'DEMO_MODE',
  message: 'Las conexiones y scripts requieren la app de escritorio de FlowManager.',
  retryable: false,
};

function requireDesktop(): void {
  if (!isTauri()) throw DEMO_ERROR;
}

export async function listDbConnections(): Promise<DbConnectionSummary[]> {
  requireDesktop();
  return invoke<DbConnectionSummary[]>('db_connections_list');
}

export async function upsertDbConnection(
  input: DbConnectionInput,
): Promise<DbConnectionSummary> {
  requireDesktop();
  return invoke<DbConnectionSummary>('db_connections_upsert', { input });
}

export async function deleteDbConnection(id: string): Promise<void> {
  requireDesktop();
  return invoke<void>('db_connections_delete', { id });
}

export async function testDbConnection(
  id: string,
): Promise<DbConnectionTestResult> {
  requireDesktop();
  return invoke<DbConnectionTestResult>('db_connections_test', { id });
}

export async function listDbScripts(input: {
  requirementId?: string;
  repositoryId?: string;
}): Promise<DbScriptSummary[]> {
  requireDesktop();
  return invoke<DbScriptSummary[]>('db_scripts_list', { input });
}

export async function upsertDbScript(
  input: DbScriptInput,
): Promise<DbScriptSummary> {
  requireDesktop();
  return invoke<DbScriptSummary>('db_scripts_upsert', { input });
}

export async function deleteDbScript(id: string): Promise<void> {
  requireDesktop();
  return invoke<void>('db_scripts_delete', { id });
}

export async function reorderDbScripts(
  requirementId: string,
  repositoryId: string,
  orderedIds: string[],
): Promise<void> {
  requireDesktop();
  return invoke<void>('db_scripts_reorder', {
    input: { requirementId, repositoryId, orderedIds },
  });
}

export async function validateDbScript(
  content: string,
  engine: string,
): Promise<DbScriptValidation> {
  requireDesktop();
  return invoke<DbScriptValidation>('db_scripts_validate', { content, engine });
}

export async function executeDbScripts(input: {
  scriptIds: string[];
  environment: string;
  connectionId?: string;
  stopOnError?: boolean;
}): Promise<DbScriptExecutionResult[]> {
  requireDesktop();
  return invoke<DbScriptExecutionResult[]>('db_scripts_execute', { input });
}

export async function listDbExecutions(filters?: {
  requirementId?: string;
  scriptId?: string;
}): Promise<DbExecutionSummary[]> {
  requireDesktop();
  return invoke<DbExecutionSummary[]>('db_executions_list', {
    requirementId: filters?.requirementId,
    scriptId: filters?.scriptId,
  });
}
