import { buildChecklist, setupProgress } from '../lib/setup';
import { CURRENT_PHASE, NEXT_PHASE, PHASE_INFO } from '../lib/phases';
import type { ApiError, SystemInfo } from '../types';
import { SetupChecklist } from '../components/onboarding/SetupChecklist';
import { SystemPanel } from '../components/onboarding/SystemPanel';
import { Callout } from '../components/ui/Callout';
import { EmptyState } from '../components/ui/EmptyState';
import { Icon } from '../components/ui/Icon';
import { Spinner } from '../components/ui/Spinner';
import { StatusChip } from '../components/ui/StatusChip';

interface HomeViewProps {
  info: SystemInfo | null;
  error: ApiError | null;
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onOpenGuide: () => void;
  onOpenSettings: () => void;
  onOpenRepositories: () => void;
  onOpenRequirements: () => void;
  onOpenPhase: (phase: string) => void;
  onCopy: (value: string, label: string) => void;
  onOpenDir: (
    kind: 'data' | 'logs' | 'backups' | 'worktrees',
    label: string,
  ) => void;
}

export function HomeView({
  info,
  error,
  loading,
  refreshing,
  onRefresh,
  onOpenGuide,
  onOpenSettings,
  onOpenRepositories,
  onOpenRequirements,
  onOpenPhase,
  onCopy,
  onOpenDir,
}: HomeViewProps) {
  if (!info && error) {
    return (
      <div className="surface">
        <EmptyState
          icon={<Icon name="alert" size={26} />}
          title="No pudimos leer el diagnóstico"
          description={error.message}
          action={
            <button type="button" className="btn btn-primary" onClick={onRefresh}>
              <Icon name="refresh" size={14} />
              Reintentar
            </button>
          }
        />
      </div>
    );
  }

  if (!info) {
    return (
      <div className="surface loading-panel">
        <Spinner size="lg" label={loading ? 'Preparando FlowManager…' : 'Cargando…'} />
        <p className="loading-hint">Verificando Git y la base local.</p>
      </div>
    );
  }

  const checklist = buildChecklist(info);
  const progress = setupProgress(info.setup);
  const ready = info.setup.gitOk && info.setup.databaseOk;

  return (
    <div className="home">
      <section className="welcome-hero">
        <div className="welcome-copy">
          <div className="hero-kicker">
            <Icon name="sparkles" size={13} />
            
          </div>
          <h2 className="hero-title">
            Tu centro de mando para desplegar con calma.
          </h2>
          <p className="hero-text">
            FlowManager reúne requerimientos de Monday y manuales, ramas y
            scripts para que cada despliegue sea trazable, reversible y sin
            sorpresas en los ambientes.
          </p>
          <div className="hero-actions">
            <button type="button" className="btn btn-primary" onClick={onOpenRequirements}>
              <Icon name="list" size={15} />
              Cargar requerimientos
            </button>
            <button type="button" className="btn btn-secondary" onClick={onOpenRepositories}>
              <Icon name="branch" size={15} />
              Repositorios
            </button>
          </div>
          <p className="hero-footnote">
            <Icon name="shield" size={13} />
            Nunca se hace push ni merge sobre las ramas de ambiente.
          </p>
        </div>

        <div className="hero-progress">
          <div className="hero-progress-head">
            <span className="hero-progress-label">Configuración inicial</span>
            <strong className="hero-progress-value">
              {info.setup.completedSteps} de {info.setup.totalSteps}
            </strong>
          </div>
          <div
            className="progress-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
            aria-label="Progreso de configuración inicial"
          >
            <span className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <p className="hero-progress-hint">
            {!ready
              ? 'Hay algo pendiente en el entorno. Lo revisamos juntos antes de continuar.'
              : info.setup.repositoriesOk && !info.setup.requirementsOk
                ? 'Los repositorios están listos. Importa Monday o registra un manual.'
                : info.setup.requirementsOk
                  ? 'Los requerimientos están cargados. El siguiente paso es crear ramas y analizar commits.'
                  : 'El entorno está listo. Conecta tu primer repositorio para continuar.'}
          </p>
          <div className="hero-progress-chips">
            <StatusChip tone={info.git.available ? 'success' : 'danger'} dot>
              Git
            </StatusChip>
            <StatusChip tone={info.dbReady ? 'success' : 'danger'} dot>
              Base local
            </StatusChip>
            <StatusChip
              tone={info.demo ? 'info' : 'neutral'}
              dot={info.demo}
            >
              {info.demo ? 'Vista previa' : `SQLite v${info.schemaVersion ?? '—'}`}
            </StatusChip>
          </div>
        </div>
      </section>

      {info.demo ? (
        <Callout tone="info" title="Estás viendo la vista previa web" icon="eye">
          Los datos son de ejemplo. Abre la app de escritorio con{' '}
          <code>npm run tauri dev</code> para leer tu entorno real.
        </Callout>
      ) : null}

      {!info.git.available ? (
        <Callout
          tone="warning"
          title="Git no está disponible"
          action={
            <button type="button" className="btn btn-secondary btn-sm" onClick={onOpenGuide}>
              Ver guía
            </button>
          }
        >
          FlowManager necesita Git en el PATH. Instálalo desde git-scm.com,
          cierra y vuelve a abrir la app. Detalle: {info.git.message ?? 'sin detalle'}.
        </Callout>
      ) : null}

      {!info.dbReady ? (
        <Callout
          tone="danger"
          title="La base local no pudo abrirse"
          action={
            <button type="button" className="btn btn-secondary btn-sm" onClick={onOpenSettings}>
              Ver rutas
            </button>
          }
        >
          {info.dbError ?? 'Revisa los permisos de la carpeta de datos y vuelve a intentar.'}
        </Callout>
      ) : null}

      <div className="home-grid">
        <SetupChecklist
          items={checklist}
          onOpenDiagnostics={onOpenSettings}
          onOpenRepositories={onOpenRepositories}
          onOpenRequirements={onOpenRequirements}
          onOpenPhase={onOpenPhase}
        />

        <SystemPanel
          info={info}
          refreshing={refreshing}
          onCopy={onCopy}
          onOpenDir={onOpenDir}
          onRefresh={onRefresh}
        />
      </div>

      <section className="next-milestone">
        <div className="next-milestone-icon">
          <Icon name="rocket" size={20} />
        </div>
        <div className="next-milestone-body">
          <div className="next-milestone-head">
            <h2>Siguiente hito: {PHASE_INFO[NEXT_PHASE].title}</h2>
          </div>
          <p>
            Cada merge en GitHub se refleja como QAS 3/3, con reanudación de lotes
            y reintentos desde una sola pantalla.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => onOpenPhase(NEXT_PHASE)}
        >
          Ver
          <Icon name="arrow-right" size={14} />
        </button>
      </section>
    </div>
  );
}
