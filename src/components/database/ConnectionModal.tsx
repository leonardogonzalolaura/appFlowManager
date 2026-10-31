import { useMemo, useState } from 'react';
import { normalizeError } from '../../lib/api';
import type {
  ApiError,
  DbConnectionInput,
  DbConnectionSummary,
  DbEngine,
  EnvironmentDefinition,
  RepositorySummary,
} from '../../types';
import { Callout } from '../ui/Callout';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';

interface ConnectionModalProps {
  connection?: DbConnectionSummary | null;
  environments: EnvironmentDefinition[];
  repositories: RepositorySummary[];
  onClose: () => void;
  onSaved: (connection: DbConnectionSummary) => void;
  onSave: (input: DbConnectionInput) => Promise<DbConnectionSummary>;
}

const DEFAULT_PORTS: Record<DbEngine, number> = {
  sqlserver: 1433,
  postgres: 5432,
};

export function ConnectionModal({
  connection,
  environments,
  repositories,
  onClose,
  onSaved,
  onSave,
}: ConnectionModalProps) {
  const [environment, setEnvironment] = useState(
    connection?.environment ?? environments[0]?.key ?? '',
  );
  const [engine, setEngine] = useState<DbEngine>(connection?.engine ?? 'sqlserver');
  const [host, setHost] = useState(connection?.host ?? 'localhost');
  const [port, setPort] = useState(
    connection?.port ?? DEFAULT_PORTS[connection?.engine ?? 'sqlserver'],
  );
  const [databaseName, setDatabaseName] = useState(connection?.databaseName ?? '');
  const [username, setUsername] = useState(connection?.username ?? '');
  const [password, setPassword] = useState('');
  const [sslMode, setSslMode] = useState(connection?.sslMode ?? 'require');
  const [repositoryId, setRepositoryId] = useState(connection?.repositoryId ?? '');
  const [isActive, setIsActive] = useState(connection?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const canSubmit = useMemo(
    () =>
      Boolean(environment && host.trim() && databaseName.trim() && username.trim()) &&
      port > 0 &&
      (Boolean(connection) || Boolean(password)),
    [
      environment,
      host,
      databaseName,
      username,
      port,
      connection,
      password,
    ],
  );

  function changeEngine(next: DbEngine) {
    setEngine(next);
    if (!connection) setPort(DEFAULT_PORTS[next]);
  }

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await onSave({
        id: connection?.id,
        repositoryId: repositoryId || null,
        environment,
        engine,
        host: host.trim(),
        port,
        databaseName: databaseName.trim(),
        username: username.trim(),
        password: password || undefined,
        sslMode,
        isActive,
      });
      onSaved(saved);
    } catch (caught) {
      setError(normalizeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={connection ? 'Editar conexión' : 'Nueva conexión de base de datos'}
      description="La contraseña se cifra con DPAPI y nunca se devuelve al frontend."
      size="md"
      icon={<Icon name="database" size={20} />}
      onClose={busy ? () => undefined : onClose}
      closeOnBackdrop={!busy}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void submit()}
            disabled={busy || !canSubmit}
          >
            {busy ? <Spinner size="sm" /> : <Icon name="check" size={14} />}
            {busy ? 'Guardando…' : 'Guardar conexión'}
          </button>
        </>
      }
    >
      <div className="db-form">
        <div className="db-form-grid">
          <div className="field">
            <label className="field-label" htmlFor="db-repo">Repositorio</label>
            <select
              id="db-repo"
              className="input"
              value={repositoryId}
              onChange={(event) => setRepositoryId(event.target.value)}
              disabled={busy}
              autoComplete="off"
            >
              <option value="">Global (todos los repositorios)</option>
              {repositories.map((repository) => (
                <option key={repository.id} value={repository.id}>
                  {repository.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="db-env">Ambiente</label>
            <select
              id="db-env"
              className="input"
              value={environment}
              onChange={(event) => setEnvironment(event.target.value)}
              disabled={busy}
              autoComplete="off"
            >
              {environments.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label} · {item.key}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="db-engine">Motor</label>
            <select
              id="db-engine"
              className="input"
              value={engine}
              onChange={(event) => changeEngine(event.target.value as DbEngine)}
              disabled={busy}
              autoComplete="off"
            >
              <option value="sqlserver">SQL Server</option>
              <option value="postgres">PostgreSQL</option>
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="db-ssl">SSL</label>
            <select
              id="db-ssl"
              className="input"
              value={sslMode}
              onChange={(event) => setSslMode(event.target.value)}
              disabled={busy}
              autoComplete="off"
            >
              <option value="require">Requerido</option>
              <option value="trust">Requerido, confiar en certificado</option>
              <option value="disable">Deshabilitado</option>
            </select>
          </div>
        </div>

        <div className="db-form-grid db-form-grid-host">
          <div className="field">
            <label className="field-label" htmlFor="db-host">Host</label>
            <input
              id="db-host"
              className="input"
              value={host}
              onChange={(event) => setHost(event.target.value)}
              disabled={busy}
              autoComplete="off"
            />
          </div>
          <div className="field db-port-field">
            <label className="field-label" htmlFor="db-port">Puerto</label>
            <input
              id="db-port"
              className="input"
              type="number"
              min={1}
              max={65535}
              value={port}
              onChange={(event) => setPort(Number(event.target.value))}
              disabled={busy}
            />
          </div>
          <div className="field db-database-field">
            <label className="field-label" htmlFor="db-name">Base de datos</label>
            <input
              id="db-name"
              className="input"
              value={databaseName}
              onChange={(event) => setDatabaseName(event.target.value)}
              disabled={busy}
              autoComplete="off"
            />
          </div>
        </div>

        <div className="db-form-grid">
          <div className="field">
            <label className="field-label" htmlFor="db-user">Usuario</label>
            <input
              id="db-user"
              className="input"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              disabled={busy}
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="db-password">
              Contraseña {connection ? '(dejar vacío para conservar)' : ''}
            </label>
            <input
              id="db-password"
              className="input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy}
              autoComplete="new-password"
            />
          </div>
        </div>

        <label className="checkbox-row checkbox-row-compact">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
            disabled={busy}
          />
          <span>Con conexión activa</span>
        </label>

        {error ? (
          <Callout tone="danger" title="No se pudo guardar">
            {error.message}
          </Callout>
        ) : null}
      </div>
    </Modal>
  );
}
