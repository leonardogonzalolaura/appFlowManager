import { useEffect, useMemo, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { normalizeError } from '../../lib/api';
import { executeDbScripts } from '../../lib/database';
import { formatDateTime } from '../../lib/format';
import type {
  ApiError,
  DbConnectionSummary,
  DbScriptExecutionResult,
  DbScriptSummary,
  EnvironmentDefinition,
} from '../../types';
import { Callout } from '../ui/Callout';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';
import { StatusChip } from '../ui/StatusChip';
import { toast } from '../ui/Toast';

interface ExecuteScriptsModalProps {
  scripts: DbScriptSummary[];
  environments: EnvironmentDefinition[];
  connections: DbConnectionSummary[];
  onClose: () => void;
  onExecuted?: () => void;
}

export function ExecuteScriptsModal({
  scripts,
  environments,
  connections,
  onClose,
  onExecuted,
}: ExecuteScriptsModalProps) {
  const initialEnvironment =
    scripts.find((script) => script.environmentScope !== 'all')?.environmentScope ??
    environments[0]?.key ??
    '';
  const [environment, setEnvironment] = useState(initialEnvironment);
  const [connectionId, setConnectionId] = useState('');
  const [stopOnError, setStopOnError] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [prdText, setPrdText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [results, setResults] = useState<DbScriptExecutionResult[]>([]);

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    listen<DbScriptExecutionResult>('db-script-executed', (event) => {
      const payload = event.payload;
      setResults((current) =>
        current.some(
          (item) =>
            item.scriptId === payload.scriptId &&
            item.executedAt === payload.executedAt,
        )
          ? current
          : [...current, payload],
      );
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  const availableConnections = useMemo(
    () =>
      connections.filter(
        (connection) =>
          connection.environment === environment && connection.isActive,
      ),
    [connections, environment],
  );
  const selectedConnection = connectionId
    ? availableConnections.find((connection) => connection.id === connectionId)
    : undefined;
  const isPrd = environment === 'prd';
  const canExecute =
    scripts.length > 0 &&
    availableConnections.length > 0 &&
    (isPrd ? prdText.trim().toUpperCase() === 'PRD' : confirmed) &&
    !busy;

  async function execute() {
    if (!canExecute) return;
    setBusy(true);
    setError(null);
    setResults([]);
    try {
      const loaded = await executeDbScripts({
        scriptIds: scripts.map((script) => script.id),
        environment,
        connectionId: connectionId || undefined,
        stopOnError,
      });
      setResults(loaded);
      const failed = loaded.filter((result) => result.status === 'failed').length;
      if (failed > 0) {
        toast.error(`${failed} script(s) fallaron`, {
          description: 'Revisa la salida y corrige antes de volver a ejecutar.',
        });
      } else {
        toast.success('Scripts ejecutados', {
          description: `${loaded.filter((result) => result.status === 'success').length} correcto(s).`,
        });
      }
      onExecuted?.();
    } catch (caught) {
      setError(normalizeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Ejecutar scripts SQL"
      description={`${scripts.length} script(s) · ${environment.toUpperCase()}`}
      size="lg"
      icon={<Icon name="play" size={20} />}
      onClose={busy ? () => undefined : onClose}
      closeOnBackdrop={!busy}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            {results.length > 0 ? 'Cerrar' : 'Cancelar'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void execute()}
            disabled={!canExecute || results.length > 0}
          >
            {busy ? <Spinner size="sm" /> : <Icon name="play" size={14} />}
            {busy ? 'Ejecutando…' : `Ejecutar en ${environment}`}
          </button>
        </>
      }
    >
      <div className="db-execute">
        <div className="db-form-grid">
          <div className="field">
            <label className="field-label" htmlFor="exec-env">Ambiente</label>
            <select
              id="exec-env"
              className="input"
              value={environment}
              onChange={(event) => {
                setEnvironment(event.target.value);
                setConnectionId('');
                setConfirmed(false);
                setPrdText('');
                setResults([]);
              }}
              disabled={busy || results.length > 0}
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
            <label className="field-label" htmlFor="exec-connection">Conexión</label>
            <select
              id="exec-connection"
              className="input"
              value={connectionId}
              onChange={(event) => setConnectionId(event.target.value)}
              disabled={busy || results.length > 0}
              autoComplete="off"
            >
              <option value="">Automática (repo o global)</option>
              {availableConnections.map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {connection.repositoryName ?? 'Global'} · {connection.host}:{connection.port}
                </option>
              ))}
            </select>
          </div>
        </div>

        {selectedConnection ? (
          <div className="db-connection-preview">
            <Icon name="database" size={14} />
            <span>
              {selectedConnection.host}:{selectedConnection.port} /{' '}
              {selectedConnection.databaseName} · {selectedConnection.username}
            </span>
          </div>
        ) : null}

        {availableConnections.length === 0 ? (
          <Callout tone="danger" title="No hay conexión para este ambiente">
            Configura una conexión en la sección Bases de datos antes de ejecutar
            scripts en {environment}. La ejecución queda bloqueada.
          </Callout>
        ) : null}

        <div className="db-execute-list">
          {scripts.map((script, index) => (
            <div key={script.id} className="db-execute-item">
              <span className="db-sequence">{index + 1}</span>
              <span>
                <strong>{script.name}</strong>
                <small>
                  {script.repositoryName} ·{' '}
                  {script.engine === 'sqlserver' ? 'SQL Server' : 'PostgreSQL'} ·{' '}
                  {script.environmentScope === 'all'
                    ? 'todos los ambientes'
                    : script.environmentScope}
                </small>
              </span>
              <code>{script.checksum.slice(0, 8)}</code>
            </div>
          ))}
        </div>

        {results.length === 0 ? (
          <>
            <label className="checkbox-row checkbox-row-compact">
              <input
                type="checkbox"
                checked={stopOnError}
                onChange={(event) => setStopOnError(event.target.checked)}
                disabled={busy}
              />
              <span>Detenerse en el primer error</span>
            </label>

            {isPrd ? (
              <div className="field">
                <label className="field-label" htmlFor="exec-prd">
                  Escribe PRD para confirmar la ejecución en producción
                </label>
                <input
                  id="exec-prd"
                  className="input"
                  value={prdText}
                  onChange={(event) => setPrdText(event.target.value)}
                  disabled={busy}
                  autoComplete="off"
                />
              </div>
            ) : (
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  disabled={busy}
                />
                <span>
                  Confirmo ejecutar {scripts.length} script(s) en{' '}
                  <strong>{environment}</strong>. Esta acción modifica la base de datos.
                </span>
              </label>
            )}
          </>
        ) : null}

        {error ? (
          <Callout tone="danger" title="No se pudo ejecutar">
            {error.message}
          </Callout>
        ) : null}

        {results.length > 0 ? (
          <div className="db-results">
            {results.map((result) => (
              <div key={`${result.scriptId}-${result.executedAt}`} className="db-result">
                <div className="db-result-head">
                  <strong>{result.scriptName}</strong>
                  <StatusChip
                    tone={
                      result.status === 'success'
                        ? 'success'
                        : result.status === 'failed'
                          ? 'danger'
                          : 'neutral'
                    }
                  >
                    {result.status === 'success'
                      ? 'Correcto'
                      : result.status === 'failed'
                        ? 'Falló'
                        : 'Omitido'}
                  </StatusChip>
                  <span>{result.durationMs} ms</span>
                </div>
                {result.output ? <pre>{result.output}</pre> : null}
                {result.error ? <pre className="db-result-error">{result.error}</pre> : null}
                <small>{formatDateTime(result.executedAt)}</small>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
