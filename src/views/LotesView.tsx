import { useCallback, useEffect, useMemo, useState } from 'react';
import { normalizeError } from '../lib/api';
import {
  cleanupDeployment,
  deleteDeploymentBatch,
  getDeploymentBatchSessions,
  listDeploymentBatches,
  retryDeploymentBatch,
} from '../lib/deployments';
import { formatDateTime } from '../lib/format';
import type {
  ApiError,
  DeploymentBatchSummary,
  SquashSession,
} from '../types';
import { DeploymentWizardModal } from '../components/requirements/DeploymentWizardModal';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { EmptyState } from '../components/ui/EmptyState';
import { Icon } from '../components/ui/Icon';
import { Spinner } from '../components/ui/Spinner';
import { StatusChip } from '../components/ui/StatusChip';
import { toast } from '../components/ui/Toast';
import '../batches.css';

type BatchFilter = 'active' | 'all';

interface OpenBatch {
  sessions: SquashSession[];
  requirementIds: string[];
}

export function LotesView() {
  const [batches, setBatches] = useState<DeploymentBatchSummary[]>([]);
  const [filter, setFilter] = useState<BatchFilter>('active');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [openingBatchId, setOpeningBatchId] = useState<string | null>(null);
  const [retryingBatchId, setRetryingBatchId] = useState<string | null>(null);
  const [cleaningBatchId, setCleaningBatchId] = useState<string | null>(null);
  const [cleanupTarget, setCleanupTarget] = useState<DeploymentBatchSummary | null>(
    null,
  );
  const [deletingBatchId, setDeletingBatchId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeploymentBatchSummary | null>(
    null,
  );
  const [query, setQuery] = useState('');
  const [openBatch, setOpenBatch] = useState<OpenBatch | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setBatches(await listDeploymentBatches());
      setError(null);
    } catch (caught) {
      setError(normalizeError(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activeCount = batches.filter(
    (batch) => !['completed', 'cancelled'].includes(batch.status),
  ).length;
  const conflictCount = batches.filter(
    (batch) => batch.status === 'conflict',
  ).length;
  const pendingCount = batches.filter(
    (batch) => batch.pendingCount > 0 && batch.status !== 'cancelled',
  ).length;
  const completedCount = batches.filter(
    (batch) => batch.status === 'completed',
  ).length;

  const normalizedQuery = query.trim().toLowerCase();
  const visible = useMemo(() => {
    const base =
      filter === 'active'
        ? batches.filter(
            (batch) => !['completed', 'cancelled'].includes(batch.status),
          )
        : batches;
    if (!normalizedQuery) return base;
    // Con búsqueda activa se consultan todos los lotes, no solo la pestaña.
    return batches.filter(
      (batch) =>
        batch.requirements.some(
          (requirement) =>
            requirement.externalKey.toLowerCase().includes(normalizedQuery) ||
            requirement.title.toLowerCase().includes(normalizedQuery),
        ) ||
        batch.environmentLabel.toLowerCase().includes(normalizedQuery) ||
        batch.repositories.some((repository) =>
          repository.toLowerCase().includes(normalizedQuery),
        ) ||
        batch.batchId.toLowerCase().includes(normalizedQuery),
    );
  }, [batches, filter, normalizedQuery]);

  async function open(batch: DeploymentBatchSummary) {
    setOpeningBatchId(batch.batchId);
    try {
      const sessions = await getDeploymentBatchSessions(batch.batchId);
      const requirementIds = Array.from(
        new Set(
          sessions.flatMap((session) =>
            session.selectedRequirements.map((requirement) => requirement.id),
          ),
        ),
      );
      setOpenBatch({ sessions, requirementIds });
    } catch (caught) {
      const apiError = normalizeError(caught);
      toast.error('No se pudo abrir el lote', { description: apiError.message });
    } finally {
      setOpeningBatchId(null);
    }
  }

  async function retry(batch: DeploymentBatchSummary) {
    setRetryingBatchId(batch.batchId);
    try {
      const sessions = await retryDeploymentBatch(batch.batchId);
      const requirementIds = Array.from(
        new Set(
          sessions.flatMap((session) =>
            session.selectedRequirements.map((requirement) => requirement.id),
          ),
        ),
      );
      setOpenBatch({ sessions, requirementIds });
      toast.success('Lote reintentado', {
        description: `${sessions.length} repositorio(s) listos para crear la rama hija.`,
      });
      void load();
    } catch (caught) {
      const apiError = normalizeError(caught);
      toast.error('No se pudo reintentar el lote', {
        description: apiError.message,
      });
    } finally {
      setRetryingBatchId(null);
    }
  }

  async function clean(batch: DeploymentBatchSummary) {
    setCleaningBatchId(batch.batchId);
    try {
      const sessions = await getDeploymentBatchSessions(batch.batchId);
      const result = await cleanupDeployment(sessions.map((session) => session.id));
      setCleanupTarget(null);
      if (result.failedBranches.length > 0) {
        toast.warning('Algunas ramas locales no se pudieron borrar', {
          description: result.failedBranches.join(', '),
        });
      } else if (result.cleanedBranches.length > 0) {
        toast.success(
          `${result.cleanedBranches.length} rama(s) local(es) eliminada(s)`,
          {
            description:
              'Las ramas del remoto y el ambiente no se tocaron; el lote sigue completado.',
          },
        );
      } else {
        toast.info('No había ramas locales por limpiar');
      }
      void load();
    } catch (caught) {
      toast.error('No se pudieron limpiar las ramas', {
        description: normalizeError(caught).message,
      });
    } finally {
      setCleaningBatchId(null);
    }
  }

  async function removeBatch(batch: DeploymentBatchSummary) {
    setDeletingBatchId(batch.batchId);
    try {
      const result = await deleteDeploymentBatch(batch.batchId);
      setDeleteTarget(null);
      if (result.failedBranches.length > 0) {
        toast.warning('Registro eliminado con avisos', {
          description: `${result.deletedSessions} sesión(es) eliminadas. No se pudieron borrar: ${result.failedBranches.join(', ')}.`,
        });
      } else {
        toast.success('Registro de despliegue eliminado', {
          description: `${result.deletedSessions} sesión(es) eliminadas${
            result.cleanedBranches.length > 0
              ? `; ${result.cleanedBranches.length} rama(s) local(es) limpiadas`
              : ''
          }. El remoto y el ambiente no se tocaron.`,
        });
      }
      void load();
    } catch (caught) {
      toast.error('No se pudo eliminar el registro', {
        description: normalizeError(caught).message,
      });
    } finally {
      setDeletingBatchId(null);
    }
  }

  return (
    <div className="batches">
      <section className="batches-summary" aria-label="Resumen de lotes">
        <div className="batches-stat">
          <span>Activos</span>
          <strong>{activeCount}</strong>
        </div>
        <div className={`batches-stat ${conflictCount > 0 ? 'is-warning' : ''}`.trim()}>
          <span>Con conflicto</span>
          <strong>{conflictCount}</strong>
        </div>
        <div className="batches-stat">
          <span>Pendientes</span>
          <strong>{pendingCount}</strong>
        </div>
        <div className="batches-stat is-done">
          <span>Completados</span>
          <strong>{completedCount}</strong>
        </div>
      </section>

      <div className="batches-toolbar">
        <div className="batches-toolbar-main">
          <div className="batches-tabs">
            <button
              type="button"
              className={`btn btn-sm ${filter === 'active' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setFilter('active')}
            >
              Activos
            </button>
            <button
              type="button"
              className={`btn btn-sm ${filter === 'all' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setFilter('all')}
            >
              Todos
            </button>
          </div>
          <div className="batches-search">
            <Icon name="search" size={13} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por requerimiento, repositorio o ambiente"
              aria-label="Buscar lotes por requerimiento"
              spellCheck={false}
            />
            {query ? (
              <button
                type="button"
                className="batches-search-clear"
                onClick={() => setQuery('')}
                title="Limpiar búsqueda"
                aria-label="Limpiar búsqueda"
              >
                <Icon name="x" size={11} />
              </button>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => void load()}
          disabled={loading}
        >
          <Icon name="refresh" size={13} />
          Actualizar
        </button>
      </div>

      {normalizedQuery ? (
        <p className="batches-search-hint">
          {visible.length} de {batches.length} lote(s) coinciden con “{query.trim()}”.
          La búsqueda incluye todos los lotes, no solo la pestaña activa.
        </p>
      ) : null}

      {error ? (
        <div className="batches-error">
          <Icon name="alert" size={16} />
          <span>{error.message}</span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => void load()}
          >
            Reintentar
          </button>
        </div>
      ) : null}

      {loading && batches.length === 0 ? (
        <div className="loading-panel">
          <Spinner size="lg" label="Leyendo lotes de despliegue…" />
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<Icon name="package" size={26} />}
          title={
            normalizedQuery
              ? 'Sin resultados'
              : filter === 'active'
                ? 'No hay lotes activos'
                : 'Todavía no hay lotes'
          }
          description={
            normalizedQuery
              ? `Ningún lote coincide con “${query.trim()}”. Prueba con la clave del requerimiento, por ejemplo BPIM-152.`
              : filter === 'active'
                ? 'Cuando prepares un despliegue desde Requerimientos, aparecerá aquí con su avance.'
                : 'Selecciona requerimientos y usa “Preparar despliegue” para crear el primer lote.'
          }
          action={
            normalizedQuery ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setQuery('')}
              >
                Limpiar búsqueda
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="batches-list">
          {visible.map((batch) => (
            <BatchCard
              key={batch.batchId}
              batch={batch}
              opening={openingBatchId === batch.batchId}
              retrying={retryingBatchId === batch.batchId}
              cleaning={cleaningBatchId === batch.batchId}
              deleting={deletingBatchId === batch.batchId}
              onOpen={() => void open(batch)}
              onRetry={() => void retry(batch)}
              onCleanup={() => setCleanupTarget(batch)}
              onDelete={() => setDeleteTarget(batch)}
            />
          ))}
        </div>
      )}

      {openBatch ? (
        <DeploymentWizardModal
          key={openBatch.sessions.map((session) => session.id).join('|')}
          requirementIds={openBatch.requirementIds}
          initialSessions={openBatch.sessions}
          onClose={() => {
            setOpenBatch(null);
            void load();
          }}
          onChanged={() => void load()}
          onFinished={() => {
            setOpenBatch(null);
            void load();
          }}
        />
      ) : null}

      {cleanupTarget ? (
        <ConfirmModal
          title="Limpiar ramas locales"
          message={`Se eliminarán las ramas hijas locales y los worktrees del lote de ${cleanupTarget.environmentLabel}. Las ramas ya empujadas a GitHub y el ambiente no se tocan; el lote sigue completado.`}
          confirmLabel="Limpiar ramas"
          busy={cleaningBatchId === cleanupTarget.batchId}
          onConfirm={() => void clean(cleanupTarget)}
          onClose={() => setCleanupTarget(null)}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmModal
          title="Eliminar registro de despliegue"
          message={`Se eliminará el registro del lote de ${deleteTarget.environmentLabel} (${deleteTarget.repositoryCount} repositorio(s), ${deleteTarget.requirementCount} requerimiento(s)) y se limpiarán los worktrees y ramas locales que queden. Las ramas ya empujadas a GitHub y el ambiente no se tocan.${
            deleteTarget.pendingCount > 0 || deleteTarget.conflictCount > 0
              ? ' Este lote tiene sesiones pendientes: al eliminar el registro ya no podrás reanudarlo desde FlowManager.'
              : ''
          }`}
          confirmLabel="Eliminar registro"
          tone="danger"
          busy={deletingBatchId === deleteTarget.batchId}
          onConfirm={() => void removeBatch(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
        />
      ) : null}
    </div>
  );
}

function BatchCard({
  batch,
  opening,
  retrying,
  cleaning,
  deleting,
  onOpen,
  onRetry,
  onCleanup,
  onDelete,
}: {
  batch: DeploymentBatchSummary;
  opening: boolean;
  retrying: boolean;
  cleaning: boolean;
  deleting: boolean;
  onOpen: () => void;
  onRetry: () => void;
  onCleanup: () => void;
  onDelete: () => void;
}) {
  const progress =
    batch.repositoryCount === 0
      ? 0
      : Math.round((batch.pushedCount / batch.repositoryCount) * 100);

  return (
    <article className={`batch-card is-${batch.status}`}>
      <div className="batch-card-head">
        <div>
          <div className="batch-title-row">
            <strong>{batch.environmentLabel}</strong>
            <StatusChip tone={batchTone(batch.status)}>
              {batchStatusLabel(batch.status)}
            </StatusChip>
          </div>
          <small>
            {formatDateTime(batch.createdAt)} · {batch.repositoryCount} repositorio(s) ·{' '}
            {batch.requirementCount} requerimiento(s)
          </small>
        </div>
        <div className="batch-card-actions">
          {batch.status !== 'completed' ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onRetry}
              disabled={retrying || opening}
              title="Vuelve a unificar los cambios y prepara un lote nuevo con los commits actuales"
            >
              {retrying ? <Spinner size="sm" /> : <Icon name="refresh" size={13} />}
              {retrying ? 'Reintentando…' : 'Reintentar'}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onCleanup}
              disabled={cleaning || opening || retrying}
              title="Elimina las ramas hijas locales y los worktrees del lote; el remoto y el ambiente no se tocan"
            >
              {cleaning ? <Spinner size="sm" /> : <Icon name="trash" size={13} />}
              {cleaning ? 'Limpiando…' : 'Limpiar ramas'}
            </button>
          )}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onOpen}
            disabled={opening || retrying || cleaning}
          >
            {opening ? <Spinner size="sm" /> : <Icon name="eye" size={13} />}
            {opening ? 'Abriendo…' : 'Abrir lote'}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm batch-delete"
            onClick={onDelete}
            disabled={deleting || opening || retrying || cleaning}
            title="Elimina el registro del lote en FlowManager y limpia los artefactos locales. No borra ramas del remoto ni modifica el ambiente."
          >
            {deleting ? <Spinner size="sm" /> : <Icon name="x" size={13} />}
            {deleting ? 'Eliminando…' : 'Eliminar'}
          </button>
        </div>
      </div>

      <div className="batch-progress">
        <div className="batch-progress-bar">
          <span style={{ width: `${progress}%` }} />
        </div>
        <span>
          {batch.pushedCount}/{batch.repositoryCount} empujadas
          {batch.pendingCount > 0 ? ` · ${batch.pendingCount} pendiente(s)` : ''}
          {batch.conflictCount > 0
            ? ` · ${batch.conflictCount} con conflicto`
            : ''}
        </span>
      </div>

      <div className="batch-meta">
        <div className="batch-repos">
          {batch.repositories.slice(0, 6).map((repository) => (
            <span key={repository}>{repository}</span>
          ))}
          {batch.repositories.length > 6 ? (
            <span>+{batch.repositories.length - 6}</span>
          ) : null}
        </div>
        <div className="batch-reqs">
          {batch.requirements.slice(0, 10).map((requirement) => (
            <code key={requirement.id}>{requirement.externalKey}</code>
          ))}
          {batch.requirements.length > 10 ? (
            <span>+{batch.requirements.length - 10}</span>
          ) : null}
        </div>
      </div>

      <footer className="batch-card-footer">
        <span>Actualizado {formatDateTime(batch.updatedAt)}</span>
        <code title={batch.batchId}>lote {batch.batchId.slice(-8)}</code>
      </footer>
    </article>
  );
}

function batchTone(
  status: DeploymentBatchSummary['status'],
): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  switch (status) {
    case 'conflict':
      return 'warning';
    case 'completed':
      return 'success';
    case 'failed':
      return 'danger';
    case 'ready_push':
    case 'ready_create':
    case 'in_progress':
      return 'info';
    default:
      return 'neutral';
  }
}

function batchStatusLabel(status: DeploymentBatchSummary['status']): string {
  switch (status) {
    case 'conflict':
      return 'Conflicto';
    case 'completed':
      return 'Completado';
    case 'ready_push':
      return 'Falta pushear';
    case 'ready_create':
      return 'Falta crear rama';
    case 'failed':
      return 'Falló';
    case 'cancelled':
      return 'Cancelado';
    default:
      return 'En proceso';
  }
}
