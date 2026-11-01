import { useEffect, useState } from 'react';
import { normalizeError } from '../../lib/api';
import { analyzeRequirementBranches } from '../../lib/branches';
import { formatDateTime } from '../../lib/format';
import { listDbScripts } from '../../lib/database';
import { getEnvironmentStatus } from '../../lib/presence';
import {
  getRequirement,
  unassignRequirementRepository,
  updateManualRequirement,
} from '../../lib/requirements';
import type {
  ApiError,
  BranchOperationResult,
  DbScriptSummary,
  EnvironmentPresence,
  RepositoryBranchAnalysis,
  RequirementDetail,
  RequirementPresence,
  RequirementRepositoryMapping,
} from '../../types';
import { BranchAnalysisModal } from './BranchAnalysisModal';
import { BranchCreateModal } from './BranchCreateModal';
import { Callout } from '../ui/Callout';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';
import { StatusChip } from '../ui/StatusChip';
import { toast } from '../ui/Toast';
import { AssignRepositoryModal } from './AssignRepositoryModal';
import { RequirementScriptsModal } from '../database/RequirementScriptsModal';

interface RequirementDetailModalProps {
  requirementId: string;
  onClose: () => void;
  onChanged: () => void;
  onEdit: (requirement: RequirementDetail) => void;
  onArchive: (requirement: RequirementDetail) => void;
}

export function RequirementDetailModal({
  requirementId,
  onClose,
  onChanged,
  onEdit,
  onArchive,
}: RequirementDetailModalProps) {
  const [detail, setDetail] = useState<RequirementDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [notes, setNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [unassigning, setUnassigning] = useState<string | null>(null);
  const [branchMapping, setBranchMapping] =
    useState<RequirementRepositoryMapping | null>(null);
  const [analyses, setAnalyses] = useState<RepositoryBranchAnalysis[] | null>(null);
  const [analyzingRepo, setAnalyzingRepo] = useState<string | null>(null);
  const [scriptsOpen, setScriptsOpen] = useState(false);
  const [scripts, setScripts] = useState<DbScriptSummary[]>([]);
  const [scriptsLoading, setScriptsLoading] = useState(true);
  const [infoOpen, setInfoOpen] = useState(false);
  const [subitemsOpen, setSubitemsOpen] = useState<boolean | null>(null);
  const [presence, setPresence] = useState<RequirementPresence | null>(null);
  const [presenceLoading, setPresenceLoading] = useState(false);
  const [presenceError, setPresenceError] = useState<string | null>(null);

  async function loadPresence() {
    setPresenceLoading(true);
    try {
      const [loaded] = await getEnvironmentStatus([requirementId]);
      setPresence(loaded ?? null);
      setPresenceError(null);
    } catch (caught) {
      setPresenceError(normalizeError(caught).message);
    } finally {
      setPresenceLoading(false);
    }
  }

  async function loadScripts() {
    setScriptsLoading(true);
    try {
      setScripts(await listDbScripts({ requirementId }));
    } catch {
      setScripts([]);
    } finally {
      setScriptsLoading(false);
    }
  }

  async function load() {
    setLoading(true);
    try {
      const loaded = await getRequirement(requirementId);
      setDetail(loaded);
      setNotes(loaded.notes ?? '');
      setError(null);
      void loadScripts();
      void loadPresence();
    } catch (caught) {
      setError(normalizeError(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setInfoOpen(false);
    setSubitemsOpen(null);
    setPresence(null);
    setPresenceError(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requirementId]);

  useEffect(() => {
    if (!detail) return;
    const body = document.querySelector<HTMLElement>('.modal .modal-body');
    if (body) body.scrollTop = 0;
  }, [detail]);

  async function saveNotes() {
    if (!detail) return;
    setSavingNotes(true);
    try {
      const updated = await updateManualRequirement(detail.id, { notes });
      setDetail(updated);
      setNotes(updated.notes ?? '');
      onChanged();
      toast.success('Notas guardadas');
    } catch (caught) {
      const apiError = normalizeError(caught);
      toast.error('No se pudieron guardar las notas', {
        description: apiError.message,
      });
    } finally {
      setSavingNotes(false);
    }
  }

  async function unassign(repositoryId: string, name: string) {
    if (!detail) return;
    setUnassigning(repositoryId);
    try {
      await unassignRequirementRepository(detail.id, repositoryId);
      await load();
      onChanged();
      toast.success('Repositorio desasignado', { description: name });
    } catch (caught) {
      const apiError = normalizeError(caught);
      toast.error('No se pudo desasignar', { description: apiError.message });
    } finally {
      setUnassigning(null);
    }
  }

  async function analyzeBranch(repository: RequirementRepositoryMapping) {
    if (!detail) return;
    setAnalyzingRepo(repository.repositoryId);
    try {
      const result = await analyzeRequirementBranches({
        requirementId: detail.id,
        repositoryId: repository.repositoryId,
      });
      setAnalyses(result);
      await load();
      onChanged();
    } catch (caught) {
      const apiError = normalizeError(caught);
      toast.error('No se pudo analizar la rama', {
        description: apiError.message,
      });
    } finally {
      setAnalyzingRepo(null);
    }
  }

  function handleBranchCreated(
    repository: RequirementRepositoryMapping,
    result: BranchOperationResult,
  ) {
    setBranchMapping(null);
    toast.success('Rama preparada', { description: result.message });
    void load();
    onChanged();
    void analyzeBranch(repository);
  }

  const totalSp = detail
    ? detail.subtasks.reduce(
        (sum, subtask) => sum + (subtask.estimatedSp ?? 0),
        0,
      )
    : 0;
  const infoSummary = detail ? summarizeDetail(detail) : [];
  const subitemsExpanded =
    subitemsOpen ?? (detail ? detail.subtasks.length <= 3 : true);

  return (
    <>
      <Modal
        title={detail ? `${detail.externalKey} · ${detail.title}` : 'Requerimiento'}
        description={
          detail
            ? detail.source === 'monday'
              ? 'Importado de Monday. Los campos de Monday son de solo lectura.'
              : 'Requerimiento manual. Puedes editar sus campos.'
            : undefined
        }
        size="lg"
        icon={<Icon name="list" size={20} />}
        badge={
          detail ? (
            <>
              <StatusChip tone={detail.source === 'manual' ? 'info' : 'neutral'}>
                {detail.source === 'manual' ? 'Manual' : 'Monday'}
              </StatusChip>
              {detail.archivedAt ? <StatusChip tone="warning">Archivado</StatusChip> : null}
            </>
          ) : undefined
        }
        onClose={onClose}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cerrar
            </button>
            {detail?.source === 'manual' && detail.isActive ? (
              <>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => onArchive(detail)}
                >
                  <Icon name="trash" size={14} />
                  Archivar
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => onEdit(detail)}
                >
                  <Icon name="settings" size={14} />
                  Editar
                </button>
              </>
            ) : null}
          </>
        }
      >
        {loading ? (
          <div className="env-manager-loading">
            <Spinner size="md" label="Leyendo requerimiento…" />
          </div>
        ) : error ? (
          <Callout tone="danger" title="No pudimos leer el requerimiento">
            {error.message}
          </Callout>
        ) : detail ? (
          <>
            <section className={`req-collapsible ${infoOpen ? 'is-open' : ''}`}>
              <button
                type="button"
                className="req-collapsible-head"
                aria-expanded={infoOpen}
                aria-controls="req-info-body"
                onClick={() => setInfoOpen((value) => !value)}
              >
                <span className="req-collapsible-title">
                  <Icon name="info" size={13} />
                  Información del ticket
                </span>
                {!infoOpen && infoSummary.length > 0 ? (
                  <span className="req-collapsible-summary">
                    {infoSummary.map((item, index) => (
                      <span key={`${item}-${index}`}>{item}</span>
                    ))}
                  </span>
                ) : null}
                <Icon
                  name="chevron-down"
                  size={14}
                  className="req-collapsible-chevron"
                />
              </button>

              <div id="req-info-body" className="req-collapsible-body" hidden={!infoOpen}>
                <div className="req-detail-grid">
                  <DetailField label="Feature" value={detail.feature} />
                  <DetailField label="Tipo" value={detail.type} />
                  <DetailField label="Developer" value={detail.developer} />
                  <DetailField label="QA" value={detail.qa} />
                  <DetailField label="Estado" value={detail.status} />
                  <DetailField label="Prioridad" value={detail.priority} />
                  <DetailField label="Informed" value={detail.informed} />
                  <DetailField
                    label="Timeline"
                    value={
                      detail.timelineStart || detail.timelineEnd
                        ? `${detail.timelineStart ?? '—'} → ${detail.timelineEnd ?? '—'}`
                        : null
                    }
                  />
                  <DetailField
                    label="Sub Tasks (Monday)"
                    value={detail.subtasksSummary}
                    wide
                  />
                </div>

                {detail.source === 'monday' ? (
                  <div className="req-readonly-note">
                    <Icon name="lock" size={14} />
                    <span>
                      Los campos de Monday no se editan aquí. Las notas locales y los
                      mapeos sí se conservan y puedes cambiarlos.
                    </span>
                  </div>
                ) : null}
              </div>
            </section>

            <section className="req-detail-section">
              <div className="req-detail-section-head">
                <h3>
                  Repositorios{' '}
                  <span className="req-section-count">{detail.repositories.length}</span>
                </h3>
                <div className="req-section-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    title="Recalcular el estado de cada ambiente"
                    onClick={() => void loadPresence()}
                    disabled={presenceLoading}
                  >
                    {presenceLoading ? (
                      <Spinner size="sm" />
                    ) : (
                      <Icon name="refresh" size={13} />
                    )}
                    Ambientes
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setAssignOpen(true)}
                  >
                    <Icon name="plus" size={13} />
                    Asignar repositorio
                  </button>
                </div>
              </div>
              {presenceError ? (
                <p className="req-presence-note">
                  <Icon name="alert" size={12} /> {presenceError}
                </p>
              ) : null}
              {detail.repositories.length === 0 ? (
                <p className="req-empty-line">
                  Este requerimiento todavía no está mapeado a ningún repositorio.
                </p>
              ) : (
                <div className="req-repo-list">
                  {detail.repositories.map((repository) => {
                    const repoPresence = presence?.repositories.find(
                      (item) => item.repositoryId === repository.repositoryId,
                    );
                    return (
                      <div key={repository.id} className="req-repo-block">
                        <div className="req-repo-item">
                          <span className="req-repo-icon">
                            <Icon name="branch" size={14} />
                          </span>
                          <span className="req-repo-copy">
                            <strong>{repository.name}</strong>
                            <small title={repository.localPath}>
                              {repository.localPath}
                            </small>
                            <small className="req-branch-meta">
                              base {repository.baseBranch}
                              {repository.lastAnalyzedAt
                                ? ` · analizada ${formatDateTime(repository.lastAnalyzedAt)}`
                                : ''}
                            </small>
                          </span>
                          <code className="branch-name">{repository.branchName}</code>
                          <StatusChip tone={branchStatusTone(repository.branchStatus)}>
                            {branchStatusLabel(repository.branchStatus)}
                          </StatusChip>
                          <div className="req-repo-actions">
                            {repository.branchStatus === 'planned' ||
                            repository.branchStatus === 'missing' ? (
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => setBranchMapping(repository)}
                              >
                                <Icon name="branch" size={13} />
                                Crear rama
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn btn-icon btn-ghost btn-xs"
                                aria-label={`Gestionar rama de ${repository.name}`}
                                title="Conservar o recrear rama"
                                onClick={() => setBranchMapping(repository)}
                              >
                                <Icon name="branch" size={13} />
                              </button>
                            )}
                            <button
                              type="button"
                              className="btn btn-icon btn-ghost btn-xs"
                              aria-label={`Analizar rama de ${repository.name}`}
                              title="Analizar commits y archivos"
                              onClick={() => void analyzeBranch(repository)}
                              disabled={analyzingRepo === repository.repositoryId}
                            >
                              {analyzingRepo === repository.repositoryId ? (
                                <Spinner size="sm" />
                              ) : (
                                <Icon name="terminal" size={13} />
                              )}
                            </button>
                            <button
                              type="button"
                              className="btn btn-icon btn-ghost btn-xs req-repo-remove"
                              aria-label={`Desasignar ${repository.name}`}
                              title="Desasignar"
                              onClick={() =>
                                void unassign(repository.repositoryId, repository.name)
                              }
                              disabled={unassigning === repository.repositoryId}
                            >
                              {unassigning === repository.repositoryId ? (
                                <Spinner size="sm" />
                              ) : (
                                <Icon name="x" size={13} />
                              )}
                            </button>
                          </div>
                        </div>
                        {repoPresence && repoPresence.environments.length > 0 ? (
                          <div className="req-env-matrix">
                            {repoPresence.environments.map((env) => (
                              <EnvPresenceChip key={env.environment} env={env} />
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="req-detail-section">
              <div className="req-detail-section-head">
                <h3>
                  Scripts SQL{' '}
                  <span className="req-section-count">{scripts.length}</span>
                </h3>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setScriptsOpen(true)}
                >
                  <Icon name="database" size={13} />
                  Gestionar scripts
                </button>
              </div>

              {scriptsLoading ? (
                <div className="req-scripts-loading">
                  <Spinner size="sm" />
                  <span>Leyendo scripts…</span>
                </div>
              ) : scripts.length === 0 ? (
                <p className="req-empty-line">
                  No hay scripts SQL. Usa “Gestionar scripts” para agregar el primero.
                </p>
              ) : (
                <div className="req-script-list">
                  {scripts.map((script) => (
                    <button
                      key={script.id}
                      type="button"
                      className="req-script-item"
                      onClick={() => setScriptsOpen(true)}
                      title="Abrir para editar o ejecutar"
                    >
                      <span className="req-script-seq">{script.sequenceNo}</span>
                      <span className="req-script-copy">
                        <strong>{script.name}</strong>
                        <small>
                          {script.repositoryName} ·{' '}
                          {script.engine === 'sqlserver'
                            ? 'SQL Server'
                            : 'PostgreSQL'}{' '}
                          ·{' '}
                          {script.environmentScope === 'all'
                            ? 'todos los ambientes'
                            : `solo ${script.environmentScope}`}
                        </small>
                        <span
                          className="req-script-sql"
                          title={script.filePath ?? script.content ?? ''}
                        >
                          {scriptPreview(script)}
                        </span>
                      </span>
                      <code>{script.checksum.slice(0, 8)}</code>
                      <StatusChip tone={script.isActive ? 'info' : 'neutral'}>
                        {script.isActive ? 'Activo' : 'Inactivo'}
                      </StatusChip>
                      <Icon name="chevron-right" size={13} />
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="req-detail-section">
              <div className="req-detail-section-head">
                <h3>Notas locales</h3>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => void saveNotes()}
                  disabled={savingNotes || notes === (detail.notes ?? '')}
                >
                  {savingNotes ? <Spinner size="sm" /> : <Icon name="check" size={13} />}
                  Guardar notas
                </button>
              </div>
              <textarea
                className="input textarea"
                rows={3}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Contexto, enlaces o decisiones locales."
              />
            </section>

            <section
              className={`req-detail-section req-collapsible ${subitemsExpanded ? 'is-open' : ''}`}
            >
              <button
                type="button"
                className="req-collapsible-head"
                aria-expanded={subitemsExpanded}
                aria-controls="req-subitems-body"
                onClick={() => setSubitemsOpen(!subitemsExpanded)}
              >
                <span className="req-collapsible-title">
                  Subitems{' '}
                  <span className="req-section-count">{detail.subtasks.length}</span>
                </span>
                {totalSp > 0 ? (
                  <span className="req-section-meta">{totalSp} SP estimados</span>
                ) : null}
                <Icon
                  name="chevron-down"
                  size={14}
                  className="req-collapsible-chevron"
                />
              </button>

              <div
                id="req-subitems-body"
                className="req-collapsible-body"
                hidden={!subitemsExpanded}
              >
                {detail.subtasks.length === 0 ? (
                  <p className="req-empty-line">
                    {detail.subtasksSummary ?? 'Sin subitems en el export.'}
                  </p>
                ) : (
                  <div className="req-subtasks">
                    {detail.subtasks.map((subtask) => (
                      <div key={subtask.id} className="req-subtask">
                        <span className="req-subtask-name">{subtask.name}</span>
                        <span className="req-subtask-owner">
                          {subtask.owner ?? '—'}
                        </span>
                        <StatusChip
                          tone={
                            subtask.status === 'Done'
                              ? 'success'
                              : subtask.status
                                ? 'info'
                                : 'neutral'
                          }
                        >
                          {subtask.status ?? 'Sin estado'}
                        </StatusChip>
                        <span className="req-subtask-sp">
                          {subtask.estimatedSp ?? '—'} SP
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <footer className="req-detail-footer">
              <span>Creado {formatDateTime(detail.createdAt)}</span>
              <span>Actualizado {formatDateTime(detail.updatedAt)}</span>
              <span>
                Monday{' '}
                {detail.sourceUpdatedAt
                  ? formatDateTime(detail.sourceUpdatedAt)
                  : 'sin dato'}
              </span>
              <span>Visto {formatDateTime(detail.lastSeenAt)}</span>
            </footer>
          </>
        ) : null}
      </Modal>

      {assignOpen && detail ? (
        <AssignRepositoryModal
          requirement={detail}
          onClose={() => setAssignOpen(false)}
          onAssigned={() => {
            setAssignOpen(false);
            void load();
            onChanged();
            toast.success('Repositorio asignado');
          }}
        />
      ) : null}

      {branchMapping && detail ? (
        <BranchCreateModal
          requirement={detail}
          mapping={branchMapping}
          onClose={() => setBranchMapping(null)}
          onCreated={(result) => handleBranchCreated(branchMapping, result)}
        />
      ) : null}

      {analyses ? (
        <BranchAnalysisModal
          analyses={analyses}
          onClose={() => setAnalyses(null)}
        />
      ) : null}

      {scriptsOpen && detail ? (
        <RequirementScriptsModal
          requirementId={detail.id}
          requirementKey={detail.externalKey}
          repositories={detail.repositories}
          onClose={() => setScriptsOpen(false)}
          onChanged={() => {
            void loadScripts();
            onChanged();
          }}
        />
      ) : null}
    </>
  );
}

function summarizeDetail(detail: RequirementDetail): string[] {
  const people =
    detail.developer || detail.qa
      ? `${detail.developer ?? '—'} → ${detail.qa ?? '—'}`
      : null;
  return [detail.status, detail.priority, people].filter(
    (value): value is string => Boolean(value?.trim()),
  );
}

function scriptPreview(script: DbScriptSummary): string {
  const text = script.content?.trim() || script.filePath || '';
  if (!text) return 'SQL sin contenido';
  const line = text.split(/\r?\n/).find((value) => value.trim().length > 0) ?? text;
  const trimmed = line.trim();
  return trimmed.length > 110 ? `${trimmed.slice(0, 110)}…` : trimmed;
}

function branchStatusTone(
  status: string,
): 'success' | 'warning' | 'info' | 'neutral' {
  switch (status) {
    case 'created':
      return 'success';
    case 'existing':
      return 'info';
    case 'missing':
      return 'warning';
    default:
      return 'neutral';
  }
}

function branchStatusLabel(status: string): string {
  switch (status) {
    case 'created':
      return 'Creada';
    case 'existing':
      return 'Existente';
    case 'missing':
      return 'Falta';
    case 'deleted':
      return 'Borrada';
    default:
      return 'Planificada';
  }
}

const PRESENCE_LABEL: Record<EnvironmentPresence['status'], string> = {
  applied: 'aplicado',
  partial: 'parcial',
  pending: 'pendiente',
  unknown: 'sin datos',
  no_changes: 'sin cambios',
};

function presenceTooltip(env: EnvironmentPresence): string {
  const lines = [env.detail ?? PRESENCE_LABEL[env.status]];
  if (env.branch) lines.push(`Rama: ${env.branch}`);
  if (env.evidence === 'ancestry') {
    lines.push('Evidencia: el commit ya está en la rama del ambiente.');
  } else if (env.evidence === 'content') {
    lines.push('Evidencia: comparación de contenido entre ramas.');
  }
  if (env.pushedAt) {
    lines.push(
      `Última rama hija empujada: ${env.pushedBranch ?? '—'} (${formatDateTime(env.pushedAt)})`,
    );
  }
  if (env.pendingFiles.length > 0) {
    const shown = env.pendingFiles.slice(0, 6);
    lines.push(
      `Faltan: ${shown.join(', ')}${env.pendingFiles.length > shown.length ? '…' : ''}`,
    );
  }
  return lines.join('\n');
}

function EnvPresenceChip({ env }: { env: EnvironmentPresence }) {
  const counter =
    env.status === 'no_changes'
      ? '—'
      : env.status === 'unknown'
        ? '?'
        : `${env.filesApplied}/${env.filesTotal}`;
  return (
    <span
      className={`req-env-chip is-${env.status}`}
      title={presenceTooltip(env)}
    >
      <span
        className="req-env-dot"
        style={env.color ? { background: env.color } : undefined}
      />
      <strong>{env.label}</strong>
      <em>{counter}</em>
      {env.pushedAt ? <span className="req-env-pushed">↑</span> : null}
    </span>
  );
}

function DetailField({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string | null;
  wide?: boolean;
}) {
  return (
    <div className={`req-detail-field ${wide ? 'req-detail-field-wide' : ''}`}>
      <span className="req-detail-label">{label}</span>
      <span className="req-detail-value">{value?.trim() || '—'}</span>
    </div>
  );
}
