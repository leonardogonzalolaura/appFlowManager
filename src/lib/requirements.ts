import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './api';
import type {
  ImportPreview,
  ImportResult,
  ManualRequirementInput,
  ManualRequirementPatch,
  RequirementDetail,
  RequirementFacets,
  RequirementFilter,
  RequirementListItem,
  RequirementPage,
  RequirementRepositoryMapping,
} from '../types';

const DEMO_ERROR = {
  code: 'DEMO_MODE',
  message: 'Esta acción requiere la app de escritorio de FlowManager.',
  retryable: false,
};

function requireDesktop(): void {
  if (!isTauri()) throw DEMO_ERROR;
}

export async function listRequirements(
  filter: RequirementFilter,
  page = 1,
  pageSize = 50,
): Promise<RequirementPage> {
  if (!isTauri()) return demoPage(filter, page, pageSize);
  return invoke<RequirementPage>('requirements_list', { filter, page, pageSize });
}

export async function getRequirementFacets(): Promise<RequirementFacets> {
  if (!isTauri()) return demoFacets();
  return invoke<RequirementFacets>('requirements_facets');
}

export async function getRequirement(
  requirementId: string,
): Promise<RequirementDetail> {
  if (!isTauri()) return demoDetail(requirementId);
  return invoke<RequirementDetail>('requirements_get', { requirementId });
}

export async function previewImport(filePath: string): Promise<ImportPreview> {
  requireDesktop();
  return invoke<ImportPreview>('requirements_import_preview', { filePath });
}

export async function commitImport(input: {
  filePath: string;
  fileHash: string;
  adoptManualKeys?: boolean;
}): Promise<ImportResult> {
  requireDesktop();
  return invoke<ImportResult>('requirements_import_commit', { input });
}

export async function createManualRequirement(
  input: ManualRequirementInput,
): Promise<RequirementDetail> {
  requireDesktop();
  return invoke<RequirementDetail>('requirements_create_manual', { input });
}

export async function updateManualRequirement(
  requirementId: string,
  patch: ManualRequirementPatch,
): Promise<RequirementDetail> {
  requireDesktop();
  return invoke<RequirementDetail>('requirements_update_manual', {
    requirementId,
    patch,
  });
}

export async function archiveManualRequirement(
  requirementId: string,
): Promise<void> {
  requireDesktop();
  return invoke<void>('requirements_archive_manual', { requirementId });
}

export async function assignRequirementRepository(input: {
  requirementId: string;
  repositoryId: string;
  branchName?: string;
}): Promise<RequirementRepositoryMapping> {
  requireDesktop();
  return invoke<RequirementRepositoryMapping>(
    'requirements_assign_repository',
    { input },
  );
}

export async function unassignRequirementRepository(
  requirementId: string,
  repositoryId: string,
): Promise<void> {
  requireDesktop();
  return invoke<void>('requirements_unassign_repository', {
    requirementId,
    repositoryId,
  });
}

const DEMO_ITEMS: RequirementListItem[] = [
  {
    id: 'demo-req-183',
    externalKey: 'BPIM-183',
    source: 'monday',
    title: 'Nuevo flujo de reintentos de pago',
    type: 'User Story',
    feature: 'Operación - Plataforma',
    developer: 'Leonardo Daniel Gonzalo Laura - Inetum',
    status: 'In Progress',
    priority: 'High',
    repoCount: 2,
    manualCreated: false,
    manualLocked: false,
    updatedAt: new Date(Date.now() - 3_600_000).toISOString(),
    lastImportPresent: true,
    archivedAt: null,
  },
  {
    id: 'demo-req-190',
    externalKey: 'BPIM-190',
    source: 'monday',
    title: 'Corrección de redondeo de impuestos',
    type: 'Bug',
    feature: 'Facturación',
    developer: 'Melissa Espinoza - Inetum',
    status: 'Ready to start',
    priority: 'Critical',
    repoCount: 1,
    manualCreated: false,
    manualLocked: false,
    updatedAt: new Date(Date.now() - 86_400_000).toISOString(),
    lastImportPresent: true,
    archivedAt: null,
  },
  {
    id: 'demo-req-man1',
    externalKey: 'MAN-0001',
    source: 'manual',
    title: 'Validación manual de FlowManager',
    type: 'Task',
    feature: 'FlowManager',
    developer: 'Leonardo Daniel Gonzalo Laura - Inetum',
    status: 'In Progress',
    priority: 'Medium',
    repoCount: 0,
    manualCreated: true,
    manualLocked: false,
    updatedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    lastImportPresent: true,
    archivedAt: null,
  },
];

function demoPage(
  filter: RequirementFilter,
  page: number,
  pageSize: number,
): RequirementPage {
  const search = filter.search?.trim().toLowerCase();
  const developers = filter.developers?.map((value) => value.toLowerCase());
  const filtered = DEMO_ITEMS.filter((item) => {
    if (filter.source && item.source !== filter.source) return false;
    if (
      developers?.length &&
      !developers.includes((item.developer ?? '').toLowerCase())
    ) {
      return false;
    }
    if (filter.status && item.status !== filter.status) return false;
    if (filter.priority && item.priority !== filter.priority) return false;
    if (search) {
      const haystack = `${item.externalKey} ${item.title} ${item.feature ?? ''}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
  const start = (page - 1) * pageSize;
  return {
    items: filtered.slice(start, start + pageSize),
    total: filtered.length,
    page,
    pageSize,
  };
}

function demoFacets(): RequirementFacets {
  return {
    developers: [
      'Leonardo Daniel Gonzalo Laura - Inetum',
      'Melissa Espinoza - Inetum',
    ],
    statuses: ['In Progress', 'Ready to start', 'To Do', 'QA Done'],
    priorities: ['Critical', 'High', 'Medium', 'Low', 'Missing'],
    features: ['Operación - Plataforma', 'Facturación', 'FlowManager'],
  };
}

function demoDetail(requirementId: string): RequirementDetail {
  const item = DEMO_ITEMS.find((entry) => entry.id === requirementId) ?? DEMO_ITEMS[0];
  return {
    ...item,
    qa: 'Monica Chacon',
    informed: 'Kevin Ubaldo Atachagua Flores',
    subtasksSummary: 'Backend, Frontend, Pruebas',
    timelineStart: '2026-10-20',
    timelineEnd: '2026-11-15',
    mondayDocUrl: null,
    sourceCreatedAt: '2026-10-19T13:10:00Z',
    sourceUpdatedAt: '2026-10-27T18:00:00Z',
    firstSeenAt: '2026-10-31T12:00:00Z',
    lastSeenAt: '2026-10-31T12:00:00Z',
    manualCreated: item.source === 'manual',
    manualLocked: false,
    isActive: true,
    notes: 'Nota local de ejemplo.',
    createdAt: '2026-10-31T12:00:00Z',
    subtasks: [
      {
        id: 'demo-sub-1',
        name: 'Backend de reintentos',
        owner: 'Leonardo Daniel Gonzalo Laura - Inetum',
        status: 'Done',
        estimatedSp: 3,
        actualSp: 4,
        positionNo: 0,
      },
      {
        id: 'demo-sub-2',
        name: 'Frontend de configuración',
        owner: 'Melissa Espinoza - Inetum',
        status: 'Working on it',
        estimatedSp: 2,
        actualSp: null,
        positionNo: 1,
      },
    ],
    repositories: [
      {
        id: 'demo-map-1',
        repositoryId: 'demo-repo',
        name: 'payments-api',
        localPath: 'C:\\repos\\payments-api',
        branchName: 'BPIM-183',
        baseBranch: 'master',
        branchStatus: 'planned',
        mappingSource: 'manual',
        notes: null,
        baseSha: null,
        branchCreatedAt: null,
        lastAnalyzedAt: null,
        createdByApp: false,
      },
    ],
  };
}
