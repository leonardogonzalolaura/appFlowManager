import { useCallback, useEffect, useState } from 'react';
import { normalizeError } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import {
  deleteDbScript,
  listDbConnections,
  listDbExecutions,
  listDbScripts,
  reorderDbScripts,
} from '../../lib/database';
import { listEnvironments } from '../../lib/repositories';
import type {
  ApiError,
  DbConnectionSummary,
  DbExecutionSummary,
  DbScriptSummary,
  EnvironmentDefinition,
  RequirementRepositoryMapping,
} from '../../types';
import { Callout } from '../ui/Callout';
import { ConfirmModal } from '../ui/ConfirmModal';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';
import { StatusChip } from '../ui/StatusChip';
import { toast } from '../ui/Toast';
import { ExecuteScriptsModal } from './ExecuteScriptsModal';
import { ScriptEditorModal } from './ScriptEditorModal';
import '../../database.css';

interface RequirementScriptsModalProps {
  requirementId: string;
  requirementKey: string;
  repositories: RequirementRepositoryMapping[];
  onClose: () => void;
  onChanged?: () => void;
}

export function RequirementScriptsModal({
  requirementId,
  requirementKey,
  repositories,
  onClose,
  onChanged,
}: RequirementScriptsModalProps) {
  const [scripts, setScripts] = useState<DbScriptSummary[]>([]);
  const [environments, setEnvironments] = useState<EnvironmentDefinition[]>([]);
  const [connections, setConnections] = useState<DbConnectionSummary[]>([]);
  const [executions, setExecutions] = useState<DbExecutionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [editorScript, setEditorScript] = useState<DbScriptSummary | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [deleting, setDeleting] = useState<DbScriptSummary | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [executeScripts, setExecuteScripts] = useState<DbScriptSummary[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [loadedScripts, loadedEnvironments, loadedConnections, loadedExecutions] =
        await Promise.all([
          listDbScripts({ requirementId }),
          listEnvironments(),
          listDbConnections(),
          listDbExecutions({ requirementId }),
        ]);
      setScripts(loadedScripts);
      setEnvironments(loadedEnvironments);
      setConnections(loadedConnections);
      setExecutions(loadedExecutions);
      setError(null);
    } catch (caught) {
      setError(normalizeError(caught));
    } finally {
      setLoading(false);
    }
  }, [requirementId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function move(script: DbScriptSummary, direction: -1 | 1) {
    const sameRepository = scripts
      .filter((item) => item.repositoryId === script.repositoryId)
      .sort((left, right) => left.sequenceNo - right.sequenceNo);
    const index = sameRepository.findIndex((item) => item.id === script.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= sameRepository.length) return;
    const reordered = [...sameRepository];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    try {
      await reorderDbScripts(
        requirementId,
        script.repositoryId,
        reordered.map((item) => item.id),
      );
      await load();
    } catch (caught) {
      toast.error('No se pudo reordenar', {
        description: normalizeError(caught).message,
      });
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await deleteDbScript(deleting.id);
      setDeleting(null);
      await load();
      onChanged?.();
      toast.success('Script eliminado', { description: deleting.name });
    } catch (caught) {
      toast.error('No se pudo eliminar el script', {
        description: normalizeError(caught).message,
      });
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <Modal
      title={`Scripts SQL · ${requirementKey}`}
      description="Scripts ordenados por repositorio. La ejecución siempre requiere confirmación."
      size="lg"
      icon={<Icon name="database" size={20} />}
      onClose={editorOpen || executeScripts || deleting ? () => undefined : onClose}
      closeOnBackdrop={!editorOpen && !executeScripts && !deleting}
      footer={
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Cerrar
        </button>
      }
    >
      <div className="db-scripts">
        <div className="db-scripts-toolbar">
          <div>
            <strong>{scripts.length}</strong>
            <span> script(s)</span>
          </div>
          <div className="db-scripts-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setExecuteScripts(scripts.filter((script) => script.isActive))}
              disabled={scripts.filter((script) => script.isActive).length === 0}
            >
              <Icon name="play" size={13} />
              Ejecutar todos
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                setEditorScript(null);
                setEditorOpen(true);
              }}
              disabled={repositories.length === 0}
            >
              <Icon name="plus" size={13} />
              Nuevo script
            </button>
          </div>
        </div>

        {repositories.length === 0 ? (
          <Callout tone="warning" title="Primero asigna un repositorio">
            Los scripts deben pertenecer a un repositorio del requerimiento. Asigna uno
            desde el detalle y vuelve a abrir esta ventana.
          </Callout>
        ) : null}

        {error ? (
          <Callout
            tone="danger"
            title="No se pudieron leer los scripts"
            action={
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => void load()}
              >
                Reintentar
              </button>
            }
          >
            {error.message}
          </Callout>
        ) : null}

        {loading && scripts.length === 0 ? (
          <div className="loading-panel">
            <Spinner size="lg" label="Leyendo scripts…" />
          </div>
        ) : scripts.length === 0 ? (
          <div className="db-empty-scripts">
            <Icon name="file" size={22} />
            <strong>Todavía no hay scripts</strong>
            <span>Agrega el SQL que debe ejecutarse para este requerimiento.</span>
          </div>
        ) : (
          <div className="db-script-list">
            {scripts.map((script) => {
              const sameRepository = scripts
                .filter((item) => item.repositoryId === script.repositoryId)
                .sort((left, right) => left.sequenceNo - right.sequenceNo);
              const index = sameRepository.findIndex((item) => item.id === script.id);
              return (
                <div key={script.id} className={`db-script-row ${script.isActive ? '' : 'is-inactive'}`}>
                  <span className="db-sequence">{script.sequenceNo}</span>
                  <span className="db-script-copy">
                    <strong>{script.name}</strong>
                    <small>
                      {script.repositoryName} ·{' '}
                      {script.engine === 'sqlserver' ? 'SQL Server' : 'PostgreSQL'} ·{' '}
                      {script.environmentScope === 'all'
                        ? 'todos los ambientes'
                        : `solo ${script.environmentScope}`}
                    </small>
                    <code>{script.checksum.slice(0, 10)}</code>
                  </span>
                  <StatusChip tone={script.isActive ? 'info' : 'neutral'}>
                    {script.isActive ? 'Activo' : 'Inactivo'}
                  </StatusChip>
                  <div className="db-script-actions">
                    <button
                      type="button"
                      className="btn btn-icon btn-ghost btn-xs"
                      title="Subir"
                      aria-label="Subir script"
                      onClick={() => void move(script, -1)}
                      disabled={index <= 0}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn btn-icon btn-ghost btn-xs"
                      title="Bajar"
                      aria-label="Bajar script"
                      onClick={() => void move(script, 1)}
                      disabled={index < 0 || index >= sameRepository.length - 1}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="btn btn-icon btn-ghost btn-xs"
                      title="Ejecutar"
                      aria-label="Ejecutar script"
                      onClick={() => setExecuteScripts([script])}
                      disabled={!script.isActive}
                    >
                      <Icon name="play" size={13} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-icon btn-ghost btn-xs"
                      title="Editar"
                      aria-label="Editar script"
                      onClick={() => {
                        setEditorScript(script);
                        setEditorOpen(true);
                      }}
                    >
                      <Icon name="settings" size={13} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-icon btn-ghost btn-xs db-remove"
                      title="Eliminar"
                      aria-label="Eliminar script"
                      onClick={() => setDeleting(script)}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="form-note">
          <Icon name="shield" size={14} />
          <span>
            Los scripts se guardan en FlowManager y no se commitean automáticamente.
            Configura las conexiones en la sección Bases de datos.
          </span>
        </div>

        {executions.length > 0 ? (
          <div className="db-execution-history">
            <div className="req-detail-section-head">
              <h3>Últimas ejecuciones</h3>
              <span className="req-section-meta">{executions.length}</span>
            </div>
            {executions.slice(0, 6).map((execution) => (
              <div key={execution.id} className="db-execution-row">
                <StatusChip
                  tone={
                    execution.status === 'success'
                      ? 'success'
                      : execution.status === 'failed'
                        ? 'danger'
                        : 'neutral'
                  }
                >
                  {execution.status === 'success'
                    ? 'OK'
                    : execution.status === 'failed'
                      ? 'Falló'
                      : 'Omitido'}
                </StatusChip>
                <span>{execution.scriptName}</span>
                <span>{execution.environment}</span>
                <span>{execution.durationMs} ms</span>
                <small>{formatDateTime(execution.executedAt)}</small>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {editorOpen ? (
        <ScriptEditorModal
          requirementId={requirementId}
          repositories={repositories}
          environments={environments}
          script={editorScript}
          onClose={() => {
            setEditorOpen(false);
            setEditorScript(null);
          }}
          onSaved={(saved) => {
            setEditorOpen(false);
            setEditorScript(null);
            void load();
            onChanged?.();
            toast.success(editorScript ? 'Script actualizado' : 'Script creado', {
              description: saved.name,
            });
          }}
        />
      ) : null}

      {executeScripts ? (
        <ExecuteScriptsModal
          scripts={executeScripts}
          environments={environments}
          connections={connections}
          onClose={() => {
            setExecuteScripts(null);
            void load();
          }}
          onExecuted={() => {
            void load();
            onChanged?.();
          }}
        />
      ) : null}

      {deleting ? (
        <ConfirmModal
          title="Eliminar script"
          message={`Se eliminará "${deleting.name}". El historial de ejecuciones se conserva.`}
          confirmLabel="Eliminar"
          tone="danger"
          busy={deleteBusy}
          onConfirm={() => void confirmDelete()}
          onClose={() => setDeleting(null)}
        />
      ) : null}
    </Modal>
  );
}
