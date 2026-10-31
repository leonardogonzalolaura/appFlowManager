import { useState } from 'react';
import { normalizeError } from '../../lib/api';
import { updateRepository } from '../../lib/repositories';
import type { ApiError, RepositoryDetail } from '../../types';
import { Callout } from '../ui/Callout';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';

interface EditRepositoryModalProps {
  repository: RepositoryDetail;
  onClose: () => void;
  onSaved: (repository: RepositoryDetail) => void;
}

export function EditRepositoryModal({
  repository,
  onClose,
  onSaved,
}: EditRepositoryModalProps) {
  const [name, setName] = useState(repository.name);
  const [baseBranch, setBaseBranch] = useState(repository.baseBranch);
  const [githubOwner, setGithubOwner] = useState(repository.githubOwner ?? '');
  const [githubRepo, setGithubRepo] = useState(repository.githubRepo ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const updated = await updateRepository({
        repositoryId: repository.id,
        name: name.trim() || undefined,
        baseBranch: baseBranch.trim() || undefined,
        githubOwner: githubOwner.trim() || undefined,
        githubRepo: githubRepo.trim() || undefined,
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
      title="Editar repositorio"
      description="Estos datos son locales y no modifican el repositorio remoto."
      size="md"
      icon={<Icon name="settings" size={20} />}
      onClose={busy ? () => undefined : onClose}
      closeOnBackdrop={!busy}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button
            type="submit"
            form="edit-repository-form"
            className="btn btn-primary"
            disabled={busy || !name.trim()}
          >
            {busy ? <Spinner size="sm" /> : <Icon name="check" size={14} />}
            {busy ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </>
      }
    >
      <form id="edit-repository-form" className="form" onSubmit={(event) => void submit(event)}>
        <div className="field">
          <label className="field-label" htmlFor="edit-repo-name">
            Nombre visible
          </label>
          <input
            id="edit-repo-name"
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="off"
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="edit-repo-base">
            Rama base
          </label>
          <input
            id="edit-repo-base"
            className="input"
            value={baseBranch}
            onChange={(event) => setBaseBranch(event.target.value)}
            list="repo-branches"
            autoComplete="off"
            spellCheck={false}
          />
          <datalist id="repo-branches">
            {repository.branches.map((branch) => (
              <option key={branch.name} value={branch.name} />
            ))}
          </datalist>
          <p className="field-hint">
            Debe existir en el repositorio. Se usa para crear las ramas de requerimiento.
          </p>
        </div>

        <div className="field-grid">
          <div className="field">
            <label className="field-label" htmlFor="edit-repo-owner">
              Owner de GitHub
            </label>
            <input
              id="edit-repo-owner"
              className="input"
              value={githubOwner}
              onChange={(event) => setGithubOwner(event.target.value)}
              placeholder="acme"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="edit-repo-slug">
              Repositorio de GitHub
            </label>
            <input
              id="edit-repo-slug"
              className="input"
              value={githubRepo}
              onChange={(event) => setGithubRepo(event.target.value)}
              placeholder="payments-api"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </div>

        <div className="form-note">
          <Icon name="info" size={14} />
          <span>
            La ruta local no se edita aquí. Si moviste el repositorio, quítalo y vuelve a agregarlo.
          </span>
        </div>

        {error ? (
          <Callout tone="danger" title="No se pudieron guardar los cambios">
            {error.message}
          </Callout>
        ) : null}
      </form>
    </Modal>
  );
}
