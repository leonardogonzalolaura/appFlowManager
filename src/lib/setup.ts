import { formatBytes, formatDateTime } from '../lib/format';
import type { SetupStatus, SystemInfo } from '../types';

export interface ChecklistItem {
  id: 'entorno' | 'repositorios' | 'requerimientos' | 'base-datos';
  step: number;
  title: string;
  description: string;
  phase: string;
  done: boolean;
  available: boolean;
  detail: string;
}

/**
 * Construye la lista de primeros pasos a partir del diagnóstico.
 * Es una función pura para poder probarla sin montar React.
 */
export function buildChecklist(info: SystemInfo): ChecklistItem[] {
  const { setup } = info;

  return [
    {
      id: 'entorno',
      step: 1,
      title: 'Verificar el entorno',
      description:
        'Comprobamos que Git y la base local estén disponibles para trabajar sin sorpresas.',
      phase: 'Fase 0',
      done: setup.gitOk && setup.databaseOk,
      available: true,
      detail: (() => {
        if (!setup.gitOk && !setup.databaseOk) {
          return 'Git y la base local necesitan atención.';
        }
        if (!setup.gitOk) return 'Git no está disponible en el PATH.';
        if (!setup.databaseOk) return 'La base local no pudo abrirse.';
        return `Todo en orden · ${formatBytes(info.dbSizeBytes)} de datos`;
      })(),
    },
    {
      id: 'repositorios',
      step: 2,
      title: 'Conectar tus repositorios',
      description:
        'Agrega las rutas locales, detecta la rama de cada ambiente y elige la rama base.',
      phase: 'Fase 1',
      done: setup.repositoriesOk,
      available: true,
      detail: setup.repositoriesOk
        ? `${info.counts.repositories} repositorio(s) configurado(s)`
        : 'Aún no hay repositorios configurados.',
    },
    {
      id: 'requerimientos',
      step: 3,
      title: 'Cargar requerimientos',
      description:
        'Importa el export de Monday o registra un requerimiento manual que todavía no existe allí.',
      phase: 'Fase 2',
      done: setup.requirementsOk,
      available: true,
      detail: setup.requirementsOk
        ? `${info.counts.requirements} requerimiento(s) cargado(s)`
        : 'La lista está vacía por ahora.',
    },
    {
      id: 'base-datos',
      step: 4,
      title: 'Preparar scripts de base de datos',
      description:
        'Configura conexiones por ambiente y ordena los scripts que acompañan cada despliegue.',
      phase: 'Fase 6',
      done: setup.databaseConfigured,
      available: false,
      detail: setup.databaseConfigured
        ? `${info.counts.databaseConnections} conexión(es) configurada(s)`
        : 'Sin conexiones configuradas.',
    },
  ];
}

export function setupProgress(setup: SetupStatus): number {
  if (setup.totalSteps === 0) return 0;
  return Math.round((setup.completedSteps / setup.totalSteps) * 100);
}

export function environmentSummary(info: SystemInfo): string {
  const parts = [info.os, info.arch].filter(Boolean);
  return parts.join(' · ');
}

export function lastCheckedLabel(startedAt: string): string {
  return formatDateTime(startedAt);
}
