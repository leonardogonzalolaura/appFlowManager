import { useCallback, useEffect, useMemo, useState } from 'react';
import { normalizeError } from '../lib/api';
import {
  cleanupDeployment,
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

  const visible = useMemo(
    () =>
      filter === 'active'
        ? batches.filter(
            (batch) => !['completed', 'cancelled'].includes(batch.status),
          )
        : batches,
    [batches, filter],
  );

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
            filter === 'active'
              ? 'No hay lotes activos'
              : 'Todavía no hay lotes'
          }
          description={
            filter === 'active'
              ? 'Cuando prepares un despliegue desde Requerimientos, aparecerá aquí con su avance.'
              : 'Selecciona requerimientos y usa “Preparar despliegue” para crear el primer lote.'
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
              onOpen={() => void open(batch)}
              onRetry={() => void retry(batch)}
              onCleanup={() => setCleanupTarget(batch)}
            />
          ))}
        </div>
      )}

      {openBatch ? (
        <DeploymentWizardModal
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
    </div>
  );
}

function BatchCard({
  batch,
  opening,
  retrying,
  cleaning,
  onOpen,
  onRetry,
  onCleanup,
}: {
  batch: DeploymentBatchSummary;
  opening: boolean;
  retrying: boolean;
  cleaning: boolean;
  onOpen: () => void;
  onRetry: () => void;
  onCleanup: () => void;
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
