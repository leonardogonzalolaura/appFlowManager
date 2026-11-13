import { useEffect, useState } from 'react';
import { normalizeError } from '../../lib/api';
import { listDbScripts } from '../../lib/database';
import { openExternalUrl } from '../../lib/external';
import { formatDateTime } from '../../lib/format';
import { mondayItemUrl } from '../../lib/monday';
import { getEnvironmentStatus } from '../../lib/presence';
import {
  getRequirement,
  updateManualRequirement,
} from '../../lib/requirements';
import type {
  ApiError,
  DbScriptSummary,
  NoteLevel,
  RequirementDetail,
  RequirementPresence,
} from '../../types';
import { Callout } from '../ui/Callout';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';
import { StatusChip } from '../ui/StatusChip';
import { Tabs, type TabItem } from '../ui/Tabs';
import { toast } from '../ui/Toast';
import { RequirementNotesTab } from './RequirementNotesTab';
import { RequirementOverviewTab } from './RequirementOverviewTab';
import { RequirementRepositoriesTab } from './RequirementRepositoriesTab';
import { RequirementScriptsTab } from './RequirementScriptsTab';
import {
  noteLevelMeta,
  repositoryNeedsAttention,
} from './RequirementDetailShared';

interface RequirementDetailModalProps {
  requirementId: string;
  mondaySubdomain: string;
  onClose: () => void;
  onChanged: () => void;
  onEdit: (requirement: RequirementDetail) => void;
  onArchive: (requirement: RequirementDetail) => void;
}

type DetailTab = 'overview' | 'repositories' | 'scripts' | 'notes';

const TAB_PREFIX = 'req-detail';

export function RequirementDetailModal({
  requirementId,
  mondaySubdomain,
  onClose,
  onChanged,
  onEdit,
  onArchive,
}: RequirementDetailModalProps) {
  const [detail, setDetail] = useState<RequirementDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [notes, setNotes] = useState('');
  const [noteLevel, setNoteLevel] = useState<NoteLevel>('info');
  const [savingNotes, setSavingNotes] = useState(false);
  const [tab, setTab] = useState<DetailTab>('overview');
  const [scripts, setScripts] = useState<DbScriptSummary[]>([]);
  const [scriptsLoading, setScriptsLoading] = useState(true);
  const [presence, setPresence] = useState<RequirementPresence | null>(null);
  const [presenceLoading, setPresenceLoading] = useState(false);
  const [presenceError, setPresenceError] = useState<string | null>(null);

  async function loadPresence(force = false) {
    setPresenceLoading(true);
    try {
      const [loaded] = await getEnvironmentStatus([requirementId], force);
      setPresence(loaded ?? null);
      setPresenceError(null);
    } catch (caught) {
      setPresenceError(normalizeError(caught).message);
    } finally {
      setPresenceLoading(false);
    }
  }

  async function loadScripts(silent = false) {
    if (!silent) setScriptsLoading(true);
    try {
      setScripts(await listDbScripts({ requirementId }));
    } catch {
      if (!silent) setScripts([]);
    } finally {
      if (!silent) setScriptsLoading(false);
    }
  }

  /**
   * `silent` refresca los datos sin desmontar el cuerpo del modal. Necesario
   * para no perder el estado local de las pestañas (análisis de ramas, modales
   * abiertos y borradores de notas) cuando una acción recarga el requerimiento.
   */
  async function load(options: { silent?: boolean } = {}) {
    const silent = options.silent ?? false;
    if (!silent) setLoading(true);
    try {
      const loaded = await getRequirement(requirementId);
      const keepDraft =
        silent &&
        detail !== null &&
        (notes !== (detail.notes ?? '') ||
          noteLevel !== (detail.noteLevel ?? 'info'));
      setDetail(loaded);
      if (!keepDraft) {
        setNotes(loaded.notes ?? '');
        setNoteLevel(loaded.noteLevel ?? 'info');
      }
      setError(null);
      void loadScripts(silent);
      void loadPresence();
    } catch (caught) {
      const apiError = normalizeError(caught);
      if (silent) {
        toast.error('No se pudo actualizar el requerimiento', {
          description: apiError.message,
        });
      } else {
        setError(apiError);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    setTab('overview');
    setPresence(null);
    setPresenceError(null);
    setNotes('');
    setNoteLevel('info');
    setScripts([]);
    setScriptsLoading(true);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requirementId]);

  useEffect(() => {
    const body = document.querySelector<HTMLElement>(
      '.req-detail-modal .modal-body',
    );
    if (body) body.scrollTop = 0;
  }, [tab, requirementId]);

  async function saveNotes() {
    if (!detail) return;
    setSavingNotes(true);
    try {
      const updated = await updateManualRequirement(detail.id, {
        notes,
        noteLevel,
      });
      setDetail(updated);
      setNotes(updated.notes ?? '');
      setNoteLevel(updated.noteLevel ?? 'info');
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

  const savedNotes = Boolean(detail?.notes?.trim());
  const noteMeta = noteLevelMeta(detail?.noteLevel ?? noteLevel);
  const notesDirty = detail
    ? notes !== (detail.notes ?? '') ||
      noteLevel !== (detail.noteLevel ?? 'info')
    : false;
  const repositoriesWarning =
    detail?.repositories.some((repository) =>
      repositoryNeedsAttention(repository.branchStatus),
    ) ?? false;

  const tabItems: TabItem[] = detail
    ? [
        { id: 'overview', label: 'Resumen', icon: 'list' },
        {
          id: 'repositories',
          label: 'Repositorios',
          icon: 'branch',
          count: detail.repositories.length,
          tone: repositoriesWarning ? 'warning' : 'accent',
        },
        {
          id: 'scripts',
          label: 'Scripts SQL',
          icon: 'database',
          count: scriptsLoading ? undefined : scripts.length,
        },
        {
          id: 'notes',
          label: 'Notas',
          icon: 'file',
          tone: savedNotes ? detail.noteLevel : 'accent',
          dot: savedNotes,
          dotLabel: savedNotes
            ? `Nivel de la nota: ${noteMeta.label}`
            : undefined,
        },
      ]
    : [];

  return (
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
      className="req-detail-modal"
      badge={
        detail ? (
          <>
            <StatusChip tone={detail.source === 'manual' ? 'info' : 'neutral'}>
              {detail.source === 'manual' ? 'Manual' : 'Monday'}
            </StatusChip>
            {detail.archivedAt ? (
              <StatusChip tone="warning">Archivado</StatusChip>
            ) : null}
            {savedNotes ? (
              <StatusChip tone={noteMeta.tone}>
                <Icon name={noteMeta.icon} size={11} />
                {noteMeta.shortLabel}
              </StatusChip>
            ) : null}
          </>
        ) : undefined
      }
      onClose={onClose}
      footer={
        <>
          {detail?.source === 'monday' ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() =>
                void openExternalUrl(
                  mondayItemUrl(detail.externalKey, mondaySubdomain),
                  'msedge',
                )
              }
            >
              <Icon name="external" size={14} />
              Abrir en Monday
            </button>
          ) : null}
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
          <Tabs
            className="req-tabs"
            items={tabItems}
            value={tab}
            onChange={(next) => setTab(next as DetailTab)}
            idPrefix={TAB_PREFIX}
            ariaLabel="Secciones del requerimiento"
          />

          <div
            className="req-tab-panel"
            role="tabpanel"
            id={`${TAB_PREFIX}-panel-overview`}
            aria-labelledby={`${TAB_PREFIX}-tab-overview`}
            tabIndex={0}
            hidden={tab !== 'overview'}
          >
            <RequirementOverviewTab detail={detail} />
          </div>

          <div
            className="req-tab-panel"
            role="tabpanel"
            id={`${TAB_PREFIX}-panel-repositories`}
            aria-labelledby={`${TAB_PREFIX}-tab-repositories`}
            tabIndex={0}
            hidden={tab !== 'repositories'}
          >
            <RequirementRepositoriesTab
              detail={detail}
              presence={presence}
              presenceLoading={presenceLoading}
              presenceError={presenceError}
              onRefreshPresence={() => void loadPresence(true)}
              onRefreshDetail={() => load({ silent: true })}
              onChanged={onChanged}
            />
          </div>

          <div
            className="req-tab-panel"
            role="tabpanel"
            id={`${TAB_PREFIX}-panel-scripts`}
            aria-labelledby={`${TAB_PREFIX}-tab-scripts`}
            tabIndex={0}
            hidden={tab !== 'scripts'}
          >
            <RequirementScriptsTab
              detail={detail}
              scripts={scripts}
              loading={scriptsLoading}
              onRefreshScripts={() => void loadScripts()}
              onChanged={onChanged}
            />
          </div>

          <div
            className="req-tab-panel"
            role="tabpanel"
            id={`${TAB_PREFIX}-panel-notes`}
            aria-labelledby={`${TAB_PREFIX}-tab-notes`}
            tabIndex={0}
            hidden={tab !== 'notes'}
          >
            <RequirementNotesTab
              notes={notes}
              noteLevel={noteLevel}
              saving={savingNotes}
              dirty={notesDirty}
              onNotesChange={setNotes}
              onNoteLevelChange={setNoteLevel}
              onSave={() => void saveNotes()}
            />
          </div>

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
  );
}
