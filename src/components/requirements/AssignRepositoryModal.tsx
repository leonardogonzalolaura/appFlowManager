import { useEffect, useMemo, useState } from 'react';
import { normalizeError } from '../../lib/api';
import { defaultBranchName } from '../../lib/branches';
import { listRepositories } from '../../lib/repositories';
import { assignRequirementRepository } from '../../lib/requirements';
import type {
  ApiError,
  RepositorySummary,
  RequirementDetail,
} from '../../types';
import { Callout } from '../ui/Callout';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';

interface AssignRepositoryModalProps {
  requirement: RequirementDetail;
  onClose: () => void;
  onAssigned: () => void;
}

export function AssignRepositoryModal({
  requirement,
  onClose,
  onAssigned,
}: AssignRepositoryModalProps) {
  const [repositories, setRepositories] = useState<RepositorySummary[]>([]);
  const [repositoryId, setRepositoryId] = useState('');
  const [branchName, setBranchName] = useState(
    defaultBranchName(requirement.type, requirement.externalKey),
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const mapped = useMemo(
    () => new Set(requirement.repositories.map((repository) => repository.repositoryId)),
    [requirement.repositories],
  );

  useEffect(() => {
    let active = true;
    listRepositories()
      .then((loaded) => {
        if (!active) return;
        setRepositories(loaded);
        const first = loaded.find((repository) => !mapped.has(repository.id));
        setRepositoryId(first?.id ?? loaded[0]?.id ?? '');
      })
      .catch((caught) => {
        if (active) setError(normalizeError(caught));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mapped]);

  async function save() {
    if (!repositoryId) return;
    setBusy(true);
    setError(null);
    try {
      await assignRequirementRepository({
        requirementId: requirement.id,
        repositoryId,
        branchName: branchName.trim() || undefined,
      });
      onAssigned();
    } catch (caught) {
      setError(normalizeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Asignar repositorio"
      description={`Mapea ${requirement.externalKey} a un repositorio y define el nombre de la rama.`}
      size="sm"
      icon={<Icon name="branch" size={20} />}
      onClose={busy ? () => undefined : onClose}
      closeOnBackdrop={!busy}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void save()}
            disabled={busy || !repositoryId}
          >
            {busy ? <Spinner size="sm" /> : <Icon name="check" size={14} />}
            {busy ? 'Guardando…' : 'Asignar'}
          </button>
        </>
      }
    >
      {loading ? (
        <div className="env-manager-loading">
          <Spinner size="md" label="Leyendo repositorios…" />
        </div>
      ) : (
        <div className="form">
          <div className="field">
            <label className="field-label" htmlFor="assign-repo">
              Repositorio
            </label>
            <select
              id="assign-repo"
              className="input"
              value={repositoryId}
              onChange={(event) => setRepositoryId(event.target.value)}
              disabled={busy}
            >
              {repositories.map((repository) => (
                <option key={repository.id} value={repository.id}>
                  {repository.name}
                  {mapped.has(repository.id) ? ' (ya asignado)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="assign-branch">
              Rama
            </label>
            <input
              id="assign-branch"
              className="input"
              value={branchName}
              onChange={(event) => setBranchName(event.target.value)}
              placeholder="BPIM-183"
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
            />
            <p className="field-hint">
              Convención: <code>feature/{requirement.externalKey}</code> o{' '}
              <code>fix/{requirement.externalKey}</code> si es un bug. Luego puedes crearla
              desde el detalle.
            </p>
          </div>

          {error ? (
            <Callout tone="danger" title="No se pudo asignar el repositorio">
              {error.message}
            </Callout>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
