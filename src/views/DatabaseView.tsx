import { useCallback, useEffect, useState } from 'react';
import { normalizeError } from '../lib/api';
import {
  deleteDbConnection,
  listDbConnections,
  testDbConnection,
  upsertDbConnection,
} from '../lib/database';
import { listEnvironments, listRepositories } from '../lib/repositories';
import type {
  ApiError,
  DbConnectionSummary,
  EnvironmentDefinition,
  RepositorySummary,
} from '../types';
import { ConnectionModal } from '../components/database/ConnectionModal';
import { Callout } from '../components/ui/Callout';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { EmptyState } from '../components/ui/EmptyState';
import { Icon } from '../components/ui/Icon';
import { Spinner } from '../components/ui/Spinner';
import { StatusChip } from '../components/ui/StatusChip';
import { toast } from '../components/ui/Toast';
import '../database.css';

export function DatabaseView() {
  const [connections, setConnections] = useState<DbConnectionSummary[]>([]);
  const [environments, setEnvironments] = useState<EnvironmentDefinition[]>([]);
  const [repositories, setRepositories] = useState<RepositorySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [editing, setEditing] = useState<DbConnectionSummary | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<DbConnectionSummary | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [loadedConnections, loadedEnvironments, loadedRepositories] =
        await Promise.all([
          listDbConnections(),
          listEnvironments(),
          listRepositories(),
        ]);
      setConnections(loadedConnections);
      setEnvironments(loadedEnvironments);
      setRepositories(loadedRepositories);
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

  async function handleTest(connection: DbConnectionSummary) {
    setTesting(connection.id);
    try {
      const result = await testDbConnection(connection.id);
      if (result.ok) {
        toast.success('Conexión correcta', {
          description: `${result.latencyMs} ms · ${connection.host}:${connection.port}`,
        });
      } else {
        toast.error('No se pudo conectar', { description: result.message });
      }
    } catch (caught) {
      toast.error('No se pudo probar la conexión', {
        description: normalizeError(caught).message,
      });
    } finally {
      setTesting(null);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setRemoveBusy(true);
    try {
      await deleteDbConnection(deleting.id);
      setDeleting(null);
      await load();
      toast.success('Conexión eliminada', {
        description: deleting.repositoryName ?? 'Global',
      });
    } catch (caught) {
      toast.error('No se pudo eliminar', {
        description: normalizeError(caught).message,
      });
    } finally {
      setRemoveBusy(false);
    }
  }

  return (
    <div className="database-view">
      <div className="database-toolbar">
        <div>
          <strong>{connections.length}</strong>
          <span> conexión(es) configuradas</span>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Icon name="plus" size={14} />
          Nueva conexión
        </button>
      </div>

      <Callout tone="info" title="Secretos cifrados con DPAPI">
        La contraseña se guarda cifrada en SQLite y nunca se devuelve al frontend.
        Configura una conexión global o una específica por repositorio y ambiente.
      </Callout>

      {error ? (
        <Callout
          tone="danger"
          title="No pudimos leer las conexiones"
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

      {loading && connections.length === 0 ? (
        <div className="loading-panel">
          <Spinner size="lg" label="Leyendo conexiones…" />
        </div>
      ) : connections.length === 0 ? (
        <EmptyState
          icon={<Icon name="database" size={26} />}
          title="Sin conexiones de base de datos"
          description="Agrega una conexión por ambiente para poder probar y ejecutar scripts SQL."
          action={
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Icon name="plus" size={14} />
              Nueva conexión
            </button>
          }
        />
      ) : (
        <div className="database-list">
          {connections.map((connection) => (
            <article key={connection.id} className="database-card">
              <div className="database-card-head">
                <div>
                  <div className="database-title-row">
                    <strong>{connection.repositoryName ?? 'Global'}</strong>
                    <StatusChip tone="info">{connection.environmentLabel}</StatusChip>
                    <StatusChip tone={connection.isActive ? 'success' : 'neutral'}>
                      {connection.isActive ? 'Activa' : 'Inactiva'}
                    </StatusChip>
                  </div>
                  <small>
                    {connection.engine === 'sqlserver' ? 'SQL Server' : 'PostgreSQL'} ·{' '}
                    {connection.host}:{connection.port} / {connection.databaseName}
                  </small>
                </div>
                <code>{connection.username}</code>
              </div>

              <div className="database-card-meta">
                <span>SSL: {sslLabel(connection.sslMode)}</span>
                <span>Contraseña: {connection.hasPassword ? 'configurada' : 'pendiente'}</span>
                <span>Actualizada {connection.updatedAt.slice(0, 10)}</span>
              </div>

              <div className="database-card-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => void handleTest(connection)}
                  disabled={testing === connection.id}
                >
                  {testing === connection.id ? (
                    <Spinner size="sm" />
                  ) : (
                    <Icon name="play" size={13} />
                  )}
                  {testing === connection.id ? 'Probando…' : 'Probar conexión'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setEditing(connection);
                    setFormOpen(true);
                  }}
                >
                  <Icon name="settings" size={13} />
                  Editar
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm database-remove"
                  onClick={() => setDeleting(connection)}
                >
                  <Icon name="trash" size={13} />
                  Eliminar
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {formOpen ? (
        <ConnectionModal
          connection={editing}
          environments={environments}
          repositories={repositories}
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
          }}
          onSaved={(saved) => {
            setFormOpen(false);
            setEditing(null);
            void load();
            toast.success(editing ? 'Conexión actualizada' : 'Conexión creada', {
              description: `${saved.environmentLabel} · ${saved.host}:${saved.port}`,
            });
          }}
          onSave={upsertDbConnection}
        />
      ) : null}

      {deleting ? (
        <ConfirmModal
          title="Eliminar conexión"
          message={`Se eliminará la conexión de ${deleting.repositoryName ?? 'Global'} para ${deleting.environmentLabel}. El secreto cifrado también se borrará.`}
          confirmLabel="Eliminar"
          tone="danger"
          busy={removeBusy}
          onConfirm={() => void confirmDelete()}
          onClose={() => setDeleting(null)}
        />
      ) : null}
    </div>
  );
}

function sslLabel(value: string | null): string {
  switch (value) {
    case 'disable':
      return 'deshabilitado';
    case 'trust':
      return 'requerido, certificado no validado';
    default:
      return 'requerido';
  }
}
