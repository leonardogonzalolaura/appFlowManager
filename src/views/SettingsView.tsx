import { useState } from 'react';
import { formatBytes, formatDateTime, gitVersionLabel } from '../lib/format';
import type { SystemInfo } from '../types';
import { EnvironmentsModal } from '../components/repositories/EnvironmentsModal';
import { Callout } from '../components/ui/Callout';
import { Icon } from '../components/ui/Icon';
import { Spinner } from '../components/ui/Spinner';
import { StatusChip } from '../components/ui/StatusChip';

interface SettingsViewProps {
  info: SystemInfo;
  refreshing: boolean;
  onRefresh: () => void;
  onCopy: (value: string, label: string) => void;
  onOpenDir: (
    kind: 'data' | 'logs' | 'backups' | 'worktrees',
    label: string,
  ) => void;
}

export function SettingsView({
  info,
  refreshing,
  onRefresh,
  onCopy,
  onOpenDir,
}: SettingsViewProps) {
  const [showDetails, setShowDetails] = useState(false);
  const [environmentsOpen, setEnvironmentsOpen] = useState(false);

  return (
    <div className="settings">
      <section className="surface">
        <header className="surface-header">
          <div>
            <h2 className="surface-title">Diagnóstico</h2>
            <p className="surface-subtitle">
              Lo que FlowManager encontró al iniciar. Puedes actualizarlo sin
              reiniciar la app.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onRefresh}
            disabled={refreshing}
          >
            {refreshing ? <Spinner size="sm" /> : <Icon name="refresh" size={14} />}
            {refreshing ? 'Actualizando…' : 'Actualizar'}
          </button>
        </header>

        <div className="diagnostic-grid">
          <DiagnosticCard
            icon="terminal"
            label="Git"
            value={info.git.available ? gitVersionLabel(info.git.version) : 'No detectado'}
            tone={info.git.available ? 'success' : 'danger'}
            status={info.git.available ? 'Disponible' : 'Falta'}
          />
          <DiagnosticCard
            icon="database"
            label="Base local"
            value={
              info.dbReady
                ? `${formatBytes(info.dbSizeBytes)} · esquema v${info.schemaVersion ?? '—'}`
                : 'Sin conexión'
            }
            tone={info.dbReady ? 'success' : 'danger'}
            status={info.dbReady ? 'Disponible' : 'Error'}
          />
          <DiagnosticCard
            icon="layers"
            label="Datos"
            value={`${info.counts.repositories} repos · ${info.counts.requirements} requerimientos`}
            tone="neutral"
            status="En memoria"
          />
          <DiagnosticCard
            icon="clock"
            label="Sesión"
            value={formatDateTime(info.startedAt)}
            tone="neutral"
            status={`v${info.appVersion}`}
          />
        </div>

        {!info.dbReady && info.dbError ? (
          <div className="settings-inline-callout">
            <Callout tone="danger" title="Detalle del error de base de datos">
              {info.dbError}
            </Callout>
          </div>
        ) : null}

        {!info.git.available ? (
          <div className="settings-inline-callout">
            <Callout tone="warning" title="Git no está en el PATH">
              Instala Git para Windows y reinicia la app. FlowManager lo usa para
              leer ramas y preparar los despliegues.
            </Callout>
          </div>
        ) : null}
      </section>

      <section className="surface">
        <header className="surface-header">
          <div>
            <h2 className="surface-title">Rutas de la aplicación</h2>
            <p className="surface-subtitle">
              La base y los logs viven en AppData. Los worktrees van a
              LocalAppData para no sincronizarse con OneDrive.
            </p>
          </div>
        </header>

        <div className="path-list">
          <PathRow
            label="Carpeta de datos"
            path={info.dataDir}
            onCopy={onCopy}
            onOpen={() => onOpenDir('data', 'carpeta de datos')}
          />
          <PathRow
            label="Base de datos"
            path={info.dbPath}
            onCopy={onCopy}
            onOpen={() => onOpenDir('data', 'carpeta de datos')}
          />
          <PathRow
            label="Logs"
            path={info.logsDir}
            onCopy={onCopy}
            onOpen={() => onOpenDir('logs', 'carpeta de logs')}
          />
          <PathRow
            label="Respaldos"
            path={info.backupsDir}
            onCopy={onCopy}
            onOpen={() => onOpenDir('backups', 'carpeta de respaldos')}
          />
          <PathRow
            label="Worktrees"
            path={info.worktreesDir}
            onCopy={onCopy}
            onOpen={() => onOpenDir('worktrees', 'carpeta de worktrees')}
          />
        </div>
      </section>

      <section className="surface">
        <header className="surface-header">
          <div>
            <h2 className="surface-title">Ambientes</h2>
            <p className="surface-subtitle">
              Catálogo global de DEV, QAS, STAGE, UAT, PRD y los ambientes que agregues.
              Cada repositorio resuelve su propia rama.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setEnvironmentsOpen(true)}
          >
            <Icon name="layers" size={14} />
            Gestionar ambientes
          </button>
        </header>
        <div className="settings-actions">
          <span className="settings-inline-hint">
            Los ambientes personalizados también son ramas protegidas: FlowManager
            nunca hace push sobre ellas.
          </span>
        </div>
      </section>

      <section className="surface">
        <header className="surface-header">
          <div>
            <h2 className="surface-title">Preferencias iniciales</h2>
            <p className="surface-subtitle">
              Estos valores se podrán editar en las siguientes fases.
            </p>
          </div>
          
        </header>

        <div className="preference-list">
          <PreferenceRow
            label="Rama base por defecto"
            value="master"
            hint="Cada repositorio puede sobrescribirla en la pantalla Repositorios."
          />
          <PreferenceRow
            label="Prefijo de requerimientos manuales"
            value="MAN-0001"
            hint="La app genera la siguiente key disponible."
          />
          <PreferenceRow
            label="Rama de ambiente"
            value="Detección automática + override"
            hint="Se configura por repositorio en la Fase 1."
          />
          <PreferenceRow
            label="Secretos de base de datos"
            value="DPAPI (usuario de Windows)"
            hint="Nunca se envían al frontend ni se guardan en texto plano."
          />
        </div>
      </section>

      <section className="surface">
        <header className="surface-header">
          <div>
            <h2 className="surface-title">Registros y soporte</h2>
            <p className="surface-subtitle">
              Comparte el log si algo falla; no contiene contraseñas.
            </p>
          </div>
        </header>

        <div className="settings-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => onOpenDir('logs', 'carpeta de logs')}
          >
            <Icon name="file" size={14} />
            Abrir logs
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => onOpenDir('backups', 'carpeta de respaldos')}
          >
            <Icon name="database" size={14} />
            Abrir respaldos
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => onOpenDir('worktrees', 'carpeta de worktrees')}
          >
            <Icon name="branch" size={14} />
            Abrir worktrees
          </button>
        </div>

        <div className="settings-about">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setShowDetails((value) => !value)}
            aria-expanded={showDetails}
          >
            <Icon name="info" size={13} />
            {showDetails ? 'Ocultar detalles técnicos' : 'Ver detalles técnicos'}
          </button>
          {showDetails ? (
            <dl className="details-list">
              <div>
                <dt>Versión</dt>
                <dd>{info.appVersion}</dd>
              </div>
              <div>
                <dt>Sistema</dt>
                <dd>
                  {info.os} · {info.arch}
                </dd>
              </div>
              <div>
                <dt>Esquema SQLite</dt>
                <dd>v{info.schemaVersion ?? '—'}</dd>
              </div>
              <div>
                <dt>Inicio de sesión</dt>
                <dd>{formatDateTime(info.startedAt)}</dd>
              </div>
              <div>
                <dt>Modo</dt>
                <dd>{info.demo ? 'Vista previa web' : 'Aplicación de escritorio'}</dd>
              </div>
            </dl>
          ) : null}
        </div>
      </section>

      {environmentsOpen ? (
        <EnvironmentsModal
          onClose={() => setEnvironmentsOpen(false)}
          onChanged={() => undefined}
        />
      ) : null}
    </div>
  );
}

interface DiagnosticCardProps {
  icon: 'terminal' | 'database' | 'layers' | 'clock';
  label: string;
  value: string;
  status: string;
  tone: 'success' | 'danger' | 'neutral';
}

function DiagnosticCard({ icon, label, value, status, tone }: DiagnosticCardProps) {
  return (
    <div className="diagnostic-card">
      <div className="diagnostic-card-head">
        <span className="diagnostic-icon">
          <Icon name={icon} size={16} />
        </span>
        <span className="diagnostic-label">{label}</span>
        <StatusChip tone={tone}>{status}</StatusChip>
      </div>
      <p className="diagnostic-value" title={value}>
        {value}
      </p>
    </div>
  );
}

interface PathRowProps {
  label: string;
  path: string;
  onCopy: (value: string, label: string) => void;
  onOpen: () => void;
}

function PathRow({ label, path, onCopy, onOpen }: PathRowProps) {
  return (
    <div className="path-row">
      <div className="path-row-text">
        <span className="path-row-label">{label}</span>
        <code className="path-row-value" title={path}>
          {path}
        </code>
      </div>
      <div className="path-row-actions">
        <button
          type="button"
          className="btn btn-icon btn-ghost btn-sm"
          aria-label={`Copiar ruta de ${label}`}
          title="Copiar ruta"
          onClick={() => onCopy(path, label)}
        >
          <Icon name="copy" size={14} />
        </button>
        <button
          type="button"
          className="btn btn-icon btn-ghost btn-sm"
          aria-label={`Abrir ${label}`}
          title="Abrir carpeta"
          onClick={onOpen}
        >
          <Icon name="folder" size={14} />
        </button>
      </div>
    </div>
  );
}

interface PreferenceRowProps {
  label: string;
  value: string;
  hint: string;
}

function PreferenceRow({ label, value, hint }: PreferenceRowProps) {
  return (
    <div className="preference-row">
      <div>
        <span className="preference-label">{label}</span>
        <span className="preference-hint">{hint}</span>
      </div>
      <span className="preference-value">{value}</span>
    </div>
  );
}
