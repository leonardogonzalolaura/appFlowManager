import { useMemo, useState } from 'react';
import { normalizeError } from '../../lib/api';
import { formatDateTime, shortSha, withAlpha } from '../../lib/format';
import { setEnvironment } from '../../lib/repositories';
import type {
  ApiError,
  EnvironmentState,
  RepositoryDetail,
  ResolutionMode,
} from '../../types';
import { Callout } from '../ui/Callout';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';
import { StatusChip } from '../ui/StatusChip';

interface BranchPickerModalProps {
  repository: RepositoryDetail;
  environment: EnvironmentState;
  onClose: () => void;
  onSaved: (repository: RepositoryDetail) => void;
}

export function BranchPickerModal({
  repository,
  environment,
  onClose,
  onSaved,
}: BranchPickerModalProps) {
  const [mode, setMode] = useState<ResolutionMode>(environment.mode);
  const [selected, setSelected] = useState<string | null>(environment.branchName);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const otherUsage = useMemo(() => {
    const usage = new Map<string, string>();
    repository.environments.forEach((item) => {
      if (
        item.environment !== environment.environment &&
        item.branchName &&
        item.branchName !== environment.branchName
      ) {
        usage.set(item.branchName.toLowerCase(), item.label);
      }
    });
    return usage;
  }, [repository.environments, environment]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return repository.branches;
    return repository.branches.filter(
      (branch) =>
        branch.name.toLowerCase().includes(term) ||
        (branch.message ?? '').toLowerCase().includes(term) ||
        (branch.author ?? '').toLowerCase().includes(term),
    );
  }, [repository.branches, search]);

  async function save() {
    if (mode === 'manual' && !selected) {
      setError({
        code: 'VALIDATION',
        message: 'Selecciona una rama de la lista o usa la detección automática.',
        retryable: false,
      });
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const updated = await setEnvironment({
        repositoryId: repository.id,
        environment: environment.environment,
        mode,
        branchName: mode === 'manual' ? selected ?? undefined : undefined,
      });
      onSaved(updated);
    } catch (caught) {
      setError(normalizeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Rama para ${environment.label}`}
      description="Elige cómo se resuelve la rama del ambiente. FlowManager nunca hará push a esta rama."
      size="lg"
      icon={<Icon name="branch" size={20} />}
      badge={
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
      }
      onClose={busy ? () => undefined : onClose}
      closeOnBackdrop={!busy}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy}>
            {busy ? <Spinner size="sm" /> : <Icon name="check" size={14} />}
            {busy ? 'Guardando…' : 'Guardar rama'}
          </button>
        </>
      }
    >
      <button
        type="button"
        className={`auto-option ${mode === 'auto' ? 'is-selected' : ''}`}
        onClick={() => setMode('auto')}
        aria-pressed={mode === 'auto'}
      >
        <span className="auto-option-radio" aria-hidden="true">
          {mode === 'auto' ? <span /> : null}
        </span>
        <span className="auto-option-copy">
          <strong>Detección automática</strong>
          <span>
            Busca alias conocidos y, para QAS, la mayor versión <code>release/*</code>.
            Si no hay coincidencia, el ambiente queda sin configurar.
          </span>
          {environment.branchName ? (
            <span className="auto-option-result">
              Resultado actual: <code>{environment.branchName}</code>
            </span>
          ) : null}
        </span>
        <StatusChip tone="neutral">Recomendado</StatusChip>
      </button>

      <div className="branch-picker-header">
        <span className="field-label">O elige una rama manualmente</span>
        <div className="search-input">
          <Icon name="search" size={14} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por rama, mensaje o autor"
            aria-label="Buscar rama"
            autoComplete="off"
            spellCheck={false}
          />
          {search ? (
            <button
              type="button"
              className="search-clear"
              aria-label="Limpiar búsqueda"
              onClick={() => setSearch('')}
            >
              <Icon name="x" size={12} />
            </button>
          ) : null}
        </div>
      </div>

      <div className="branch-list" role="listbox" aria-label="Ramas disponibles">
        {filtered.length === 0 ? (
          <div className="branch-list-empty">
            {repository.branches.length === 0
              ? 'No hay ramas disponibles. Actualiza el repositorio con git fetch.'
              : 'Ninguna rama coincide con la búsqueda.'}
          </div>
        ) : (
          filtered.map((branch) => {
            const active = mode === 'manual' && selected === branch.name;
            const other = otherUsage.get(branch.name.toLowerCase());
            const version = branch.name.startsWith('release/')
              ? branch.name.replace('release/', '')
              : null;
            return (
              <button
                key={`${branch.isRemote ? 'r' : 'l'}-${branch.name}`}
                type="button"
                role="option"
                aria-selected={active}
                className={`branch-option ${active ? 'is-selected' : ''}`}
                onClick={() => {
                  setMode('manual');
                  setSelected(branch.name);
                  setError(null);
                }}
              >
                <span className="branch-option-main">
                  <span className="branch-option-name">
                    {branch.name}
                    {version ? <span className="branch-version">v{version}</span> : null}
                    {!branch.isRemote ? <span className="branch-local">local</span> : null}
                    {other ? <span className="branch-other">usada en {other}</span> : null}
                  </span>
                  <span className="branch-option-meta">
                    <code>{shortSha(branch.sha)}</code>
                    <span>{formatDateTime(branch.committedAt)}</span>
                    {branch.author ? <span>{branch.author}</span> : null}
                  </span>
                  {branch.message ? (
                    <span className="branch-option-message">{branch.message}</span>
                  ) : null}
                </span>
                <span className="branch-option-check" aria-hidden="true">
                  {active ? <Icon name="check" size={13} /> : null}
                </span>
              </button>
            );
          })
        )}
      </div>

      <div className="form-note">
        <Icon name="shield" size={14} />
        <span>
          Si eliges manualmente, FlowManager no volverá a cambiar esta rama al actualizar
          el repositorio. Podrás volver a automático cuando quieras.
        </span>
      </div>

      {environment.ambiguous ? (
        <Callout tone="warning" title="La detección automática es ambigua">
          Hay más de una rama candidata con la misma versión y fecha. Revisa la lista y
          elige una manualmente para evitar sorpresas.
        </Callout>
      ) : null}

      {error ? (
        <Callout tone="danger" title="No se pudo guardar la rama">
          {error.message}
        </Callout>
      ) : null}
    </Modal>
  );
}
