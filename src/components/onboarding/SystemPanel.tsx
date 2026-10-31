import { formatBytes, formatDateTime, gitVersionLabel, truncateMiddle } from '../../lib/format';
import type { SystemInfo } from '../../types';
import { Icon } from '../ui/Icon';
import { StatusChip } from '../ui/StatusChip';

interface SystemPanelProps {
  info: SystemInfo;
  refreshing: boolean;
  onCopy: (value: string, label: string) => void;
  onOpenDir: (
    kind: 'data' | 'logs' | 'backups' | 'worktrees',
    label: string,
  ) => void;
  onRefresh: () => void;
}

export function SystemPanel({
  info,
  refreshing,
  onCopy,
  onOpenDir,
  onRefresh,
}: SystemPanelProps) {
  const gitTone = info.git.available ? 'success' : 'danger';
  const dbTone = info.dbReady ? 'success' : 'danger';

  return (
    <aside className="surface system-panel" aria-labelledby="system-title">
      <header className="surface-header">
        <div>
          <h2 id="system-title" className="surface-title">
            Estado del sistema
          </h2>
          <p className="surface-subtitle">Una foto rápida de las fundaciones.</p>
        </div>
        <button
          type="button"
          className="btn btn-icon btn-ghost"
          aria-label="Actualizar diagnóstico"
          title="Actualizar diagnóstico"
          onClick={onRefresh}
          disabled={refreshing}
        >
          <Icon name="refresh" size={15} />
        </button>
      </header>

      <div className="system-rows">
        <div className="system-row">
          <span className="system-row-icon">
            <Icon name="terminal" size={15} />
          </span>
          <div className="system-row-main">
            <span className="system-row-label">Git</span>
            <span className="system-row-value" title={info.git.version ?? info.git.message ?? ''}>
              {info.git.available ? gitVersionLabel(info.git.version) : 'No disponible'}
            </span>
          </div>
          <StatusChip tone={gitTone}>{info.git.available ? 'OK' : 'Falta'}</StatusChip>
        </div>

        <div className="system-row">
          <span className="system-row-icon">
            <Icon name="database" size={15} />
          </span>
          <div className="system-row-main">
            <span className="system-row-label">Base local</span>
            <span className="system-row-value">
              {info.dbReady
                ? `SQLite · esquema v${info.schemaVersion ?? '—'} · ${formatBytes(info.dbSizeBytes)}`
                : info.dbError ?? 'No disponible'}
            </span>
          </div>
          <StatusChip tone={dbTone}>{info.dbReady ? 'OK' : 'Error'}</StatusChip>
        </div>

        <div className="system-mini-grid">
          <div className="system-mini">
            <span className="system-mini-value">{info.counts.repositories}</span>
            <span className="system-mini-label">Repositorios</span>
          </div>
          <div className="system-mini">
            <span className="system-mini-value">{info.counts.requirements}</span>
            <span className="system-mini-label">Requerimientos</span>
          </div>
          <div className="system-mini">
            <span className="system-mini-value">{info.counts.databaseConnections}</span>
            <span className="system-mini-label">Conexiones BD</span>
          </div>
          <div className="system-mini">
            <span className="system-mini-value">{info.counts.activeRuns}</span>
            <span className="system-mini-label">Runs activos</span>
          </div>
        </div>

        <div className="system-path">
          <div className="system-path-head">
            <span className="system-row-label">Carpeta de datos</span>
            <div className="system-path-actions">
              <button
                type="button"
                className="btn btn-icon btn-ghost btn-xs"
                aria-label="Copiar ruta de datos"
                title="Copiar ruta"
                onClick={() => onCopy(info.dataDir, 'Ruta de datos')}
              >
                <Icon name="copy" size={13} />
              </button>
              <button
                type="button"
                className="btn btn-icon btn-ghost btn-xs"
                aria-label="Abrir carpeta de datos"
                title="Abrir carpeta"
                onClick={() => onOpenDir('data', 'carpeta de datos')}
              >
                <Icon name="folder" size={13} />
              </button>
            </div>
          </div>
          <code className="system-path-value" title={info.dataDir}>
            {truncateMiddle(info.dataDir, 48)}
          </code>
        </div>
      </div>

      <footer className="system-footer">
        <Icon name="clock" size={12} />
        Sesión iniciada {formatDateTime(info.startedAt)}
      </footer>
    </aside>
  );
}
