import { useCallback, useEffect, useMemo, useState } from 'react';
import { normalizeError } from '../lib/api';
import { formatDateTime, withAlpha } from '../lib/format';
import {
  archiveManualRequirement,
  getRequirementFacets,
  listRequirements,
} from '../lib/requirements';
import { listSquashSessions, abortSquash } from '../lib/squash';
import type {
  ApiError,
  RequirementDetail,
  RequirementFacets,
  RequirementListItem,
  RequirementPage,
  SquashSession,
} from '../types';
import { ImportRequirementsModal } from '../components/requirements/ImportRequirementsModal';
import { ManualRequirementModal } from '../components/requirements/ManualRequirementModal';
import { RequirementDetailModal } from '../components/requirements/RequirementDetailModal';
import { DeploymentWizardModal } from '../components/requirements/DeploymentWizardModal';
import { SquashWizardModal } from '../components/requirements/SquashWizardModal';
import { Callout } from '../components/ui/Callout';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { EmptyState } from '../components/ui/EmptyState';
import { Icon } from '../components/ui/Icon';
import { SearchableSelect } from '../components/ui/SearchableSelect';
import { Spinner } from '../components/ui/Spinner';
import { StatusChip } from '../components/ui/StatusChip';
import { toast } from '../components/ui/Toast';
import '../requirements.css';

const PAGE_SIZE = 50;
const MY_DEVELOPER_KEY = 'flowmanager.myDeveloper';

interface ArchiveTarget {
  id: string;
  externalKey: string;
  title: string;
}

export function RequirementsView() {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [source, setSource] = useState('');
  const [developer, setDeveloper] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [feature, setFeature] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);
  const [myDeveloper, setMyDeveloper] = useState(
    () => localStorage.getItem(MY_DEVELOPER_KEY) ?? '',
  );
  const [page, setPage] = useState(1);

  const [data, setData] = useState<RequirementPage | null>(null);
  const [facets, setFacets] = useState<RequirementFacets | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  const [importOpen, setImportOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [editingRequirement, setEditingRequirement] =
    useState<RequirementDetail | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<ArchiveTarget | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [squashOpen, setSquashOpen] = useState(false);
  const [squashSessions, setSquashSessions] = useState<SquashSession[]>([]);
  const [selected, setSelected] = useState<Map<string, string>>(new Map());
  const [deployOpen, setDeployOpen] = useState(false);
  const [deployRequirementIds, setDeployRequirementIds] = useState<string[]>([]);
  const [deployInitialSessions, setDeployInitialSessions] =
    useState<SquashSession[]>([]);
  const [deploymentToCancel, setDeploymentToCancel] = useState<
    SquashSession[] | null
  >(null);
  const [cancellingDeployment, setCancellingDeployment] = useState(false);
  const [squashToDiscard, setSquashToDiscard] = useState<SquashSession[] | null>(
    null,
  );
  const [discardingSquash, setDiscardingSquash] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const filter = useMemo(
    () => ({
      search: search || undefined,
      source: source || undefined,
      developers: onlyMine
        ? myDeveloper
          ? [myDeveloper]
          : undefined
        : developer
          ? [developer]
          : undefined,
      status: status || undefined,
      priority: priority || undefined,
      feature: feature || undefined,
      includeArchived,
    }),
    [
      search,
      source,
      developer,
      onlyMine,
      myDeveloper,
      status,
      priority,
      feature,
      includeArchived,
    ],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const loaded = await listRequirements(filter, page, PAGE_SIZE);
      setData(loaded);
      setError(null);
    } catch (caught) {
      setError(normalizeError(caught));
    } finally {
      setLoading(false);
    }
  }, [filter, page]);

  const loadFacets = useCallback(async () => {
    try {
      setFacets(await getRequirementFacets());
    } catch {
      // Los filtros de facets son opcionales; la tabla sigue funcionando.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadFacets();
  }, [loadFacets]);

  const loadSquashSessions = useCallback(async () => {
    try {
      setSquashSessions(await listSquashSessions());
    } catch {
      // El banner de squash es auxiliar.
    }
  }, []);

  useEffect(() => {
    void loadSquashSessions();
  }, [loadSquashSessions]);

  const deploymentSessions = squashSessions.filter(
    (session) => session.environment && session.status !== 'aborted',
  );
  const deployConflictSessions = deploymentSessions.filter(
    (session) => session.status === 'conflict',
  );
  // Un despliegue empujado sigue con status 'ready', pero ya no está pendiente.
  const deployPendingSessions = deploymentSessions.filter(
    (session) =>
      !session.pushedSha &&
      session.status !== 'no_changes' &&
      session.status !== 'conflict',
  );
  const deployReadySessions = deployPendingSessions.filter(
    (session) => session.status === 'ready',
  );
  // Para reanudar/descartar: pendientes y conflictos, nunca lo ya empujado.
  const deployResumeSessions = deploymentSessions.filter(
    (session) =>
      session.status === 'conflict' || (session.status === 'ready' && !session.pushedSha),
  );
  const squashConflictSessions = squashSessions.filter(
    (session) => session.status === 'conflict' && !session.environment,
  );
  const readySessions = squashSessions.filter(
    (session) =>
      session.status === 'ready' && !session.environment && session.phase === 'squash',
  );

  const pageSelectable = (data?.items ?? []).filter(
    (item) => !item.archivedAt && item.repoCount > 0,
  );
  const allPageSelected =
    pageSelectable.length > 0 &&
    pageSelectable.every((item) => selected.has(item.id));
  const somePageSelected = pageSelectable.some((item) => selected.has(item.id));

  function toggleSelected(item: RequirementListItem) {
    if (item.archivedAt || item.repoCount === 0) return;
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(item.id)) next.delete(item.id);
      else next.set(item.id, item.externalKey);
      return next;
    });
  }

  function togglePageSelected() {
    setSelected((current) => {
      const next = new Map(current);
      if (allPageSelected) {
        pageSelectable.forEach((item) => next.delete(item.id));
      } else {
        pageSelectable.forEach((item) => next.set(item.id, item.externalKey));
      }
      return next;
    });
  }

  function openDeployment(requirementIds: string[]) {
    setDeployRequirementIds(requirementIds);
    setDeployInitialSessions([]);
    setDeployOpen(true);
  }

  function openDeploymentFor(item: RequirementListItem) {
    if (item.archivedAt) return;
    if (item.repoCount === 0) {
      toast.info('Este requerimiento no tiene repositorios', {
        description:
          'Asigna al menos un repositorio antes de preparar el despliegue.',
      });
      return;
    }
    openDeployment([item.id]);
  }

  function resumeDeployment() {
    const active = deployResumeSessions;
    const ids = Array.from(
      new Set(
        active.flatMap((session) =>
          session.selectedRequirements.map((requirement) => requirement.id),
        ),
      ),
    );
    setDeployRequirementIds(ids);
    setDeployInitialSessions(active);
    setDeployOpen(true);
  }

  async function confirmCancelDeployment() {
    if (!deploymentToCancel) return;
    setCancellingDeployment(true);
    let failed = 0;
    for (const session of deploymentToCancel) {
      if (session.status === 'aborted' || session.pushedSha) continue;
      try {
        await abortSquash(session.id);
      } catch {
        failed += 1;
      }
    }
    setDeploymentToCancel(null);
    await loadSquashSessions();
    setCancellingDeployment(false);
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
  }

  async function confirmDiscardSquash() {
    if (!squashToDiscard) return;
    setDiscardingSquash(true);
    let failed = 0;
    for (const session of squashToDiscard) {
      if (session.status === 'aborted') continue;
      try {
        await abortSquash(session.id);
      } catch {
        failed += 1;
      }
    }
    setSquashToDiscard(null);
    await loadSquashSessions();
    setDiscardingSquash(false);
    if (failed > 0) {
      toast.warning('Squash descartado parcialmente', {
        description: `${failed} sesión(es) no se pudieron limpiar. Revisa el detalle en Squash.`,
      });
    } else {
      toast.success('Squash descartado', {
        description:
          'Se eliminaron los worktrees y las ramas internas. Tus ramas de requerimiento no se tocaron.',
      });
    }
  }

  function rememberMyDeveloper(value: string) {
    setMyDeveloper(value);
    if (value) localStorage.setItem(MY_DEVELOPER_KEY, value);
    else localStorage.removeItem(MY_DEVELOPER_KEY);
    if (onlyMine && !value) setOnlyMine(false);
  }

  function toggleOnlyMine() {
    if (!myDeveloper) {
      toast.info('Primero elige tu nombre en "Yo soy"', {
        description:
          'Así FlowManager sabe qué requerimientos marcar como tuyos.',
      });
      return;
    }
    setOnlyMine((value) => !value);
    setPage(1);
  }

  function clearFilters() {
    setSearchInput('');
    setSearch('');
    setSource('');
    setDeveloper('');
    setStatus('');
    setPriority('');
    setFeature('');
    setIncludeArchived(false);
    setOnlyMine(false);
    setPage(1);
  }

  async function refreshAll() {
    await Promise.all([load(), loadFacets()]);
  }

  async function confirmArchive() {
    if (!archiveTarget) return;
    setArchiving(true);
    try {
      await archiveManualRequirement(archiveTarget.id);
      setArchiveTarget(null);
      setDetailId(null);
      setSelected((current) => {
        const next = new Map(current);
        next.delete(archiveTarget.id);
        return next;
      });
      await refreshAll();
      toast.success('Requerimiento archivado', {
        description: 'Puedes verlo activando "Ver archivados".',
      });
    } catch (caught) {
      const apiError = normalizeError(caught);
      toast.error('No se pudo archivar', { description: apiError.message });
    } finally {
      setArchiving(false);
    }
  }

  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const start = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(total, page * PAGE_SIZE);
  const hasFilters = Boolean(
    search ||
      source ||
      developer ||
      status ||
      priority ||
      feature ||
      includeArchived ||
      onlyMine,
  );

  return (
    <div className="requirements">
      <div className="requirements-toolbar">
        <div className="requirements-count">
          <strong>{total}</strong>
          <span>requerimiento(s)</span>
          {facets ? (
            <span className="requirements-count-detail">
              {facets.developers.length} developers · {facets.features.length} features
            </span>
          ) : null}
        </div>
        <div className="requirements-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setSquashOpen(true)}
          >
            <Icon name="package" size={15} />
            Squash
            {squashConflictSessions.length +
            deployConflictSessions.length +
            readySessions.length ? (
              <span
                className="req-action-badge"
                title="Sesiones de squash activas o en conflicto"
              >
                {squashConflictSessions.length +
                  deployConflictSessions.length +
                  readySessions.length}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setImportOpen(true)}
          >
            <Icon name="package" size={15} />
            Importar Monday
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setEditingRequirement(null);
              setManualOpen(true);
            }}
          >
            <Icon name="plus" size={15} />
            Nuevo requerimiento
          </button>
        </div>
      </div>

      {deployConflictSessions.length > 0 ? (
        <Callout
          tone="warning"
          title="Hay un despliegue en conflicto"
          action={
            <div className="req-banner-actions">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={resumeDeployment}
              >
                Reanudar
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setDeploymentToCancel(deployResumeSessions)}
              >
                Descartar
              </button>
            </div>
          }
        >
          {deployConflictSessions.length} repositorio(s) esperando resolución de
          archivos. El worktree quedó aislado; tu copia principal no se tocó.
        </Callout>
      ) : squashConflictSessions.length > 0 ? (
        <Callout
          tone="warning"
          title="Hay un squash en conflicto"
          action={
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setSquashOpen(true)}
            >
              Reanudar
            </button>
          }
        >
          {squashConflictSessions.length} sesión(es) esperando resolución de archivos.
          El worktree quedó aislado; tu copia principal no se tocó.
        </Callout>
      ) : deployReadySessions.length > 0 ? (
        <Callout
          tone="success"
          title="Despliegue pendiente"
          action={
            <div className="req-banner-actions">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={resumeDeployment}
              >
                Reanudar
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setDeploymentToCancel(deployResumeSessions)}
              >
                Descartar
              </button>
            </div>
          }
        >
          {deployReadySessions.length} repositorio(s) con cambios preparados. Reanuda
          para crear la rama hija o empujarla. Recuerda que el merge al ambiente se hace
          manualmente en GitHub.
        </Callout>
      ) : readySessions.length > 0 ? (
        <Callout
          tone="success"
          title="Squash de vista previa listo"
          action={
            <div className="req-banner-actions">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setSquashOpen(true)}
              >
                Ver sesión
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setSquashToDiscard(readySessions)}
              >
                Descartar
              </button>
            </div>
          }
        >
          Hay {readySessions.length} squash listo(s). Es una vista previa del unificado: no
          crea la rama del ambiente ni despliega nada. Para desplegar, selecciona los
          requerimientos y usa “Preparar despliegue”.
        </Callout>
      ) : null}

      <section className="surface req-filter-bar" aria-label="Filtros">
        <div className="req-filter-row">
          <div className="req-search">
            <Icon name="search" size={14} />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Buscar por Task ID, título o feature"
              aria-label="Buscar requerimientos"
              autoComplete="off"
            />
            {searchInput ? (
              <button
                type="button"
                className="search-clear"
                onClick={() => setSearchInput('')}
                aria-label="Limpiar búsqueda"
              >
                <Icon name="x" size={12} />
              </button>
            ) : null}
          </div>

          <select
            className="input req-select"
            value={source}
            onChange={(event) => {
              setSource(event.target.value);
              setPage(1);
            }}
            aria-label="Origen"
            autoComplete="off"
          >
            <option value="">Todos los orígenes</option>
            <option value="monday">Monday</option>
            <option value="manual">Manual</option>
          </select>

          <select
            className="input req-select"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
            aria-label="Estado"
            autoComplete="off"
          >
            <option value="">Todos los estados</option>
            {facets?.statuses.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>

          <select
            className="input req-select"
            value={priority}
            onChange={(event) => {
              setPriority(event.target.value);
              setPage(1);
            }}
            aria-label="Prioridad"
            autoComplete="off"
          >
            <option value="">Todas las prioridades</option>
            {facets?.priorities.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>

          <button
            type="button"
            className={`btn btn-sm ${hasFilters ? 'btn-secondary' : 'btn-ghost'}`}
            onClick={clearFilters}
            disabled={!hasFilters}
          >
            <Icon name="x" size={13} />
            Limpiar
          </button>
        </div>

        <div className="req-filter-row req-filter-row-secondary">
          <select
            className="input req-select req-select-wide"
            value={developer}
            onChange={(event) => {
              setDeveloper(event.target.value);
              setPage(1);
            }}
            disabled={onlyMine}
            aria-label="Developer"
            autoComplete="off"
          >
            <option value="">Todos los developers</option>
            {facets?.developers.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>

          <SearchableSelect
            className="searchable-select-wide"
            value={feature}
            options={facets?.features ?? []}
            onChange={(value) => {
              setFeature(value);
              setPage(1);
            }}
            allLabel="Todas las features"
            ariaLabel="Feature"
          />

          <label className="req-my-developer">
            <span>Yo soy</span>
            <select
              className="input req-select req-select-wide"
              value={myDeveloper}
              onChange={(event) => rememberMyDeveloper(event.target.value)}
              aria-label="Mi developer"
              autoComplete="off"
            >
              <option value="">Selecciona tu nombre</option>
              {facets?.developers.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className={`btn btn-sm ${onlyMine ? 'btn-primary' : 'btn-secondary'}`}
            onClick={toggleOnlyMine}
            aria-pressed={onlyMine}
          >
            <Icon name="eye" size={13} />
            Solo mis requerimientos
          </button>

          <label className="checkbox-row checkbox-row-compact">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(event) => {
                setIncludeArchived(event.target.checked);
                setPage(1);
              }}
            />
            <span>Incluir requerimientos archivados</span>
          </label>
        </div>
      </section>

      {error ? (
        <Callout
          tone="danger"
          title="No pudimos leer los requerimientos"
          action={
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void load()}>
              Reintentar
            </button>
          }
        >
          {error.message}
        </Callout>
      ) : null}

      {selected.size > 0 ? (
        <section className="surface req-bulk-bar" aria-label="Selección de requerimientos">
          <Icon name="layers" size={15} />
          <strong>{selected.size} seleccionado(s)</strong>
          <span>para desplegar</span>
          <div className="req-bulk-keys">
            {Array.from(selected.values())
              .slice(0, 8)
              .map((externalKey) => (
                <code key={externalKey}>{externalKey}</code>
              ))}
            {selected.size > 8 ? <span>+{selected.size - 8}</span> : null}
          </div>
          <div className="req-bulk-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setSelected(new Map())}
            >
              Limpiar
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => openDeployment(Array.from(selected.keys()))}
            >
              <Icon name="rocket" size={13} />
              Preparar despliegue
            </button>
          </div>
        </section>
      ) : null}

      <section className="surface req-table-panel">
        {loading && !data ? (
          <div className="loading-panel">
            <Spinner size="lg" label="Leyendo requerimientos…" />
          </div>
        ) : data && data.items.length === 0 ? (
          <EmptyState
            icon={<Icon name="list" size={26} />}
            title={hasFilters ? 'No hay resultados' : 'Todavía no hay requerimientos'}
            description={
              hasFilters
                ? 'Prueba con otro filtro o limpia la búsqueda.'
                : 'Importa el export de Monday o registra un requerimiento manual para empezar.'
            }
            action={
              hasFilters ? (
                <button type="button" className="btn btn-secondary" onClick={clearFilters}>
                  Limpiar filtros
                </button>
              ) : (
                <div className="req-empty-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setImportOpen(true)}
                  >
                    <Icon name="package" size={14} />
                    Importar Monday
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setEditingRequirement(null);
                      setManualOpen(true);
                    }}
                  >
                    <Icon name="plus" size={14} />
                    Nuevo manual
                  </button>
                </div>
              )
            }
          />
        ) : data ? (
          <>
            <div className="req-table-wrap">
              <table className="req-table">
                <thead>
                  <tr>
                    <th className="req-select-col">
                      <input
                        type="checkbox"
                        aria-label="Seleccionar todos los requerimientos de esta página"
                        checked={allPageSelected}
                        ref={(element) => {
                          if (element) {
                            element.indeterminate = somePageSelected && !allPageSelected;
                          }
                        }}
                        onChange={togglePageSelected}
                        disabled={pageSelectable.length === 0}
                      />
                    </th>
                    <th>Task ID</th>
                    <th>Origen</th>
                    <th>Título</th>
                    <th className="req-col-feature">Feature</th>
                    <th className="req-col-type">Tipo</th>
                    <th>Developer</th>
                    <th>Estado</th>
                    <th>Prioridad</th>
                    <th className="req-col-center">Repos</th>
                    <th className="req-col-updated">Actualizado</th>
                    <th aria-label="Acciones" />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <RequirementRow
                      key={item.id}
                      item={item}
                      selected={selected.has(item.id)}
                      onToggle={() => toggleSelected(item)}
                      onDeploy={() => openDeploymentFor(item)}
                      onOpen={() => setDetailId(item.id)}
                      onArchive={() =>
                        setArchiveTarget({
                          id: item.id,
                          externalKey: item.externalKey,
                          title: item.title,
                        })
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <footer className="req-pagination">
              <span>
                {start}–{end} de {total}
              </span>
              <div className="req-pagination-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                  disabled={page <= 1 || loading}
                >
                  Anterior
                </button>
                <span className="req-pagination-page">
                  {page} / {pageCount}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
                  disabled={page >= pageCount || loading}
                >
                  Siguiente
                </button>
              </div>
            </footer>
          </>
        ) : null}
      </section>

      {importOpen ? (
        <ImportRequirementsModal
          onClose={() => setImportOpen(false)}
          onImported={(result) => {
            setImportOpen(false);
            void refreshAll();
            toast.success('Importación completada', {
              description: `${result.created} nuevos, ${result.updated} actualizados, ${result.unchanged} sin cambios${
                result.skippedManual ? `, ${result.skippedManual} manuales omitidos` : ''
              }.`,
            });
          }}
        />
      ) : null}

      {squashOpen ? (
        <SquashWizardModal
          onClose={() => {
            setSquashOpen(false);
            void loadSquashSessions();
          }}
          onChanged={() => void loadSquashSessions()}
        />
      ) : null}

      {deployOpen ? (
        <DeploymentWizardModal
          key={`${deployRequirementIds.join('|')}::${deployInitialSessions
            .map((session) => session.id)
            .join('|')}`}
          requirementIds={deployRequirementIds}
          initialSessions={deployInitialSessions}
          onClose={() => {
            setDeployOpen(false);
            setDeployInitialSessions([]);
            void loadSquashSessions();
          }}
          onChanged={() => void loadSquashSessions()}
          onFinished={() => {
            setDeployOpen(false);
            setDeployInitialSessions([]);
            setSelected(new Map());
            void loadSquashSessions();
            toast.success('Despliegue preparado', {
              description:
                'Solo queda crear el pull request hacia la rama del ambiente en GitHub.',
            });
          }}
        />
      ) : null}

      {manualOpen || editingRequirement ? (
        <ManualRequirementModal
          requirement={editingRequirement}
          onClose={() => {
            setManualOpen(false);
            setEditingRequirement(null);
          }}
          onSaved={(saved) => {
            setManualOpen(false);
            setEditingRequirement(null);
            setDetailId(saved.id);
            void refreshAll();
            toast.success(
              editingRequirement ? 'Requerimiento actualizado' : 'Requerimiento creado',
              { description: saved.externalKey },
            );
          }}
        />
      ) : null}

      {detailId ? (
        <RequirementDetailModal
          requirementId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={() => void refreshAll()}
          onEdit={(detail) => {
            setDetailId(null);
            setEditingRequirement(detail);
          }}
          onArchive={(detail) => {
            setDetailId(null);
            setArchiveTarget({
              id: detail.id,
              externalKey: detail.externalKey,
              title: detail.title,
            });
          }}
        />
      ) : null}

      {deploymentToCancel ? (
        <ConfirmModal
          title="Descartar despliegue"
          message={`Se limpiarán ${deploymentToCancel.filter((session) => session.status !== 'aborted').length} sesión(es): worktrees y ramas locales. Las ramas que ya se empujaron no se borran del remoto. Esta acción no modifica el ambiente.`}
          confirmLabel="Descartar despliegue"
          tone="danger"
          busy={cancellingDeployment}
          onConfirm={() => void confirmCancelDeployment()}
          onClose={() => setDeploymentToCancel(null)}
        />
      ) : null}

      {squashToDiscard ? (
        <ConfirmModal
          title="Descartar squash"
          message={`Se eliminarán ${squashToDiscard.filter((session) => session.status !== 'aborted').length} sesión(es) de squash: worktrees y ramas internas. Tus ramas de requerimiento y el remoto no se tocan; ningún ambiente se modifica.`}
          confirmLabel="Descartar squash"
          tone="danger"
          busy={discardingSquash}
          onConfirm={() => void confirmDiscardSquash()}
          onClose={() => setSquashToDiscard(null)}
        />
      ) : null}

      {archiveTarget ? (
        <ConfirmModal
          title="Archivar requerimiento"
          message={`"${archiveTarget.externalKey} · ${archiveTarget.title}" dejará de aparecer en la lista activa. El historial y los mapeos se conservan.`}
          confirmLabel="Archivar"
          tone="danger"
          busy={archiving}
          onConfirm={() => void confirmArchive()}
          onClose={() => setArchiveTarget(null)}
        />
      ) : null}
    </div>
  );
}

function RequirementRow({
  item,
  selected,
  onToggle,
  onDeploy,
  onOpen,
  onArchive,
}: {
  item: RequirementListItem;
  selected: boolean;
  onToggle: () => void;
  onDeploy: () => void;
  onOpen: () => void;
  onArchive: () => void;
}) {
  const deployable = !item.archivedAt && item.repoCount > 0;
  return (
    <tr className={`${item.archivedAt ? 'is-archived' : ''} ${selected ? 'is-selected' : ''}`.trim()}>
      <td className="req-select-col">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          disabled={!deployable}
          title={
            deployable
              ? undefined
              : 'Asigna al menos un repositorio para poder desplegar'
          }
          aria-label={`Seleccionar ${item.externalKey}`}
        />
      </td>
      <td>
        <button type="button" className="req-key" onClick={onOpen}>
          {item.externalKey}
        </button>
      </td>
      <td>
        <StatusChip tone={item.source === 'manual' ? 'info' : 'neutral'}>
          {item.source === 'manual' ? 'Manual' : 'Monday'}
        </StatusChip>
        {!item.lastImportPresent && item.source === 'monday' ? (
          <span className="req-absent" title="No estaba en la última importación">
            <Icon name="alert" size={12} />
          </span>
        ) : null}
      </td>
      <td>
        <button type="button" className="req-title" onClick={onOpen} title={item.title}>
          {item.title}
        </button>
      </td>
      <td className="req-col-feature">
        <span className="req-truncate" title={item.feature ?? ''}>
          {item.feature ?? '—'}
        </span>
      </td>
      <td className="req-col-type">{item.type ?? '—'}</td>
      <td>
        <span className="req-truncate" title={item.developer ?? ''}>
          {item.developer ?? '—'}
        </span>
      </td>
      <td>
        <StatusChip tone={statusTone(item.status)}>
          {item.status ?? '—'}
        </StatusChip>
      </td>
      <td>
        <span
          className="req-priority"
          style={
            priorityColor(item.priority)
              ? {
                  color: priorityColor(item.priority) ?? undefined,
                  background: withAlpha(priorityColor(item.priority) ?? '#7c8cff', 0.1),
                  borderColor: withAlpha(priorityColor(item.priority) ?? '#7c8cff', 0.25),
                }
              : undefined
          }
        >
          {item.priority ?? '—'}
        </span>
      </td>
      <td className="req-col-center">
        <span className="req-repo-count">{item.repoCount}</span>
      </td>
      <td className="req-col-updated">
        <span className="req-date">{formatDateTime(item.updatedAt)}</span>
      </td>
      <td>
        <div className="req-row-actions">
          <button
            type="button"
            className="btn btn-icon btn-ghost btn-xs req-deploy"
            aria-label={`Desplegar ${item.externalKey}`}
            title={
              deployable
                ? 'Preparar despliegue para este requerimiento'
                : 'Asigna al menos un repositorio para desplegar'
            }
            onClick={onDeploy}
            disabled={!deployable}
          >
            <Icon name="rocket" size={13} />
          </button>
          <button
            type="button"
            className="btn btn-icon btn-ghost btn-xs"
            aria-label={`Abrir ${item.externalKey}`}
            title="Abrir detalle"
            onClick={onOpen}
          >
            <Icon name="eye" size={13} />
          </button>
          {item.source === 'manual' && !item.archivedAt ? (
            <button
              type="button"
              className="btn btn-icon btn-ghost btn-xs req-archive"
              aria-label={`Archivar ${item.externalKey}`}
              title="Archivar"
              onClick={onArchive}
            >
              <Icon name="trash" size={13} />
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function statusTone(status: string | null): 'success' | 'warning' | 'info' | 'neutral' {
  if (!status) return 'neutral';
  if (status === 'QA Done' || status === 'Done') return 'success';
  if (status.includes('Review') || status.includes('QA')) return 'info';
  if (status.includes('Progress') || status.includes('Validation')) return 'warning';
  return 'neutral';
}

function priorityColor(priority: string | null): string | null {
  switch (priority) {
    case 'Critical':
      return '#f87171';
    case 'High':
      return '#f5b84b';
    case 'Medium':
      return '#7c8cff';
    case 'Low':
      return '#3dd68c';
    default:
      return null;
  }
}
