import { useCallback, useEffect, useMemo, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { normalizeError } from '../../lib/api';
import { copyText, formatDateTime, shortSha, truncateMiddle } from '../../lib/format';
import {
  applyDeployment,
  getDeploymentReport,
  prepareDeployment,
  previewDeployment,
  pushDeployment,
} from '../../lib/deployments';
import { listEnvironments } from '../../lib/repositories';
import {
  abortSquash,
  continueSquash,
  openSquashEditor,
  openSquashFolder,
  openSquashInTaruGit,
  refreshSquashConflicts,
  resolveSquashConflict,
  stageAllSquash,
  stageSquashFile,
} from '../../lib/squash';
import type {
  ApiError,
  DeploymentPreview,
  DeploymentReport,
  EnvironmentDefinition,
  SquashSession,
} from '../../types';
import { Callout } from '../ui/Callout';
import { ConfirmModal } from '../ui/ConfirmModal';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';
import { StatusChip } from '../ui/StatusChip';
import { toast } from '../ui/Toast';
import '../../squash.css';
import '../../deployment.css';

interface DeploymentWizardModalProps {
  requirementIds: string[];
  initialSessions?: SquashSession[];
  onClose: () => void;
  onChanged: () => void;
  onFinished?: () => void;
}

type BusyAction =
  | 'apply'
  | 'push'
  | 'stage'
  | 'resolve'
  | 'continue'
  | 'abort'
  | 'refresh';

export function DeploymentWizardModal({
  requirementIds,
  initialSessions,
  onClose,
  onChanged,
  onFinished,
}: DeploymentWizardModalProps) {
  const [environments, setEnvironments] = useState<EnvironmentDefinition[]>([]);
  const firstEnvironment =
    initialSessions?.find((session) => session.environment)?.environment ?? '';
  const [environment, setEnvironment] = useState(firstEnvironment);
  const [preview, setPreview] = useState<DeploymentPreview | null>(null);
  const [sessions, setSessions] = useState<SquashSession[]>(initialSessions ?? []);
  const [reports, setReports] = useState<Record<string, DeploymentReport>>({});
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [busy, setBusy] = useState<Record<string, BusyAction>>({});
  const [error, setError] = useState<ApiError | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [branchConflict, setBranchConflict] = useState<{
    session: SquashSession;
    branch: string;
  } | null>(null);

  useEffect(() => {
    let active = true;
    listEnvironments()
      .then((loaded) => {
        if (!active) return;
        setEnvironments(loaded);
        setEnvironment((current) => current || loaded[0]?.key || '');
      })
      .catch((caught) => {
        if (active) setError(normalizeError(caught));
      });
    return () => {
      active = false;
    };
  }, []);

  const loadPreview = useCallback(async (environmentKey: string) => {
    if (!environmentKey) {
      setPreview(null);
      return null;
    }
    setLoadingPreview(true);
    try {
      const loaded = await previewDeployment(requirementIds, environmentKey);
      setPreview(loaded);
      setError(null);
      return loaded;
    } catch (caught) {
      setPreview(null);
      setError(normalizeError(caught));
      return null;
    } finally {
      setLoadingPreview(false);
    }
  }, [requirementIds]);

  useEffect(() => {
    if (sessions.length > 0) return;
    void loadPreview(environment);
  }, [environment, loadPreview, sessions.length]);

  const blocked = useMemo(
    () => (preview?.repositories ?? []).filter((repo) => !repo.available),
    [preview],
  );
  const deployable = useMemo(
    () => (preview?.repositories ?? []).filter((repo) => repo.available),
    [preview],
  );
  const canPrepare =
    deployable.length > 0 && blocked.length === 0 && !loadingPreview && !preparing;

  const pendingPush = sessions.filter(
    (session) =>
      session.phase === 'deploy' &&
      session.status === 'ready' &&
      !session.pushedSha,
  );
  const pendingApply = sessions.filter(
    (session) => session.phase === 'squash' && session.status === 'ready',
  );
  const pushed = sessions.filter((session) => Boolean(session.pushedSha));
  const hasConflict = sessions.some((session) => session.status === 'conflict');

  const reportsKey = sessions
    .filter((session) => session.phase === 'deploy' && session.status !== 'aborted')
    .map((session) => `${session.id}:${session.deploySha ?? '-'}:${session.status}`)
    .join('|');

  useEffect(() => {
    const targets = sessions.filter(
      (session) => session.phase === 'deploy' && session.status !== 'aborted',
    );
    if (targets.length === 0) return;
    let active = true;
    void Promise.allSettled(
      targets.map(async (session) => {
        const report = await getDeploymentReport(session.id);
        return [session.id, report] as const;
      }),
    ).then((results) => {
      if (!active) return;
      setReports((current) => {
        const next = { ...current };
        for (const result of results) {
          if (result.status === 'fulfilled') {
            next[result.value[0]] = result.value[1];
          }
        }
        return next;
      });
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportsKey]);

  function updateSession(updated: SquashSession) {
    setSessions((current) =>
      current.map((session) => (session.id === updated.id ? updated : session)),
    );
  }

  function setSessionBusy(sessionId: string, action: BusyAction | null) {
    setBusy((current) => {
      const next = { ...current };
      if (action) next[sessionId] = action;
      else delete next[sessionId];
      return next;
    });
  }

  async function prepare() {
    if (!environment) return;
    setPreparing(true);
    setError(null);
    try {
      const created = await prepareDeployment(requirementIds, environment);
      setSessions(created);
      onChanged();
      const conflicts = created.filter((session) => session.status === 'conflict');
      if (conflicts.length > 0) {
        toast.warning('Despliegue preparado con conflictos', {
          description: `${conflicts.length} repositorio(s) necesitan resolución antes de crear la rama hija.`,
        });
      } else {
        toast.success('Cambios unificados', {
          description: `${created.length} repositorio(s) listos. Ahora crea la rama hija de cada uno.`,
        });
      }
    } catch (caught) {
      setError(normalizeError(caught));
    } finally {
      setPreparing(false);
    }
  }

  async function apply(
    session: SquashSession,
    replaceExisting = false,
  ): Promise<SquashSession | null> {
    setSessionBusy(session.id, 'apply');
    setError(null);
    try {
      const updated = await applyDeployment(session.id, replaceExisting);
      updateSession(updated);
      onChanged();
      if (updated.status === 'conflict') {
        toast.warning('Conflicto al crear la rama hija', {
          description: `${updated.repositoryName}: resuelve los archivos y continúa.`,
        });
      } else if (updated.status === 'no_changes') {
        toast.info('Sin cambios netos en el ambiente', {
          description: updated.repositoryName,
        });
      } else if (updated.status === 'ready') {
        toast.success('Rama hija creada', {
          description: `${updated.deployBranch ?? updated.repositoryName} ya existe en tu equipo. Ahora empújala.`,
        });
      }
      return updated;
    } catch (caught) {
      const apiError = normalizeError(caught);
      if (apiError.code === 'BRANCH_EXISTS_LOCAL' && !replaceExisting) {
        setBranchConflict({ session, branch: expectedDeployBranch(session) });
        return null;
      }
      setError(apiError);
      toast.error('No se pudo crear la rama hija', {
        description: apiError.message,
      });
      return null;
    } finally {
      setSessionBusy(session.id, null);
    }
  }

  async function push(session: SquashSession): Promise<SquashSession | null> {
    setSessionBusy(session.id, 'push');
    setError(null);
    try {
      const updated = await pushDeployment(session.id);
      updateSession(updated);
      onChanged();
      toast.success('Rama empujada', {
        description: `${updated.deployBranch} quedó en el remoto. El merge al ambiente sigue siendo manual.`,
      });
      return updated;
    } catch (caught) {
      setError(normalizeError(caught));
      toast.error('No se pudo empujar la rama', {
        description: normalizeError(caught).message,
      });
      return null;
    } finally {
      setSessionBusy(session.id, null);
    }
  }

  async function applyAll() {
    for (const session of pendingApply) {
      const updated = await apply(session);
      if (!updated || updated.status === 'conflict') break;
    }
  }

  async function pushAll() {
    for (const session of pendingPush) {
      const updated = await push(session);
      if (!updated) break;
    }
  }

  async function handleStage(session: SquashSession, file: string) {
    setSessionBusy(session.id, 'stage');
    try {
      updateSession(await stageSquashFile(session.id, file));
    } catch (caught) {
      toast.error('No se pudo agregar el archivo', {
        description: normalizeError(caught).message,
      });
    } finally {
      setSessionBusy(session.id, null);
    }
  }

  async function handleStageAll(session: SquashSession) {
    setSessionBusy(session.id, 'stage');
    try {
      updateSession(await stageAllSquash(session.id));
      toast.success('Archivos agregados');
    } catch (caught) {
      toast.error('No se pudieron agregar los archivos', {
        description: normalizeError(caught).message,
      });
    } finally {
      setSessionBusy(session.id, null);
    }
  }

  async function handleResolve(
    session: SquashSession,
    file: string,
    side: 'ours' | 'theirs',
  ) {
    setSessionBusy(session.id, 'resolve');
    try {
      updateSession(await resolveSquashConflict(session.id, file, side));
      toast.success(
        side === 'ours'
          ? 'Se mantuvo la versión del ambiente'
          : 'Se usó la versión del requerimiento',
        { description: file },
      );
    } catch (caught) {
      toast.error('No se pudo resolver el archivo', {
        description: normalizeError(caught).message,
      });
    } finally {
      setSessionBusy(session.id, null);
    }
  }

  async function handleContinue(session: SquashSession) {
    setSessionBusy(session.id, 'continue');
    try {
      const updated = await continueSquash(session.id);
      updateSession(updated);
      onChanged();
      if (updated.status === 'ready') {
        toast.success('Conflicto resuelto', {
          description:
            updated.phase === 'deploy'
              ? 'La rama hija quedó creada en tu equipo. El siguiente paso es empujarla.'
              : 'El squash quedó listo para crear la rama hija.',
        });
      }
    } catch (caught) {
      toast.error('No se pudo continuar', {
        description: normalizeError(caught).message,
      });
    } finally {
      setSessionBusy(session.id, null);
    }
  }

  async function handleRefresh(session: SquashSession) {
    setSessionBusy(session.id, 'refresh');
    try {
      updateSession(await refreshSquashConflicts(session.id));
    } catch (caught) {
      toast.error('No se pudo refrescar', {
        description: normalizeError(caught).message,
      });
    } finally {
      setSessionBusy(session.id, null);
    }
  }

  async function handleAbort(session: SquashSession) {
    setSessionBusy(session.id, 'abort');
    try {
      const updated = await abortSquash(session.id);
      updateSession(updated);
      onChanged();
      toast.success('Sesión descartada', {
        description:
          'Se limpió el worktree. La rama local se elimina si no está abierta en otra herramienta; la remota no se toca.',
      });
    } catch (caught) {
      toast.error('No se pudo descartar', {
        description: normalizeError(caught).message,
      });
    } finally {
      setSessionBusy(session.id, null);
    }
  }

  async function handleOpenEditor(session: SquashSession, file?: string) {
    try {
      await openSquashEditor(session.id, file);
    } catch (caught) {
      toast.error('No se pudo abrir VS Code', {
        description: normalizeError(caught).message,
      });
    }
  }

  async function handleOpenTaruGit(session: SquashSession) {
    try {
      await openSquashInTaruGit(session.id);
    } catch (caught) {
      toast.error('No se pudo abrir TaruGit', {
        description: normalizeError(caught).message,
      });
    }
  }

  async function handleOpenFolder(session: SquashSession) {
    try {
      await openSquashFolder(session.id);
    } catch (caught) {
      toast.error('No se pudo abrir la carpeta', {
        description: normalizeError(caught).message,
      });
    }
  }

  async function handleCopyPath(session: SquashSession) {
    try {
      await copyText(session.worktreePath);
      toast.success('Ruta copiada', { description: session.worktreePath });
    } catch (caught) {
      toast.error('No se pudo copiar la ruta', {
        description: normalizeError(caught).message,
      });
    }
  }

  async function restartPreparation() {
    for (const session of sessions) {
      if (!session.pushedSha && session.status !== 'aborted') {
        try {
          await abortSquash(session.id);
        } catch {
          // Si una sesión ya no existe, seguimos con las demás.
        }
      }
    }
    setSessions([]);
    setError(null);
    onChanged();
    await loadPreview(environment);
  }

  async function cancelDeployment() {
    setCancelling(true);
    let failed = 0;
    for (const session of sessions) {
      if (session.status === 'aborted') continue;
      try {
        await abortSquash(session.id);
      } catch {
        failed += 1;
      }
    }
    setCancelling(false);
    setConfirmCancel(false);
    onChanged();
    if (failed > 0) {
      toast.warning('Despliegue descartado parcialmente', {
        description: `${failed} sesión(es) no se pudieron limpiar. Revisa el detalle en Squash.`,
      });
    } else {
      toast.success('Despliegue descartado', {
        description:
          'Se limpiaron los worktrees. Las ramas locales se eliminan si no están en uso; las empujadas no se borran del remoto.',
      });
    }
    onClose();
  }

  const environmentLabel =
    preview?.environmentLabel ??
    environments.find((item) => item.key === environment)?.label ??
    sessions.find((session) => session.environment)?.environment ??
    environment;
  const activeEnvironments = Array.from(
    new Set(
      sessions
        .map((session) => session.environment)
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const scopeLabel =
    activeEnvironments.length > 1
      ? `${activeEnvironments.length} ambientes`
      : environmentLabel;
  const finished =
    sessions.length > 0 &&
    pushed.length === sessions.length &&
    sessions.every((session) => session.pushedSha);

  return (
    <Modal
      title="Preparar despliegue"
      description={
        sessions.length === 0
          ? `${requirementIds.length} requerimiento(s) seleccionados · elige el ambiente destino.`
          : `${scopeLabel} · ${sessions.length} repositorio(s)`
      }
      size="lg"
      icon={<Icon name="rocket" size={20} />}
      onClose={preparing ? () => undefined : onClose}
      closeOnBackdrop={!preparing}
      footer={
        sessions.length === 0 ? (
          <>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void prepare()}
              disabled={!canPrepare}
            >
              {preparing ? <Spinner size="sm" /> : <Icon name="package" size={14} />}
              {preparing ? 'Unificando cambios…' : 'Preparar despliegue'}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setConfirmCancel(true)}
              disabled={cancelling || Object.keys(busy).length > 0}
            >
              <Icon name="trash" size={14} />
              Cancelar despliegue
            </button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cerrar
            </button>
            {pendingApply.length > 0 ? (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void applyAll()}
                disabled={hasConflict || Object.keys(busy).length > 0}
              >
                <Icon name="branch" size={14} />
                Crear {pendingApply.length} rama(s) hija(s)
              </button>
            ) : null}
            {pendingPush.length > 0 ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void pushAll()}
                disabled={hasConflict || Object.keys(busy).length > 0}
              >
                <Icon name="rocket" size={14} />
                Empujar {pendingPush.length} rama(s)
              </button>
            ) : null}
            {pendingApply.length === 0 && pendingPush.length === 0 ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={onFinished ?? onClose}
              >
                <Icon name="check" size={14} />
                Listo
              </button>
            ) : null}
          </>
        )
      }
    >
      {sessions.length === 0 ? (
        <div className="deployment-setup">
          <div className="field">
            <label className="field-label" htmlFor="deployment-env">
              Ambiente destino
            </label>
            <select
              id="deployment-env"
              className="input"
              value={environment}
              onChange={(event) => setEnvironment(event.target.value)}
              disabled={preparing}
              autoComplete="off"
            >
              <option value="">Selecciona un ambiente</option>
              {environments.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label} · {item.key}
                </option>
              ))}
            </select>
            <p className="field-hint">
              FlowManager unifica los cambios y crea una rama hija nueva a partir de la
              rama configurada para este ambiente. Esa rama es la que luego empujas. El
              ambiente no se modifica ni se empuja. Nunca se toca <code>dev</code>,{' '}
              <code>qas</code>, <code>uat</code>, <code>prd</code> ni{' '}
              <code>release/*</code>.
            </p>
          </div>

          {loadingPreview ? (
            <div className="env-manager-loading">
              <Spinner size="md" label="Analizando repositorios y ramas…" />
            </div>
          ) : preview ? (
            <>
              <div className="deployment-summary">
                <div className="deployment-stat">
                  <span>Requerimientos</span>
                  <strong>{preview.requirementCount}</strong>
                </div>
                <div className="deployment-stat">
                  <span>Repositorios</span>
                  <strong>{preview.repositories.length}</strong>
                </div>
                <div
                  className={`deployment-stat ${preview.commonRepositoryCount > 0 ? 'is-common' : ''}`.trim()}
                >
                  <span>En común</span>
                  <strong>{preview.commonRepositoryCount}</strong>
                </div>
                <div className="deployment-stat">
                  <span>Sin mapeo</span>
                  <strong>{preview.unmappedRequirements.length}</strong>
                </div>
              </div>

              {preview.unmappedRequirements.length > 0 ? (
                <Callout
                  tone="warning"
                  title={`${preview.unmappedRequirements.length} requerimiento(s) sin repositorio`}
                >
                  No entrarán en el despliegue:{' '}
                  {preview.unmappedRequirements
                    .map((requirement) => requirement.externalKey)
                    .join(', ')}
                  . Mapea sus repositorios primero si deben incluirse.
                </Callout>
              ) : null}

              {blocked.length > 0 ? (
                <Callout
                  tone="danger"
                  title="Hay repositorios sin rama para este ambiente"
                >
                  {blocked.map((repo) => (
                    <span key={repo.repositoryId} className="deployment-blocked-item">
                      <strong>{repo.repositoryName}</strong>
                      {repo.warning ? ` — ${repo.warning}` : ''}
                    </span>
                  ))}
                  Configura la rama en la matriz de ambientes antes de preparar el
                  despliegue.
                </Callout>
              ) : null}

              {preview.repositories.length === 0 ? (
                <Callout tone="info" title="Ninguno de los requerimientos está mapeado">
                  Asigna los requerimientos a un repositorio y vuelve a intentarlo.
                </Callout>
              ) : (
                <div className="deployment-repos">
                  {preview.repositories.map((repo) => (
                    <div
                      key={repo.repositoryId}
                      className={`deployment-repo ${repo.available ? '' : 'is-blocked'} ${repo.common ? 'is-common' : ''}`.trim()}
                    >
                      <div className="deployment-repo-head">
                        <div>
                          <strong>{repo.repositoryName}</strong>
                          <small>
                            {repo.targetBranch ? (
                              <>
                                base <code>{repo.targetBranch}</code>
                                {repo.targetSha ? (
                                  <> · {shortSha(repo.targetSha)}</>
                                ) : null}
                              </>
                            ) : (
                              'Sin rama de ambiente configurada'
                            )}
                          </small>
                        </div>
                        {repo.common ? (
                          <StatusChip tone="warning" dot>
                            En común
                          </StatusChip>
                        ) : (
                          <StatusChip tone="neutral">Exclusivo</StatusChip>
                        )}
                      </div>
                      <div className="deployment-repo-reqs">
                        {repo.requirements.map((requirement) => (
                          <span key={requirement.requirementId} className="deployment-req">
                            <code>{requirement.externalKey}</code>
                            <span title={requirement.title}>{requirement.title}</span>
                            <code className="deployment-req-branch">
                              {requirement.branchName}
                            </code>
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="form-note">
                <Icon name="shield" size={14} />
                <span>
                  La rama hija se llama <code>&lt;claves&gt;-&lt;ambiente&gt;</code>{' '}
                  (por ejemplo <code>BPIM-146-dev</code>) y no lleva{' '}
                  <code>feature/</code>: ese prefijo es de la rama del requerimiento. Se
                  crea desde la rama del ambiente y solo esa rama hija se empuja.
                </span>
              </div>
            </>
          ) : (
            <Callout tone="info" title="Elige un ambiente">
              Verás los repositorios implicados y cuáles son comunes a varios
              requerimientos.
            </Callout>
          )}

          {error ? (
            <Callout tone="danger" title="No se pudo preparar el despliegue">
              {error.message}
            </Callout>
          ) : null}
        </div>
      ) : (
        <div className="deployment-sessions">
          <div className="deployment-steps" aria-label="Pasos del despliegue">
            <div className="deployment-step">
              <span className="deployment-step-number">1</span>
              <span>
                <strong>Unificar cambios</strong>
                <small>Un solo commit por repositorio</small>
              </span>
            </div>
            <div className="deployment-step">
              <span className="deployment-step-number">2</span>
              <span>
                <strong>Crear rama hija</strong>
                <small>Se copia la rama del ambiente como base</small>
              </span>
            </div>
            <div className="deployment-step">
              <span className="deployment-step-number">3</span>
              <span>
                <strong>Pushear rama</strong>
                <small>Sube solo la rama hija al remoto</small>
              </span>
            </div>
          </div>
          <p className="deployment-steps-note">
            Crear la rama hija <strong>no modifica el ambiente</strong>. Solo prepara una
            rama nueva en tu equipo; el merge al ambiente lo haces tú en GitHub.
          </p>

          {finished ? (
            <Callout tone="success" title="Ramas empujadas">
              Todas las ramas hijas están en el remoto. Abre un pull request hacia la
              rama del ambiente en GitHub; FlowManager nunca hace merge a ambientes.
            </Callout>
          ) : null}

          {sessions.map((session) => (
            <DeploymentSessionCard
              key={session.id}
              session={session}
              report={reports[session.id]}
              busyAction={busy[session.id]}
              onApply={() => void apply(session)}
              onPush={() => void push(session)}
              onStage={(file) => void handleStage(session, file)}
              onStageAll={() => void handleStageAll(session)}
              onResolve={(file, side) => void handleResolve(session, file, side)}
              onContinue={() => void handleContinue(session)}
              onRefresh={() => void handleRefresh(session)}
              onAbort={() => void handleAbort(session)}
              onReprepare={() => void restartPreparation()}
              onOpenEditor={(file) => void handleOpenEditor(session, file)}
              onOpenTaruGit={() => void handleOpenTaruGit(session)}
              onOpenFolder={() => void handleOpenFolder(session)}
              onCopyPath={() => void handleCopyPath(session)}
            />
          ))}

          {hasConflict ? (
            <Callout tone="warning" title="Hay conflictos pendientes">
              Las acciones masivas están pausadas. Resuelve los archivos conflictivos y
              usa “Continuar” en cada repositorio.
            </Callout>
          ) : null}

          {error ? (
            <Callout tone="danger" title="El despliegue se detuvo">
              {error.message}
              <div className="deployment-restart">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => void restartPreparation()}
                  disabled={Object.keys(busy).length > 0}
                >
                  <Icon name="refresh" size={13} />
                  Volver a preparar
                </button>
              </div>
            </Callout>
          ) : null}

          {branchConflict ? (
            <ConfirmModal
              title="La rama local ya existe"
              message={`La rama '${branchConflict.branch}' ya existe en tu equipo. ¿La elimino y creo la nueva desde ${branchConflict.session.targetBranch ?? 'el ambiente'}? No se toca el remoto ni el ambiente.`}
              confirmLabel="Eliminar y crear"
              tone="danger"
              onConfirm={() => {
                const session = branchConflict.session;
                setBranchConflict(null);
                void apply(session, true);
              }}
              onClose={() => setBranchConflict(null)}
            />
          ) : null}

          {confirmCancel ? (
            <ConfirmModal
              title="Cancelar despliegue"
              message={`Se limpiarán ${sessions.filter((session) => session.status !== 'aborted').length} sesión(es): worktrees y ramas locales. Las ramas que ya se empujaron no se borran del remoto. El ambiente no se modifica.`}
              confirmLabel="Descartar despliegue"
              tone="danger"
              busy={cancelling}
              onConfirm={() => void cancelDeployment()}
              onClose={() => setConfirmCancel(false)}
            />
          ) : null}
        </div>
      )}
    </Modal>
  );
}

interface DeploymentSessionCardProps {
  session: SquashSession;
  report?: DeploymentReport;
  busyAction?: BusyAction;
  onApply: () => void;
  onPush: () => void;
  onStage: (file: string) => void;
  onStageAll: () => void;
  onResolve: (file: string, side: 'ours' | 'theirs') => void;
  onContinue: () => void;
  onRefresh: () => void;
  onAbort: () => void;
  onReprepare: () => void;
  onOpenEditor: (file?: string) => void;
  onOpenTaruGit: () => void;
  onOpenFolder: () => void;
  onCopyPath: () => void;
}

function DeploymentSessionCard({
  session,
  report,
  busyAction,
  onApply,
  onPush,
  onStage,
  onStageAll,
  onResolve,
  onContinue,
  onRefresh,
  onAbort,
  onReprepare,
  onOpenEditor,
  onOpenTaruGit,
  onOpenFolder,
  onCopyPath,
}: DeploymentSessionCardProps) {
  const [confirmAbort, setConfirmAbort] = useState(false);
  const busy = Boolean(busyAction);
  const conflict = session.status === 'conflict';
  const pushed = Boolean(session.pushedSha);
  const canApply = session.phase === 'squash' && session.status === 'ready';
  const canPush = session.phase === 'deploy' && session.status === 'ready' && !pushed;
  const hasDeployCommit = session.phase === 'deploy' && Boolean(session.deploySha);
  const statFiles = hasDeployCommit
    ? report?.deployFiles.length ?? session.deployFilesChanged
    : session.filesChanged;
  const statAdditions = hasDeployCommit
    ? report?.additions ?? session.deployAdditions
    : session.additions;
  const statDeletions = hasDeployCommit
    ? report?.deletions ?? session.deployDeletions
    : session.deletions;
  const alreadyInEnvironment = report?.alreadyInEnvironment ?? [];
  const whitespaceOnlyFiles = report?.whitespaceOnlyFiles ?? [];
  const onlyWhitespace =
    hasDeployCommit &&
    whitespaceOnlyFiles.length > 0 &&
    whitespaceOnlyFiles.length === (report?.deployFiles.length ?? 0);

  return (
    <article
      className={`deployment-session ${conflict ? 'is-conflict' : ''} ${pushed ? 'is-pushed' : ''}`.trim()}
    >
      <div className="deployment-session-head">
        <div>
          <strong>{session.repositoryName}</strong>
          <small>
            {session.phase === 'deploy' ? (
              <>
                {session.targetBranch ? (
                  <>
                    <code>{session.targetBranch}</code> →{' '}
                  </>
                ) : null}
                <code>{session.deployBranch ?? 'rama de despliegue'}</code>
              </>
            ) : (
              <>
                squash sobre <code>{session.baseBranch}</code> ·{' '}
                {session.selectedRequirements
                  .map((requirement) => requirement.externalKey)
                  .join(', ')}
                <span className="deployment-pending-branch">
                  rama hija pendiente: <code>{expectedDeployBranch(session)}</code>
                </span>
              </>
            )}
            {session.environment ? (
              <>
                {' '}
                · env <code>{session.environment}</code>
              </>
            ) : null}
          </small>
        </div>
        <StatusChip tone={cardTone(session)}>{cardLabel(session)}</StatusChip>
      </div>

      <div className="branch-analysis-stats deployment-session-stats">
        <div>
          <span>{session.phase === 'deploy' ? 'Base ambiente' : 'Base'}</span>
          <code>{shortSha(session.targetBaseSha ?? session.baseSha)}</code>
        </div>
        <div>
          <span>Commit</span>
          <code>{shortSha(session.deploySha ?? session.squashSha)}</code>
        </div>
        <div>
          <span>{hasDeployCommit ? 'Archivos rama hija' : 'Archivos squash'}</span>
          <strong>{statFiles}</strong>
        </div>
        <div>
          <span>Líneas</span>
          <strong>
            +{statAdditions} / −{statDeletions}
          </strong>
        </div>
        {pushed ? (
          <div>
            <span>Empujada</span>
            <strong>{session.pushedAt ? formatDateTime(session.pushedAt) : '—'}</strong>
          </div>
        ) : null}
      </div>

      {report && report.squashFiles.length > 0 && alreadyInEnvironment.length > 0 ? (
        <div className="deployment-report">
          <div className="deployment-report-summary">
            <Icon name="info" size={13} />
            <span>
              <strong>{alreadyInEnvironment.length}</strong> de{' '}
              <strong>{report.squashFiles.length}</strong> archivo(s) del squash ya
              están idénticos en <code>{session.targetBranch}</code>;{' '}
              {hasDeployCommit
                ? 'por eso no aparecen como cambios en la rama hija.'
                : 'no necesitan resolverse: solo los demás archivos tienen cambios reales.'}
            </span>
          </div>
          <details>
            <summary>Ver archivos ya presentes en el ambiente</summary>
            <ul>
              {alreadyInEnvironment.map((file) => (
                <li key={file}>
                  <code title={file}>{truncateMiddle(file, 96)}</code>
                </li>
              ))}
            </ul>
          </details>
        </div>
      ) : null}

      {hasDeployCommit && report && report.deployFiles.length === 0 ? (
        <div className="deployment-report is-empty">
          <div className="deployment-report-summary">
            <Icon name="check" size={13} />
            <span>
              El squash ya está completo en <code>{session.targetBranch}</code>: la rama
              hija no agrega cambios netos.
            </span>
          </div>
        </div>
      ) : null}

      {hasDeployCommit && whitespaceOnlyFiles.length > 0 ? (
        <div className="deployment-report is-whitespace">
          <div className="deployment-report-summary">
            <Icon name="alert" size={13} />
            <span>
              {onlyWhitespace
                ? 'Según Git, la rama hija solo cambia espacios o líneas en blanco en '
                : 'Además de los cambios reales, estos archivos solo cambian espacios o líneas en blanco: '}
              <strong>{whitespaceOnlyFiles.length}</strong> archivo(s). Revisa el diff
              antes de empujar: un espacio dentro de un string puede cambiar el
              comportamiento.
            </span>
          </div>
          <details>
            <summary>Ver archivos con solo espacios en blanco</summary>
            <ul>
              {whitespaceOnlyFiles.map((file) => (
                <li key={file}>
                  <code title={file}>{truncateMiddle(file, 96)}</code>
                </li>
              ))}
            </ul>
          </details>
        </div>
      ) : null}

      {conflict ? (
        <>
          <Callout
            tone="warning"
            title={
              session.conflicts.length
                ? `${session.conflicts.length} archivo(s) en conflicto`
                : 'Conflictos resueltos en el índice'
            }
            action={
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={onRefresh}
                disabled={busy}
              >
                <Icon name="refresh" size={13} />
                Actualizar
              </button>
            }
          >
            {session.phase === 'deploy'
              ? 'El squash chocó con cambios ya presentes en la rama del ambiente.'
              : 'El squash chocó con cambios entre las ramas de los requerimientos.'}{' '}
            Por archivo elige <strong>Usar ambiente</strong> (descarta el cambio de tu
            rama en ese archivo) o <strong>Usar mi rama</strong> (descarta el del
            ambiente), o abre el editor y guarda la versión final. FlowManager no deja
            continuar si quedan marcadores. La rama{' '}
            <code>{expectedDeployBranch(session)}</code> ya está libre, pero el conflicto
            vive en este worktree: resuélvelo aquí y no cambies esa rama en el clon
            principal.
          </Callout>

          <div className="squash-conflict-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => onOpenEditor()}
            >
              <Icon name="terminal" size={13} />
              Abrir VS Code
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onOpenTaruGit}
            >
              <Icon name="terminal" size={13} />
              Abrir TaruGit
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onOpenFolder}
            >
              <Icon name="folder" size={13} />
              Abrir carpeta
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onCopyPath}
            >
              <Icon name="copy" size={13} />
              Copiar ruta
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onStageAll}
              disabled={busy || session.conflicts.length === 0}
            >
              <Icon name="plus" size={13} />
              Agregar todos
            </button>
          </div>

          <div className="branch-file-list squash-conflict-list">
            {session.conflicts.length === 0 ? (
              <div className="squash-conflict-empty">
                No quedan archivos sin resolver. Puedes continuar.
              </div>
            ) : (
              session.conflicts.map((file) => (
                <div key={file} className="branch-file-row squash-conflict-row">
                  <span className="branch-file-status branch-file-M">U</span>
                  <span title={file}>{file}</span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    onClick={() => onOpenEditor(file)}
                    title="Abrir en VS Code"
                  >
                    <Icon name="terminal" size={12} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-xs"
                    onClick={() => onResolve(file, 'ours')}
                    disabled={busy}
                    title={
                      session.phase === 'deploy'
                        ? 'Quedarse con la versión del ambiente y descartar los cambios del requerimiento en este archivo'
                        : 'Quedarse con la versión base del squash en este archivo'
                    }
                  >
                    {session.phase === 'deploy' ? 'Usar ambiente' : 'Usar base'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-xs"
                    onClick={() => onResolve(file, 'theirs')}
                    disabled={busy}
                    title="Usar la versión del requerimiento y descartar la del ambiente en este archivo"
                  >
                    Usar mi rama
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-xs"
                    onClick={() => onStage(file)}
                    disabled={busy}
                  >
                    git add
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="squash-conflict-footer">
            <button
              type="button"
              className="btn btn-primary"
              onClick={onContinue}
              disabled={busy || session.conflicts.length > 0}
            >
              {busyAction === 'continue' ? (
                <Spinner size="sm" />
              ) : (
                <Icon name="play" size={14} />
              )}
              {session.conflicts.length > 0
                ? `Faltan ${session.conflicts.length} archivo(s)`
                : session.phase === 'deploy'
                  ? 'Continuar y crear commit'
                  : 'Continuar squash'}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setConfirmAbort(true)}
              disabled={busy}
            >
              <Icon name="trash" size={13} />
              Descartar sesión
            </button>
          </div>
        </>
      ) : canApply ? (
        <>
          <Callout tone="success" title="Paso 2 · Crear la rama hija">
            Los cambios de{' '}
            <strong>
              {session.selectedRequirements
                .map((requirement) => requirement.externalKey)
                .join(', ')}
            </strong>{' '}
            ya están unificados en un commit. Ahora se crea la rama{' '}
            <code>{expectedDeployBranch(session)}</code> a partir de{' '}
            <code>{session.targetBranch}</code> y se le agrega ese commit.{' '}
            <strong>{session.targetBranch} no se modifica.</strong> La rama quedará
            libre para abrirla en TortoiseGit u otra herramienta.
          </Callout>
          {busyAction === 'apply' ? (
            <div className="squash-conflict-footer">
              <span className="deployment-busy">
                <Spinner size="sm" /> Creando rama hija…
              </span>
            </div>
          ) : (
            <div className="squash-conflict-actions">
              <button type="button" className="btn btn-primary btn-sm" onClick={onApply}>
                <Icon name="branch" size={13} />
                Crear rama hija
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={onOpenFolder}
              >
                <Icon name="folder" size={13} />
                Ver worktree
              </button>
            </div>
          )}
        </>
      ) : canPush ? (
        <>
          <Callout tone="success" title="Paso 3 · Rama creada y liberada">
            <code>{session.deployBranch}</code> ya existe en tu equipo y quedó libre
            para abrirla en TortoiseGit u otra herramienta. Todavía no está en GitHub.
            Al empujarla solo se sube esa rama; el ambiente{' '}
            <code>{session.targetBranch}</code> sigue sin cambios.
          </Callout>
          {busyAction === 'push' ? (
            <div className="squash-conflict-footer">
              <span className="deployment-busy">
                <Spinner size="sm" /> Empujando…
              </span>
            </div>
          ) : (
            <div className="squash-conflict-actions">
              <button type="button" className="btn btn-primary btn-sm" onClick={onPush}>
                <Icon name="rocket" size={13} />
                Pushear rama
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={onOpenFolder}
              >
                <Icon name="folder" size={13} />
                Ver worktree
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setConfirmAbort(true)}
              >
                Descartar
              </button>
            </div>
          )}
        </>
      ) : pushed ? (
        <>
          <Callout tone="success" title="Rama empujada">
            <code>{session.deployBranch}</code> ya está en GitHub con{' '}
            <code>{shortSha(session.pushedSha)}</code> y la rama local quedó libre. Falta
            el paso manual: crea el pull request hacia{' '}
            <code>{session.targetBranch}</code> y haz el merge allí. FlowManager no
            modifica el ambiente.
          </Callout>
          <div className="squash-conflict-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onOpenFolder}
            >
              <Icon name="folder" size={13} />
              Ver worktree
            </button>
            {githubCompareUrl(session) ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => void openExternal(githubCompareUrl(session)!)}
              >
                <Icon name="external" size={13} />
                Ver comparación
              </button>
            ) : null}
            {githubPullRequestUrl(session) ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => void openExternal(githubPullRequestUrl(session)!)}
              >
                <Icon name="external" size={13} />
                Crear PR
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setConfirmAbort(true)}
            >
              Limpiar sesión
            </button>
          </div>
        </>
      ) : session.status === 'no_changes' ? (
        <>
          <Callout tone="warning" title="Sin cambios netos en el ambiente">
            {report && report.squashFiles.length > 0 ? (
              <>
                El squash tocó <strong>{report.squashFiles.length}</strong> archivo(s),
                pero <strong>{alreadyInEnvironment.length}</strong> ya eran idénticos en{' '}
                <code>{session.targetBranch}</code>. No se creó una rama hija.
              </>
            ) : (
              <>
                La rama no aporta archivos respecto de{' '}
                <code>{session.baseBranch}</code>.
              </>
            )}
            {session.phase === 'deploy' ? (
              <> Si agregaste commits después de unificar los cambios, vuelve a preparar
                el despliegue para incluirlos.</>
            ) : null}
          </Callout>
          <div className="squash-conflict-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onReprepare}
              disabled={busy}
            >
              <Icon name="refresh" size={13} />
              Volver a preparar
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onAbort}>
              Limpiar sesión
            </button>
          </div>
        </>
      ) : session.status === 'failed' ? (
        <>
          <Callout tone="danger" title="No se pudo completar">
            {session.errorMessage ?? 'Revisa el worktree y vuelve a intentarlo.'}
          </Callout>
          <div className="squash-conflict-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onOpenFolder}
            >
              <Icon name="folder" size={13} />
              Abrir worktree
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onAbort}>
              Descartar sesión
            </button>
          </div>
        </>
      ) : (
        <>
          <Callout tone="info" title="Sesión interrumpida">
            {session.errorMessage ??
              'La sesión no terminó de prepararse. Descártala y vuelve a preparar el despliegue.'}
          </Callout>
          <div className="squash-conflict-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onAbort}>
              Descartar y limpiar
            </button>
          </div>
        </>
      )}

      {confirmAbort && !pushed ? (
        <div className="squash-abort-confirm">
          ¿Descartar el worktree y las ramas locales de esta sesión?
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={onAbort}
            disabled={busy}
          >
            Sí, descartar
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setConfirmAbort(false)}
          >
            No
          </button>
        </div>
      ) : confirmAbort && pushed ? (
        <div className="squash-abort-confirm">
          La rama remota ya existe y no se borrará. Solo se limpiará el worktree local.
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={onAbort}
            disabled={busy}
          >
            Sí, limpiar local
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setConfirmAbort(false)}
          >
            No
          </button>
        </div>
      ) : null}

      <footer className="req-detail-footer">
        <span className="deployment-worktree-path">
          Worktree{' '}
          <code title={session.worktreePath}>
            {truncateMiddle(session.worktreePath, 32)}
          </code>
          <button
            type="button"
            className="btn btn-icon btn-ghost btn-xs"
            title="Copiar ruta del worktree"
            aria-label="Copiar ruta del worktree"
            onClick={onCopyPath}
          >
            <Icon name="copy" size={12} />
          </button>
        </span>
        <span>Actualizado {formatDateTime(session.updatedAt)}</span>
      </footer>
    </article>
  );
}

function githubCompareUrl(session: SquashSession): string | null {
  if (
    !session.githubOwner ||
    !session.githubRepo ||
    !session.targetBranch ||
    !session.deployBranch
  ) {
    return null;
  }
  return `https://github.com/${session.githubOwner}/${session.githubRepo}/compare/${session.targetBranch}...${session.deployBranch}`;
}

function githubPullRequestUrl(session: SquashSession): string | null {
  const compare = githubCompareUrl(session);
  return compare ? `${compare}?expand=1` : null;
}

async function openExternal(url: string) {
  try {
    await openUrl(url);
  } catch (caught) {
    toast.error('No se pudo abrir el enlace', {
      description: normalizeError(caught).message,
    });
  }
}

function expectedDeployBranch(session: SquashSession): string {
  if (session.deployBranch) return session.deployBranch;
  const environment = session.environment ?? 'env';
  const keys = session.selectedRequirements.map(
    (requirement) => requirement.externalKey,
  );
  const candidate = `${keys.join('-')}-${environment}`;
  if (candidate.length <= 90) return candidate;
  const short = session.id.replace(/-/g, '').slice(-8);
  return `${keys[0] ?? 'req'}-bundle-${short}-${environment}`;
}

function cardLabel(session: SquashSession): string {
  if (session.pushedSha) return 'Empujada';
  if (session.status === 'conflict') return 'Conflicto';
  if (session.status === 'no_changes') return 'Sin cambios';
  if (session.status === 'failed') return 'Falló';
  if (session.status === 'preparing') return 'Preparando';
  if (session.status === 'aborted') return 'Descartada';
  if (session.phase === 'deploy') return 'Falta pushear';
  return 'Falta crear rama';
}

function cardTone(
  session: SquashSession,
): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  if (session.pushedSha) return 'success';
  if (session.status === 'conflict') return 'warning';
  if (session.status === 'failed') return 'danger';
  if (session.status === 'preparing') return 'info';
  if (session.status === 'no_changes') return 'neutral';
  if (session.status === 'aborted') return 'neutral';
  return session.phase === 'deploy' ? 'info' : 'success';
}
