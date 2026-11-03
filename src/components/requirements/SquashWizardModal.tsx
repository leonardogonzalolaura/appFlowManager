import { useCallback, useEffect, useMemo, useState } from 'react';
import { normalizeError } from '../../lib/api';
import { copyText, formatDateTime, shortSha, truncateMiddle } from '../../lib/format';
import { listRepositories } from '../../lib/repositories';
import {
  abortSquash,
  continueSquash,
  listSquashCandidates,
  listSquashSessions,
  openSquashEditor,
  openSquashFolder,
  openSquashInTaruGit,
  prepareSquash,
  refreshSquashConflicts,
  stageAllSquash,
  stageSquashFile,
} from '../../lib/squash';
import type {
  ApiError,
  RepositorySummary,
  SquashCandidate,
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

interface SquashWizardModalProps {
  onClose: () => void;
  onChanged: () => void;
}

export function SquashWizardModal({ onClose, onChanged }: SquashWizardModalProps) {
  const [sessions, setSessions] = useState<SquashSession[]>([]);
  const [activeSession, setActiveSession] = useState<SquashSession | null>(null);
  const [repositories, setRepositories] = useState<RepositorySummary[]>([]);
  const [repositoryId, setRepositoryId] = useState('');
  const [candidates, setCandidates] = useState<SquashCandidate[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [strategy, setStrategy] = useState<'all_commits' | 'selected_commits'>(
    'all_commits',
  );
  const [selectedCommits, setSelectedCommits] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [messageTouched, setMessageTouched] = useState(false);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [discardTarget, setDiscardTarget] = useState<SquashSession | null>(null);
  const [discarding, setDiscarding] = useState(false);

  const loadSessions = useCallback(async () => {
    try {
      setSessions(await listSquashSessions());
    } catch {
      // El listado es auxiliar; el wizard puede crear una sesión nueva igualmente.
    }
  }, []);

  useEffect(() => {
    let active = true;
    void loadSessions();
    listRepositories()
      .then((loaded) => {
        if (!active) return;
        setRepositories(loaded);
        setRepositoryId(loaded[0]?.id ?? '');
      })
      .catch((caught) => {
        if (active) setError(normalizeError(caught));
      });
    return () => {
      active = false;
    };
  }, [loadSessions]);

  useEffect(() => {
    if (!repositoryId || activeSession) {
      setCandidates([]);
      return;
    }
    let active = true;
    setLoadingCandidates(true);
    setSelectedIds(new Set());
    setSelectedCommits(new Set());
    setMessage('');
    setMessageTouched(false);
    listSquashCandidates(repositoryId)
      .then((loaded) => {
        if (active) setCandidates(loaded);
      })
      .catch((caught) => {
        if (active) {
          setCandidates([]);
          setError(normalizeError(caught));
        }
      })
      .finally(() => {
        if (active) setLoadingCandidates(false);
      });
    return () => {
      active = false;
    };
  }, [repositoryId, activeSession]);

  const selectedCandidates = useMemo(
    () => candidates.filter((candidate) => selectedIds.has(candidate.requirementId)),
    [candidates, selectedIds],
  );

  const availableCommits = useMemo(() => {
    const map = new Map<string, SquashCandidate['commits'][number]>();
    for (const candidate of selectedCandidates) {
      for (const commit of candidate.commits) {
        map.set(commit.sha, commit);
      }
    }
    return Array.from(map.values()).sort((left, right) =>
      left.committedAt.localeCompare(right.committedAt),
    );
  }, [selectedCandidates]);

  const activeSessions = sessions.filter(
    (session) =>
      !session.environment &&
      ['conflict', 'ready', 'preparing', 'failed', 'no_changes'].includes(
        session.status,
      ),
  );

  function toggleCandidate(candidate: SquashCandidate) {
    if (!candidate.available) return;
    const next = new Set(selectedIds);
    const nextCommits = new Set(selectedCommits);
    if (next.has(candidate.requirementId)) {
      next.delete(candidate.requirementId);
      const stillSelected = candidates.filter(
        (item) =>
          item.requirementId !== candidate.requirementId &&
          next.has(item.requirementId),
      );
      const stillCommits = new Set(
        stillSelected.flatMap((item) => item.commits.map((commit) => commit.sha)),
      );
      candidate.commits.forEach((commit) => {
        if (!stillCommits.has(commit.sha)) nextCommits.delete(commit.sha);
      });
    } else {
      next.add(candidate.requirementId);
      candidate.commits.forEach((commit) => nextCommits.add(commit.sha));
    }
    setSelectedIds(next);
    setSelectedCommits(nextCommits);
    if (!messageTouched) {
      const selected = candidates.filter((item) => next.has(item.requirementId));
      if (selected.length === 0) {
        setMessage('');
      } else if (selected.length === 1) {
        setMessage(`${selected[0].externalKey}: ${selected[0].title}`);
      } else {
        const keys = selected.map((item) => item.externalKey).join(', ');
        setMessage(`${keys}: ${selected.map((item) => item.title).join(' | ')}`);
      }
    }
    setError(null);
  }

  function toggleCommit(sha: string) {
    setSelectedCommits((current) => {
      const next = new Set(current);
      if (next.has(sha)) next.delete(sha);
      else next.add(sha);
      return next;
    });
  }

  async function prepare() {
    if (!repositoryId) return;
    if (selectedIds.size === 0) {
      setError({
        code: 'VALIDATION',
        message: 'Selecciona al menos un requerimiento.',
        retryable: false,
      });
      return;
    }
    if (strategy === 'selected_commits' && selectedCommits.size === 0) {
      setError({
        code: 'VALIDATION',
        message: 'Selecciona al menos un commit.',
        retryable: false,
      });
      return;
    }
    setPreparing(true);
    setError(null);
    try {
      const session = await prepareSquash({
        repositoryId,
        requirementIds: Array.from(selectedIds),
        strategy,
        commitShas:
          strategy === 'selected_commits'
            ? Array.from(selectedCommits)
            : undefined,
        message: message.trim() || undefined,
      });
      setActiveSession(session);
      await loadSessions();
      onChanged();
      if (session.status === 'ready') {
        toast.success('Squash preparado', {
          description: `${session.filesChanged} archivo(s) en un solo commit.`,
        });
      } else if (session.status === 'conflict') {
        toast.warning('Squash pausado por conflicto', {
          description: 'Resuelve los archivos y continúa.',
        });
      } else if (session.status === 'no_changes') {
        toast.info('No hay cambios netos que squashar');
      }
    } catch (caught) {
      setError(normalizeError(caught));
      await loadSessions();
    } finally {
      setPreparing(false);
    }
  }

  async function handleStage(file: string) {
    if (!activeSession) return;
    try {
      const updated = await stageSquashFile(activeSession.id, file);
      setActiveSession(updated);
      setSessions((current) =>
        current.map((session) => (session.id === updated.id ? updated : session)),
      );
      toast.success('Archivo agregado', { description: file });
    } catch (caught) {
      const apiError = normalizeError(caught);
      toast.error('No se pudo agregar el archivo', {
        description: apiError.message,
      });
    }
  }

  async function handleStageAll() {
    if (!activeSession) return;
    try {
      const updated = await stageAllSquash(activeSession.id);
      setActiveSession(updated);
      setSessions((current) =>
        current.map((session) => (session.id === updated.id ? updated : session)),
      );
      toast.success('Archivos agregados');
    } catch (caught) {
      const apiError = normalizeError(caught);
      toast.error('No se pudieron agregar los archivos', {
        description: apiError.message,
      });
    }
  }

  async function handleContinue() {
    if (!activeSession) return;
    try {
      const updated = await continueSquash(activeSession.id);
      setActiveSession(updated);
      setSessions((current) =>
        current.map((session) => (session.id === updated.id ? updated : session)),
      );
      onChanged();
      if (updated.status === 'ready') {
        toast.success('Squash completado', {
          description: `${updated.filesChanged} archivo(s) en un solo commit.`,
        });
      }
    } catch (caught) {
      const apiError = normalizeError(caught);
      toast.error('No se pudo continuar', { description: apiError.message });
      await loadSessions();
    }
  }

  async function discardSession(session: SquashSession) {
    try {
      const updated = await abortSquash(session.id);
      setSessions((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setActiveSession((current) => (current?.id === updated.id ? updated : current));
      onChanged();
      toast.success('Squash descartado', {
        description:
          'El worktree y la rama interna se eliminaron. Tus ramas originales siguen intactas.',
      });
      return true;
    } catch (caught) {
      const apiError = normalizeError(caught);
      toast.error('No se pudo descartar', { description: apiError.message });
      await loadSessions();
      return false;
    }
  }

  async function handleAbort() {
    if (!activeSession) return;
    await discardSession(activeSession);
  }

  async function handleConfirmDiscard() {
    if (!discardTarget) return;
    setDiscarding(true);
    await discardSession(discardTarget);
    setDiscardTarget(null);
    setDiscarding(false);
  }

  async function handleRefreshConflicts() {
    if (!activeSession) return;
    try {
      setActiveSession(await refreshSquashConflicts(activeSession.id));
    } catch (caught) {
      const apiError = normalizeError(caught);
      toast.error('No se pudo refrescar', { description: apiError.message });
    }
  }

  async function handleOpenEditor(file?: string) {
    if (!activeSession) return;
    try {
      await openSquashEditor(activeSession.id, file);
    } catch (caught) {
      const apiError = normalizeError(caught);
      toast.error('No se pudo abrir VS Code', { description: apiError.message });
    }
  }

  async function handleOpenTaruGit() {
    if (!activeSession) return;
    try {
      await openSquashInTaruGit(activeSession.id);
    } catch (caught) {
      const apiError = normalizeError(caught);
      toast.error('No se pudo abrir TaruGit', { description: apiError.message });
    }
  }

  async function handleOpenFolder() {
    if (!activeSession) return;
    try {
      await openSquashFolder(activeSession.id);
    } catch (caught) {
      const apiError = normalizeError(caught);
      toast.error('No se pudo abrir la carpeta', { description: apiError.message });
    }
  }

  async function handleCopyPath(session: SquashSession) {
    try {
      await copyText(session.worktreePath);
      toast.success('Ruta copiada', { description: session.worktreePath });
    } catch (caught) {
      const apiError = normalizeError(caught);
      toast.error('No se pudo copiar la ruta', { description: apiError.message });
    }
  }

  return (
    <Modal
      title={activeSession ? `Squash · ${activeSession.repositoryName}` : 'Preparar squash'}
      description={
        activeSession
          ? `${activeSession.baseBranch} · ${activeSession.internalBranch}`
          : 'Vista previa: unifica uno o varios requerimientos del mismo repositorio en un commit aislado. No despliega; para eso usa "Preparar despliegue".'
      }
      size="lg"
      icon={<Icon name="package" size={20} />}
      onClose={preparing ? () => undefined : onClose}
      closeOnBackdrop={!preparing}
      footer={
        activeSession ? (
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cerrar
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void prepare()}
              disabled={preparing || selectedIds.size === 0}
            >
              {preparing ? <Spinner size="sm" /> : <Icon name="package" size={14} />}
              {preparing ? 'Preparando…' : 'Preparar squash'}
            </button>
          </>
        )
      }
    >
      {activeSession ? (
        <SessionPanel
          session={activeSession}
          onStage={(file) => void handleStage(file)}
          onStageAll={() => void handleStageAll()}
          onContinue={() => void handleContinue()}
          onAbort={() => void handleAbort()}
          onRefresh={() => void handleRefreshConflicts()}
          onOpenEditor={(file) => void handleOpenEditor(file)}
          onOpenTaruGit={() => void handleOpenTaruGit()}
          onOpenFolder={() => void handleOpenFolder()}
          onCopyPath={() => void handleCopyPath(activeSession)}
          onBack={() => setActiveSession(null)}
        />
      ) : (
        <>
          {activeSessions.length > 0 ? (
            <div className="squash-active-sessions">
              <div className="branch-section-head">
                <h3>Sesiones activas</h3>
                <span className="req-section-meta">{activeSessions.length}</span>
              </div>
              {activeSessions.map((session) => (
                <div key={session.id} className="squash-session-card">
                  <button
                    type="button"
                    className="squash-session-open"
                    onClick={() => setActiveSession(session)}
                  >
                    <span>
                      <strong>{session.repositoryName}</strong>
                      <small>
                        {session.internalBranch} · {formatDateTime(session.updatedAt)}
                      </small>
                    </span>
                    <StatusChip tone={sessionTone(session.status)}>
                      {sessionLabel(session.status)}
                    </StatusChip>
                    <Icon name="chevron-right" size={13} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-icon btn-ghost btn-xs squash-session-discard"
                    title="Descartar squash"
                    aria-label={`Descartar squash de ${session.repositoryName}`}
                    onClick={() => setDiscardTarget(session)}
                  >
                    <Icon name="trash" size={12} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="squash-setup">
            <div className="field">
              <label className="field-label" htmlFor="squash-repo">
                Repositorio
              </label>
              <select
                id="squash-repo"
                className="input"
                value={repositoryId}
                onChange={(event) => setRepositoryId(event.target.value)}
                disabled={preparing}
              >
                {repositories.map((repository) => (
                  <option key={repository.id} value={repository.id}>
                    {repository.name}
                  </option>
                ))}
              </select>
            </div>

            {loadingCandidates ? (
              <div className="env-manager-loading">
                <Spinner size="md" label="Analizando ramas y commits…" />
              </div>
            ) : candidates.length === 0 ? (
              <Callout tone="info" title="No hay requerimientos mapeados">
                Asigna primero un requerimiento a este repositorio y crea su rama.
              </Callout>
            ) : (
              <div className="field">
                <span className="field-label">Requerimientos</span>
                <div className="squash-candidates">
                  {candidates.map((candidate) => (
                    <label
                      key={candidate.requirementId}
                      className={`squash-candidate ${candidate.available ? '' : 'is-disabled'} ${selectedIds.has(candidate.requirementId) ? 'is-selected' : ''}`.trim()}
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(candidate.requirementId)}
                        onChange={() => toggleCandidate(candidate)}
                        disabled={!candidate.available || preparing}
                      />
                      <span className="squash-candidate-copy">
                        <span className="squash-candidate-title">
                          <code>{candidate.externalKey}</code>
                          <span>{candidate.title}</span>
                        </span>
                        <span className="squash-candidate-meta">
                          <code>{candidate.branchName}</code>
                          <span>{candidate.ahead} commit(s)</span>
                          {candidate.warning ? (
                            <span className="squash-warning">{candidate.warning}</span>
                          ) : null}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="branch-strategy">
              <label className={`branch-option ${strategy === 'all_commits' ? 'is-selected' : ''}`}>
                <input
                  type="radio"
                  name="squash-strategy"
                  checked={strategy === 'all_commits'}
                  onChange={() => setStrategy('all_commits')}
                  disabled={preparing}
                />
                <span>
                  <strong>Todos los commits</strong>
                  <small>
                    Aplica cada rama con <code>merge --squash</code> y colapsa todo en un
                    commit final.
                  </small>
                </span>
              </label>
              <label className={`branch-option ${strategy === 'selected_commits' ? 'is-selected' : ''}`}>
                <input
                  type="radio"
                  name="squash-strategy"
                  checked={strategy === 'selected_commits'}
                  onChange={() => setStrategy('selected_commits')}
                  disabled={preparing}
                />
                <span>
                  <strong>Seleccionar commits</strong>
                  <small>
                    Aplica solo los commits elegidos con <code>cherry-pick -n</code>.
                  </small>
                </span>
              </label>
            </div>

            {strategy === 'selected_commits' ? (
              <div className="squash-commits">
                <div className="branch-section-head">
                  <h3>Commits a incluir</h3>
                  <span className="req-section-meta">
                    {selectedCommits.size}/{availableCommits.length}
                  </span>
                </div>
                {availableCommits.length === 0 ? (
                  <p className="req-empty-line">Selecciona primero un requerimiento.</p>
                ) : (
                  availableCommits.map((commit) => (
                    <label key={commit.sha} className="squash-commit">
                      <input
                        type="checkbox"
                        checked={selectedCommits.has(commit.sha)}
                        onChange={() => toggleCommit(commit.sha)}
                        disabled={preparing}
                      />
                      <code>{shortSha(commit.sha)}</code>
                      <span>{commit.summary}</span>
                      <span className="squash-commit-meta">
                        {commit.author ?? '—'}
                      </span>
                      {commit.isForeign ? (
                        <StatusChip tone="warning">Ajeno</StatusChip>
                      ) : null}
                    </label>
                  ))
                )}
              </div>
            ) : null}

            <div className="field">
              <label className="field-label" htmlFor="squash-message">
                Mensaje del commit final
              </label>
              <textarea
                id="squash-message"
                className="input textarea"
                rows={4}
                value={message}
                onChange={(event) => {
                  setMessage(event.target.value);
                  setMessageTouched(true);
                }}
                disabled={preparing}
                placeholder="Se genera automáticamente si lo dejas vacío."
              />
            </div>

            <div className="form-note">
              <Icon name="shield" size={14} />
              <span>
                El squash se hace en un worktree aislado. No se reescriben las ramas
                originales ni tu copia de trabajo.
              </span>
            </div>

            {error ? (
              <Callout tone="danger" title="No se pudo preparar el squash">
                {error.message}
              </Callout>
            ) : null}
          </div>
        </>
      )}

      {discardTarget ? (
        <ConfirmModal
          title="Descartar squash"
          message={`Se eliminará el worktree y la rama interna de "${discardTarget.repositoryName}". Tus ramas de requerimiento y el remoto no se tocan. Esta acción no modifica ningún ambiente.`}
          confirmLabel="Descartar squash"
          tone="danger"
          busy={discarding}
          onConfirm={() => void handleConfirmDiscard()}
          onClose={() => setDiscardTarget(null)}
        />
      ) : null}
    </Modal>
  );
}

interface SessionPanelProps {
  session: SquashSession;
  onStage: (file: string) => void;
  onStageAll: () => void;
  onContinue: () => void;
  onAbort: () => void;
  onRefresh: () => void;
  onOpenEditor: (file?: string) => void;
  onOpenTaruGit: () => void;
  onOpenFolder: () => void;
  onCopyPath: () => void;
  onBack: () => void;
}

function SessionPanel({
  session,
  onStage,
  onStageAll,
  onContinue,
  onAbort,
  onRefresh,
  onOpenEditor,
  onOpenTaruGit,
  onOpenFolder,
  onCopyPath,
  onBack,
}: SessionPanelProps) {
  const [confirmAbort, setConfirmAbort] = useState(false);
  const conflict = session.status === 'conflict';

  return (
    <div className="squash-session">
      <div className="branch-analysis-head">
        <div>
          <h3>{session.repositoryName}</h3>
          <p>
            <code>{session.baseBranch}</code> → <code>{session.internalBranch}</code>
          </p>
        </div>
        <StatusChip tone={sessionTone(session.status)}>
          {sessionLabel(session.status)}
        </StatusChip>
      </div>

      <div className="branch-analysis-stats">
        <div>
          <span>Base</span>
          <code>{shortSha(session.baseSha)}</code>
        </div>
        <div>
          <span>Worktree</span>
          <span className="squash-worktree-cell">
            <code title={session.worktreePath}>
              {truncateMiddle(session.worktreePath, 22)}
            </code>
            <button
              type="button"
              className="btn btn-icon btn-ghost btn-xs"
              title="Copiar ruta del worktree"
              aria-label="Copiar ruta del worktree"
              onClick={onCopyPath}
            >
              <Icon name="copy" size={11} />
            </button>
          </span>
        </div>
        <div>
          <span>Estrategia</span>
          <strong>
            {session.strategy === 'all_commits' ? 'Todos' : 'Selección'}
          </strong>
        </div>
        <div>
          <span>Archivos</span>
          <strong>{session.filesChanged}</strong>
        </div>
        <div>
          <span>Líneas</span>
          <strong className="branch-diff-stat">
            +{session.additions} / −{session.deletions}
          </strong>
        </div>
        <div>
          <span>Commit</span>
          <code>{shortSha(session.squashSha)}</code>
        </div>
      </div>

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
              <button type="button" className="btn btn-secondary btn-sm" onClick={onRefresh}>
                <Icon name="refresh" size={13} />
                Actualizar
              </button>
            }
          >
            La sesión está pausada en{' '}
            <strong>{session.currentAction ?? 'una acción pendiente'}</strong>. Abre el
            worktree, resuelve los marcadores, guarda y agrega los archivos.
          </Callout>

          <div className="squash-conflict-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => onOpenEditor()}>
              <Icon name="terminal" size={13} />
              Abrir VS Code
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onOpenTaruGit}>
              <Icon name="terminal" size={13} />
              Abrir TaruGit
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onOpenFolder}>
              <Icon name="folder" size={13} />
              Abrir carpeta
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onCopyPath}>
              <Icon name="copy" size={13} />
              Copiar ruta
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onStageAll}
              disabled={session.conflicts.length === 0}
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
                    onClick={() => onStage(file)}
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
              disabled={session.conflicts.length > 0}
            >
              <Icon name="play" size={14} />
              {session.conflicts.length > 0
                ? `Faltan ${session.conflicts.length} archivo(s)`
                : 'Continuar squash'}
            </button>
            {confirmAbort ? (
              <span className="squash-abort-confirm">
                ¿Descartar el worktree?
                <button type="button" className="btn btn-danger btn-sm" onClick={onAbort}>
                  Sí, abortar
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setConfirmAbort(false)}
                >
                  No
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setConfirmAbort(true)}
              >
                Abortar
              </button>
            )}
          </div>
        </>
      ) : session.status === 'ready' ? (
        <>
          <Callout tone="success" title="Squash de vista previa listo">
            {session.filesChanged} archivo(s), +{session.additions} / −
            {session.deletions}. Es una <strong>previsualización</strong> del unificado en
            la rama interna <code>{session.internalBranch}</code>: no crea la rama del
            ambiente ni despliega nada. Para desplegar, marca los requerimientos y usa{' '}
            <strong>Preparar despliegue</strong>.
          </Callout>
          <div className="squash-ready">
            <div>
              <span className="req-detail-label">Commit squash</span>
              <code>{session.squashSha}</code>
            </div>
            <div>
              <span className="req-detail-label">Mensaje</span>
              <pre>{session.message}</pre>
            </div>
            <div>
              <span className="req-detail-label">Requerimientos</span>
              <span>
                {session.selectedRequirements
                  .map((requirement) => requirement.externalKey)
                  .join(', ')}
              </span>
            </div>
          </div>
          <div className="squash-conflict-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onOpenFolder}>
              <Icon name="folder" size={13} />
              Abrir worktree
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onCopyPath}>
              <Icon name="copy" size={13} />
              Copiar ruta
            </button>
            {confirmAbort ? (
              <span className="squash-abort-confirm">
                ¿Descartar este squash?
                <button type="button" className="btn btn-danger btn-sm" onClick={onAbort}>
                  Sí, descartar
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setConfirmAbort(false)}
                >
                  No
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setConfirmAbort(true)}
              >
                <Icon name="trash" size={13} />
                Descartar squash
              </button>
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
              Nueva sesión
            </button>
          </div>
        </>
      ) : session.status === 'preparing' ? (
        <>
          <Callout tone="info" title="La sesión se interrumpió mientras se preparaba">
            Aborta esta sesión y vuelve a preparar el squash. El worktree aislado puede
            quedar para diagnóstico hasta que lo limpies.
          </Callout>
          <div className="squash-conflict-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onBack}>
              Volver
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onAbort}>
              Abortar y limpiar
            </button>
          </div>
        </>
      ) : session.status === 'aborted' ? (
        <>
          <Callout tone="info" title="Sesión abortada">
            El worktree y la rama interna se descartaron. Tus ramas originales siguen
            intactas.
          </Callout>
          <div className="squash-conflict-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onBack}>
              Volver
            </button>
          </div>
        </>
      ) : (
        <>
          <Callout
            tone={session.status === 'no_changes' ? 'warning' : 'danger'}
            title={
              session.status === 'no_changes'
                ? 'No hay cambios netos'
                : 'El squash no pudo completarse'
            }
          >
            {session.errorMessage ??
              'Las ramas seleccionadas no aportan cambios respecto a la base.'}
          </Callout>
          <div className="squash-conflict-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onBack}>
              Volver
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onAbort}>
              Limpiar worktree
            </button>
          </div>
        </>
      )}

      <footer className="req-detail-footer">
        <span>Creado {formatDateTime(session.createdAt)}</span>
        <span>Actualizado {formatDateTime(session.updatedAt)}</span>
      </footer>
    </div>
  );
}

function sessionTone(
  status: SquashSession['status'],
): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  switch (status) {
    case 'ready':
      return 'success';
    case 'conflict':
      return 'warning';
    case 'failed':
      return 'danger';
    case 'preparing':
      return 'info';
    default:
      return 'neutral';
  }
}

function sessionLabel(status: SquashSession['status']): string {
  switch (status) {
    case 'ready':
      return 'Listo';
    case 'conflict':
      return 'Conflicto';
    case 'failed':
      return 'Falló';
    case 'preparing':
      return 'Preparando';
    case 'no_changes':
      return 'Sin cambios';
    default:
      return 'Abortado';
  }
}
