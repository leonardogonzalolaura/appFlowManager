import { useState } from 'react';
import { isTauri, normalizeError } from '../lib/api';
import { formatDateTime, shortSha, truncateMiddle, withAlpha } from '../lib/format';
import {
  detectEnvironments,
  fetchRepository,
  openRepositoryFolder,
  removeRepository,
  setEnvironment,
} from '../lib/repositories';
import type { EnvironmentState, RepositoryDetail, RepositorySummary } from '../types';
import { useRepositories } from '../hooks/useRepositories';
import { BranchPickerModal } from '../components/repositories/BranchPickerModal';
import { EditRepositoryModal } from '../components/repositories/EditRepositoryModal';
import { EnvironmentsModal } from '../components/repositories/EnvironmentsModal';
import { RepositorySelectorModal } from '../components/repositories/RepositorySelectorModal';
import { Callout } from '../components/ui/Callout';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { EmptyState } from '../components/ui/EmptyState';
import { Icon } from '../components/ui/Icon';
import { Spinner } from '../components/ui/Spinner';
import { StatusChip } from '../components/ui/StatusChip';
import { toast } from '../components/ui/Toast';
import '../repositories.css';

export function RepositoriesView() {
  const {
    items,
    detail,
    selectedId,
    loading,
    detailLoading,
    error,
    detailError,
    refresh,
    select,
    applyDetail,
    removeLocal,
  } = useRepositories();

  const [selectorOpen, setSelectorOpen] = useState(false);
  const [selectorMode, setSelectorMode] = useState<'selector' | 'add' | 'clone'>('selector');
  const [editOpen, setEditOpen] = useState(false);
  const [branchEnvironment, setBranchEnvironment] = useState<EnvironmentState | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [environmentsOpen, setEnvironmentsOpen] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [resettingEnvironment, setResettingEnvironment] = useState<string | null>(null);
  const demo = !isTauri();

  function reportError(caught: unknown, title: string) {
    const apiError = normalizeError(caught);
    const description =
      apiError.code === 'GIT_AUTH'
        ? 'Git necesita credenciales. Configura el credential helper de Windows y vuelve a intentar.'
        : apiError.message;
    toast.error(title, { description });
  }

  async function handleFetch() {
    if (!detail) return;
    setFetching(true);
    try {
      const result = await fetchRepository(detail.id);
      applyDetail(result.repository);
      toast.success('Repositorio actualizado', {
        description: result.message,
      });
    } catch (caught) {
      reportError(caught, 'No se pudo actualizar el repositorio');
    } finally {
      setFetching(false);
    }
  }

  async function handleDetect() {
    if (!detail) return;
    setDetecting(true);
    try {
      const updated = await detectEnvironments(detail.id);
      applyDetail(updated);
      toast.success('Detección actualizada', {
        description: `${updated.configuredCount} de ${updated.environments.length} ambientes tienen rama.`,
      });
    } catch (caught) {
      reportError(caught, 'No se pudo detectar los ambientes');
    } finally {
      setDetecting(false);
    }
  }

  async function handleResetAuto(environment: EnvironmentState) {
    if (!detail) return;
    setResettingEnvironment(environment.environment);
    try {
      const updated = await setEnvironment({
        repositoryId: detail.id,
        environment: environment.environment,
        mode: 'auto',
      });
      applyDetail(updated);
      toast.success(`${environment.label} vuelve a detección automática`);
    } catch (caught) {
      reportError(caught, `No se pudo actualizar ${environment.label}`);
    } finally {
      setResettingEnvironment(null);
    }
  }

  async function handleRemove() {
    if (!detail) return;
    setRemoving(true);
    try {
      await removeRepository(detail.id);
      removeLocal(detail.id);
      setRemoveOpen(false);
      toast.success('Repositorio quitado de FlowManager', {
        description: 'Tu carpeta local y el historial se conservaron.',
      });
    } catch (caught) {
      reportError(caught, 'No se pudo quitar el repositorio');
    } finally {
      setRemoving(false);
    }
  }

  async function handleOpenFolder() {
    if (!detail) return;
    try {
      const path = await openRepositoryFolder(detail.id);
      toast.info('Abriendo carpeta', { description: truncateMiddle(path, 60) });
    } catch (caught) {
      reportError(caught, 'No se pudo abrir la carpeta');
    }
  }

  function handleCreated(repository: RepositoryDetail) {
    setSelectorOpen(false);
    applyDetail(repository);
    toast.success('Repositorio agregado', {
      description: `${repository.configuredCount} de ${repository.environments.length} ambientes detectados automáticamente.`,
    });
  }

  if (loading && items.length === 0) {
    return (
      <div className="surface loading-panel">
        <Spinner size="lg" label="Leyendo repositorios…" />
        <p className="loading-hint">Revisando rutas y ramas configuradas.</p>
      </div>
    );
  }

  if (error && items.length === 0) {
    return (
      <div className="surface">
        <EmptyState
          icon={<Icon name="alert" size={26} />}
          title="No pudimos leer los repositorios"
          description={error.message}
          action={
            <button type="button" className="btn btn-primary" onClick={() => void refresh()}>
              <Icon name="refresh" size={14} />
              Reintentar
            </button>
          }
        />
      </div>
    );
  }

  return (
    <>
      <div className="repositories">
        {items.length === 0 ? (
          <RepositoryOnboarding
            demo={demo}
            onAdd={() => {
              setSelectorMode('add');
              setSelectorOpen(true);
            }}
            onClone={() => {
              setSelectorMode('clone');
              setSelectorOpen(true);
            }}
          />
        ) : (
          <section className="repo-detail-area" aria-live="polite">
              {detailLoading && !detail ? (
                <div className="surface loading-panel">
                  <Spinner size="md" label="Leyendo ramas…" />
                </div>
              ) : detail ? (
                <RepositoryDetailPanel
                  repository={detail}
                  fetching={fetching}
                  detecting={detecting}
                  resettingEnvironment={resettingEnvironment}
                  repositoriesCount={items.length}
                  onFetch={() => void handleFetch()}
                  onDetect={() => void handleDetect()}
                  onOpenFolder={() => void handleOpenFolder()}
                  onEdit={() => setEditOpen(true)}
                  onRemove={() => setRemoveOpen(true)}
                  onChangeRepository={() => {
                    setSelectorMode('selector');
                    setSelectorOpen(true);
                  }}
                  onAddLocal={() => {
                    setSelectorMode('add');
                    setSelectorOpen(true);
                  }}
                  onClone={() => {
                    setSelectorMode('clone');
                    setSelectorOpen(true);
                  }}
                  onChangeEnvironment={setBranchEnvironment}
                  onResetAuto={(environment) => void handleResetAuto(environment)}
                  onManageEnvironments={() => setEnvironmentsOpen(true)}
                />
              ) : detailError ? (
                <div className="surface">
                  <EmptyState
                    icon={<Icon name="alert" size={26} />}
                    title="No pudimos leer este repositorio"
                    description={detailError.message}
                    action={
                      selectedId ? (
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => select(selectedId)}
                        >
                          <Icon name="refresh" size={14} />
                          Reintentar
                        </button>
                      ) : null
                    }
                  />
                </div>
              ) : items.length > 0 && selectedId ? (
                <div className="surface">
                  <EmptyState
                    icon={<Icon name="branch" size={26} />}
                    title="Repositorio no encontrado"
                    description="El repositorio seleccionado ya no está disponible."
                    action={
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => {
                          setSelectorMode('selector');
                          setSelectorOpen(true);
                        }}
                      >
                        <Icon name="list" size={14} />
                        Elegir otro repositorio
                      </button>
                    }
                  />
                </div>
              ) : items.length > 0 ? (
                <div className="surface">
                  <EmptyState
                    icon={<Icon name="list" size={26} />}
                    title="Elige un repositorio"
                    description="Selecciona uno de tus repositorios para ver su detalle."
                    action={
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => {
                          setSelectorMode('selector');
                          setSelectorOpen(true);
                        }}
                      >
                        <Icon name="list" size={14} />
                        Abrir selector
                      </button>
                    }
                  />
                </div>
              ) : null}
            </section>
          )}
        </div>

      {selectorOpen && (
        <RepositorySelectorModal
          open={selectorOpen}
          onClose={() => setSelectorOpen(false)}
          repositories={items}
          onSelect={(id) => {
            select(id);
            setSelectorOpen(false);
          }}
          onCreated={handleCreated}
          mode={selectorMode}
        />
      )}

      {editOpen && detail ? (
        <EditRepositoryModal
          repository={detail}
          onClose={() => setEditOpen(false)}
          onSaved={(updated) => {
            setEditOpen(false);
            applyDetail(updated);
            toast.success('Repositorio actualizado');
          }}
        />
      ) : null}

      {branchEnvironment && detail ? (
        <BranchPickerModal
          repository={detail}
          environment={branchEnvironment}
          onClose={() => setBranchEnvironment(null)}
          onSaved={(updated) => {
            setBranchEnvironment(null);
            applyDetail(updated);
            toast.success(`${branchEnvironment.label} actualizado`, {
              description: 'La rama se guardó correctamente.',
            });
          }}
        />
      ) : null}

      {removeOpen && detail ? (
        <ConfirmModal
          title="Quitar repositorio"
          message={`"${detail.name}" dejará de aparecer en FlowManager. No se borra tu carpeta local ni el historial de despliegues.`}
          confirmLabel="Quitar repositorio"
          tone="danger"
          busy={removing}
          onConfirm={() => void handleRemove()}
          onClose={() => setRemoveOpen(false)}
        />
      ) : null}

      {environmentsOpen ? (
        <EnvironmentsModal
          onClose={() => {
            setEnvironmentsOpen(false);
            void refresh();
          }}
          onChanged={() => void refresh()}
        />
      ) : null}
    </>
  );
}



// ─── Detalle ────────────────────────────────────────────────────────────────

interface RepositoryDetailPanelProps {
  repository: RepositoryDetail;
  fetching: boolean;
  detecting: boolean;
  resettingEnvironment: string | null;
  repositoriesCount: number;
  onFetch: () => void;
  onDetect: () => void;
  onOpenFolder: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onChangeRepository: () => void;
  onAddLocal: () => void;
  onClone: () => void;
  onChangeEnvironment: (environment: EnvironmentState) => void;
  onResetAuto: (environment: EnvironmentState) => void;
  onManageEnvironments: () => void;
}

function RepositoryDetailPanel({
  repository,
  fetching,
  detecting,
  resettingEnvironment,
  repositoriesCount,
  onFetch,
  onDetect,
  onOpenFolder,
  onEdit,
  onRemove,
  onChangeRepository,
  onAddLocal,
  onClone,
  onChangeEnvironment,
  onResetAuto,
  onManageEnvironments,
}: RepositoryDetailPanelProps) {
  return (
    <div className="repo-detail">
      <div className="repo-detail-header">
        <div className="repo-detail-header-info">
          <div className="repo-detail-header-title">
            <Icon name="branch" size={18} />
            <div>
              <h2>Repositorio actual</h2>
              <p className="repo-detail-header-subtitle">
                {repositoriesCount === 1
                  ? '1 repositorio conectado'
                  : `${repositoriesCount} repositorios conectados`}
              </p>
            </div>
          </div>
          <div className="repo-detail-header-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onChangeRepository}
            >
              <Icon name="list" size={14} />
              Cambiar repositorio
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onAddLocal}
            >
              <Icon name="folder" size={14} />
              Agregar local
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClone}
            >
              <Icon name="terminal" size={14} />
              Clonar
            </button>
          </div>
        </div>
      </div>

      <article className="surface repo-detail-head">
        <div className="repo-detail-title">
          <span className="repo-detail-avatar" aria-hidden="true">
            {repository.name.slice(0, 1).toUpperCase()}
          </span>
          <div className="repo-detail-title-copy">
            <div className="repo-title-row">
              <h2>{repository.name}</h2>
              <StatusChip tone="neutral">
                {repository.provider === 'github' ? 'GitHub' : 'Git'}
              </StatusChip>
              {repository.pathWarning ? (
                <StatusChip tone="warning">OneDrive</StatusChip>
              ) : null}
            </div>
            <p className="repo-remote" title={repository.remoteUrl ?? ''}>
              <Icon name="branch" size={13} />
              {repository.remoteUrl ?? 'Sin remoto configurado'}
            </p>
            <p className="repo-local-path" title={repository.localPath}>
              {repository.localPath}
            </p>
          </div>
        </div>

        <div className="repo-detail-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={onFetch}
            disabled={fetching || detecting}
          >
            {fetching ? <Spinner size="sm" /> : <Icon name="refresh" size={14} />}
            {fetching ? 'Actualizando…' : 'Actualizar'}
          </button>
          <button
            type="button"
            className="btn btn-icon btn-secondary"
            aria-label="Abrir carpeta del repositorio"
            title="Abrir carpeta"
            onClick={onOpenFolder}
          >
            <Icon name="folder" size={15} />
          </button>
          <button
            type="button"
            className="btn btn-icon btn-secondary"
            aria-label="Editar repositorio"
            title="Editar repositorio"
            onClick={onEdit}
          >
            <Icon name="settings" size={15} />
          </button>
          <button
            type="button"
            className="btn btn-icon btn-ghost repo-remove-btn"
            aria-label="Quitar repositorio"
            title="Quitar repositorio"
            onClick={onRemove}
          >
            <Icon name="trash" size={15} />
          </button>
        </div>
      </article>

      <div className="repo-stats" role="list" aria-label="Resumen del repositorio">
        <div className="repo-stat" role="listitem">
          <span className="repo-stat-label">
            <Icon name="branch" size={12} />
            Rama base
          </span>
          <code className="repo-stat-value">{repository.baseBranch}</code>
        </div>
        <div className="repo-stat" role="listitem">
          <span className="repo-stat-label">
            <Icon name="list" size={12} />
            Ramas
          </span>
          <strong className="repo-stat-value">{repository.branches.length}</strong>
        </div>
        <div className="repo-stat" role="listitem">
          <span className="repo-stat-label">
            <Icon name="layers" size={12} />
            Ambientes
          </span>
          <strong className="repo-stat-value">
            {repository.configuredCount}/{repository.environments.length}
          </strong>
        </div>
        <div className="repo-stat" role="listitem">
          <span className="repo-stat-label">
            <Icon name="clock" size={12} />
            Último fetch
          </span>
          <span className="repo-stat-value repo-stat-date">
            {repository.lastFetchedAt ? formatDateTime(repository.lastFetchedAt) : 'Nunca'}
          </span>
        </div>
      </div>

      {repository.warnings.length > 0 ? (
        <div className="repo-warnings">
          {repository.warnings.slice(0, 3).map((warning, index) => (
            <Callout
              key={`${index}-${warning.slice(0, 20)}`}
              tone={index === 0 ? 'warning' : 'info'}
              title={index === 0 ? 'Revisa esto' : 'Ten en cuenta'}
            >
              {warning}
            </Callout>
          ))}
        </div>
      ) : null}

      <section className="surface env-section" aria-labelledby="env-title">
        <header className="surface-header">
          <div>
            <h2 id="env-title" className="surface-title">
              Ambientes
            </h2>
            <p className="surface-subtitle">
              La rama que se usará como base para preparar cada despliegue.
            </p>
          </div>
          <div className="env-header-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onManageEnvironments}
            >
              <Icon name="layers" size={13} />
              Gestionar
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onDetect}
              disabled={detecting || fetching}
            >
              {detecting ? <Spinner size="sm" /> : <Icon name="sparkles" size={13} />}
              {detecting ? 'Detectando…' : 'Detectar de nuevo'}
            </button>
          </div>
        </header>

        <div className="env-list" role="list" aria-label="Matriz de ambientes">
          {repository.environments.map((environment) => (
            <article
              key={environment.environment}
              className={`env-card ${environment.available ? '' : 'is-missing'}`}
              role="listitem"
              style={
                environment.available
                  ? { borderLeftColor: withAlpha(environment.color, 0.55) }
                  : undefined
              }
            >
              <div className="env-card-main">
                <span
                  className="env-badge"
                  style={{
                    color: environment.color,
                    backgroundColor: withAlpha(environment.color, 0.12),
                    borderColor: withAlpha(environment.color, 0.35),
                  }}
                >
                  {environment.label}
                </span>

                <div className="env-card-branch">
                  {environment.branchName ? (
                    <code className="branch-name" title={environment.branchName}>
                      {environment.branchName}
                    </code>
                  ) : (
                    <span className="branch-missing">Sin configurar</span>
                  )}
                  {environment.usesBaseBranch ? (
                    <span className="env-mini-tag">base</span>
                  ) : null}
                  <StatusChip tone={environment.mode === 'auto' ? 'neutral' : 'info'}>
                    {environment.mode === 'auto' ? 'Auto' : 'Manual'}
                  </StatusChip>
                  {environment.ambiguous ? (
                    <StatusChip tone="warning">Ambigua</StatusChip>
                  ) : null}
                </div>

                <div className="env-card-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => onChangeEnvironment(environment)}
                  >
                    {environment.available ? 'Cambiar' : 'Elegir rama'}
                    <Icon name="chevron-right" size={12} />
                  </button>
                  {environment.mode === 'manual' ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      title="Volver a detección automática"
                      onClick={() => onResetAuto(environment)}
                      disabled={resettingEnvironment === environment.environment}
                    >
                      {resettingEnvironment === environment.environment ? (
                        <Spinner size="sm" />
                      ) : (
                        'Auto'
                      )}
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="env-card-evidence">
                <code className="env-sha" title={environment.sha ?? ''}>
                  {shortSha(environment.sha)}
                </code>
                <span className="env-note">{environment.note}</span>
              </div>

              {environment.warning ? (
                <div className="env-card-warning">
                  <Icon name="alert" size={12} />
                  <span>{environment.warning}</span>
                </div>
              ) : null}
            </article>
          ))}
        </div>

        <footer className="env-footer">
          <span className="env-footer-note">
            <Icon name="shield" size={13} />
            FlowManager nunca hace push ni merge sobre estas ramas.
          </span>
          <span className="env-footer-date">
            Detectado {repository.environments[0]?.resolvedAt
              ? formatDateTime(repository.environments[0].resolvedAt)
              : '—'}
          </span>
        </footer>
      </section>

      <footer className="repo-detail-footer">
        <span>
          <Icon name="clock" size={12} /> Agregado {formatDateTime(repository.createdAt)}
        </span>
        <span>
          <Icon name="branch" size={12} /> {repository.branches.length} ramas visibles
        </span>
      </footer>
    </div>
  );
}

// ─── Onboarding vacío ───────────────────────────────────────────────────────

interface RepositoryOnboardingProps {
  demo: boolean;
  onAdd: () => void;
  onClone: () => void;
}

function RepositoryOnboarding({ demo, onAdd, onClone }: RepositoryOnboardingProps) {
  return (
    <div className="repo-onboarding">
      <section className="repo-onboarding-hero">
        <span className="repo-onboarding-icon">
          <Icon name="branch" size={30} />
        </span>
        <div className="repo-onboarding-copy">
          <span className="hero-kicker">Fase 1 · Repositorios</span>
          <h2>Conecta tu primer repositorio</h2>
          <p>
            FlowManager leerá tus ramas, propondrá la rama de cada ambiente y te
            dejará ajustarla. Todo sin tocar el remoto.
          </p>
          <div className="hero-actions">
            <button type="button" className="btn btn-primary" onClick={onAdd}>
              <Icon name="folder" size={15} />
              Seleccionar carpeta
            </button>
            <button type="button" className="btn btn-secondary" onClick={onClone}>
              <Icon name="terminal" size={15} />
              Clonar desde URL
            </button>
          </div>
        </div>
      </section>

      {demo ? (
        <Callout tone="info" title="Vista previa web" icon="eye">
          En la vista previa verás un repositorio de ejemplo. Para agregar los tuyos,
          abre la app de escritorio.
        </Callout>
      ) : null}

      <div className="repo-onboarding-grid">
        <article className="onboarding-feature">
          <span className="onboarding-feature-icon">
            <Icon name="sparkles" size={17} />
          </span>
          <h3>Detección con evidencia</h3>
          <p>
            Alias, <code>release/*</code> y versión semántica. Siempre verás por qué se
            eligió cada rama.
          </p>
        </article>
        <article className="onboarding-feature">
          <span className="onboarding-feature-icon">
            <Icon name="settings" size={17} />
          </span>
          <h3>Override manual</h3>
          <p>
            Si la detección no coincide con tu realidad, eliges la rama y FlowManager
            la respeta.
          </p>
        </article>
        <article className="onboarding-feature">
          <span className="onboarding-feature-icon">
            <Icon name="shield" size={17} />
          </span>
          <h3>Ramas protegidas</h3>
          <p>
            DEV, QAS, UAT y PRD son de solo lectura para la app. Tu merge sigue siendo
            manual en GitHub.
          </p>
        </article>
      </div>

      <Callout tone="info" title="¿Qué pasa al agregar un repositorio?" icon="info">
        Solo se lee la ruta y sus ramas. No se ejecuta <code>git fetch</code>, no se
        crean ramas y no se modifica nada. Después pulsa <strong>Actualizar</strong>{' '}
        para traer lo último del remoto.
      </Callout>
    </div>
  );
}
