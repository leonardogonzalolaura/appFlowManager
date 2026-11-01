import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './api';
import type { RequirementPresence } from '../types';

/**
 * Estado real de cada requerimiento en cada ambiente.
 *
 * Se calcula comparando **contenido** (no SHA) porque un squash merge genera
 * commits nuevos: el commit original nunca aparece en la rama del ambiente.
 */
export async function getEnvironmentStatus(
  requirementIds: string[],
): Promise<RequirementPresence[]> {
  if (!isTauri() || requirementIds.length === 0) return [];
  return invoke<RequirementPresence[]>('environment_status', { requirementIds });
}
