import { useState, useMemo, useEffect } from 'react';
import { isTauri, normalizeError } from '../../lib/api';
import { pickDirectory } from '../../lib/dialog';
import { addRepository, cloneRepository } from '../../lib/repositories';
import { type ApiError, type RepositoryDetail, type RepositorySummary } from '../../types';
import { Callout } from '../ui/Callout';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';
import { toast } from '../ui/Toast';
import { truncateMiddle } from '../../lib/format';

interface RepositorySelectorModalProps {
  open: boolean;
  onClose: () => void;
  repositories: RepositorySummary[];
  onSelect: (repositoryId: string) => void;
  onCreated: (repository: RepositoryDetail) => void;
  mode?: 'selector' | 'add' | 'clone';
}

export function RepositorySelectorModal({
  open,
  onClose,
  repositories,
  onSelect,
  onCreated,
  mode = 'selector',
}: RepositorySelectorModalProps) {
  const [search, setSearch] = useState('');
  const [selectedMode, setSelectedMode] = useState<'selector' | 'add' | 'clone'>(mode);
  
  // Form state
  const [path, setPath] = useState('');
  const [url, setUrl] = useState('');
  const [parentDir, setParentDir] = useState('');
  const [folderName, setFolderName] = useState('');
  const [name, setName] = useState('');
  const [baseBranch, setBaseBranch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const demo = !isTauri();

  // Reset mode when modal opens
  useEffect(() => {
    if (open) {
      setSelectedMode(mode);
    }
  }, [open, mode]);

  const filteredRepositories = useMemo(() => {
    if (!search.trim()) return repositories;

    const searchLower = search.toLowerCase().trim();
    return repositories.filter(
      (repo) =>
        repo.name.toLowerCase().includes(searchLower) ||
        repo.localPath.toLowerCase().includes(searchLower) ||
        repo.baseBranch.toLowerCase().includes(searchLower),
    );
  }, [repositories, search]);

  // Helper functions
  async function choosePath() {
    const selected = await pickDirectory('Selecciona un repositorio Git');
    if (selected) {
      setPath(selected);
      setError(null);
    } else if (demo) {
      toast.info('El selector de carpetas requiere la app de escritorio');
    }
  }

  async function chooseParent() {
    const selected = await pickDirectory('Selecciona la carpeta donde clonar');
    if (selected) {
      setParentDir(selected);
      setError(null);
    } else if (demo) {
      toast.info('El selector de carpetas requiere la app de escritorio');
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (demo) return;

    setBusy(true);
    setError(null);
    try {
      const repository =
        selectedMode === 'add'
          ? await addRepository({
              path: path.trim(),
              name: name.trim() || undefined,
              baseBranch: baseBranch.trim() || undefined,
            })
          : await cloneRepository({
              url: url.trim(),
              parentDir: parentDir.trim(),
              folderName: folderName.trim() || undefined,
              name: name.trim() || undefined,
              baseBranch: baseBranch.trim() || undefined,
            });

      onCreated(repository);
      toast.success('Repositorio agregado', {
        description: `${repository.configuredCount} de ${repository.environments.length} ambientes detectados automáticamente.`,
      });
      setSelectedMode('selector');
    } catch (caught) {
      setError(normalizeError(caught));
    } finally {
      setBusy(false);
    }
  }

  const canSubmit =
    !busy &&
    !demo &&
    (selectedMode === 'add'
      ? path.trim().length > 0
      : url.trim().length > 0 && parentDir.trim().length > 0);

  // Form mode content
  const renderForm = () => {
    if (selectedMode === 'selector') {
      return null; // Show repository list instead
    }

    return (
      <form className="selector-modal-form" onSubmit={submit}>
        <div className="selector-modal-form-header">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setSelectedMode('selector');
              setError(null);
            }}
            disabled={busy}
          >
            <Icon name="chevron-left" size={12} />
            Volver a la lista
          </button>
          <h3 className="selector-modal-subtitle">
            {selectedMode === 'add' ? 'Agregar carpeta local' : 'Clonar desde URL'}
          </h3>
        </div>

        <p className="selector-modal-form-help">
          {selectedMode === 'add'
            ? 'Selecciona una carpeta local que ya sea un repositorio Git.'
            : 'Pega la URL del repositorio remoto (HTTPS o SSH).'}
        </p>

        {error && (
          <Callout tone="danger" title="No se pudo agregar el repositorio" icon="alert">
            {error.code === 'GIT_AUTH'
              ? 'Git necesita credenciales. Configura el credential helper de Windows y vuelve a intentar.'
              : error.message}
          </Callout>
        )}

        <div className="selector-modal-form-fields">
          {selectedMode === 'add' ? (
            <>
              <div className="form-group">
                <label htmlFor="local-path">Ruta del repositorio local</label>
                <div className="input-with-button">
                  <input
                    id="local-path"
                    type="text"
                    placeholder="C:\ruta\al\repositorio"
                    value={path}
                    onChange={(e) => setPath(e.target.value)}
                    disabled={busy}
                    readOnly
                    className="input"
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={choosePath}
                    disabled={busy}
                  >
                    <Icon name="folder" size={14} />
                    Seleccionar
                  </button>
                </div>
                <p className="form-hint">
                  Debe ser una carpeta que ya contenga un repositorio Git (tiene .git).
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="form-group">
                <label htmlFor="clone-url">URL del repositorio</label>
                <input
                  id="clone-url"
                  type="url"
                  placeholder="https://github.com/usuario/repo.git o git@github.com:usuario/repo.git"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={busy}
                  autoFocus
                  className="input"
                />
              </div>
              <div className="field-grid">
                <div className="form-group">
                  <label htmlFor="parent-dir">Carpeta donde clonar</label>
                  <div className="input-with-button">
                    <input
                      id="parent-dir"
                      type="text"
                      placeholder="C:\ruta\donde\clonar"
                      value={parentDir}
                      onChange={(e) => setParentDir(e.target.value)}
                      disabled={busy}
                      readOnly
                      className="input"
                    />
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={chooseParent}
                      disabled={busy}
                    >
                      <Icon name="folder" size={14} />
                      Seleccionar
                    </button>
                  </div>
                </div>
                <div className="form-group">
                  <label htmlFor="folder-name">Nombre de la carpeta (opcional)</label>
                  <input
                    id="folder-name"
                    type="text"
                    placeholder="Se deriva de la URL si no se especifica"
                    value={folderName}
                    onChange={(e) => setFolderName(e.target.value)}
                    disabled={busy}
                    className="input"
                  />
                </div>
              </div>
            </>
          )}

          <div className="field-grid">
            <div className="form-group">
              <label htmlFor="repo-name">Nombre en FlowManager (opcional)</label>
              <input
                id="repo-name"
                type="text"
                placeholder="Se deriva de la ruta si no se especifica"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
                className="input"
              />
            </div>
            <div className="form-group">
              <label htmlFor="base-branch">Rama base (opcional)</label>
              <input
                id="base-branch"
                type="text"
                placeholder="main, master, etc. (se detectará si no se especifica)"
                value={baseBranch}
                onChange={(e) => setBaseBranch(e.target.value)}
                disabled={busy}
                className="input"
              />
            </div>
          </div>
        </div>

        <div className="selector-modal-form-footer">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setSelectedMode('selector');
              setError(null);
            }}
            disabled={busy}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!canSubmit}
          >
            {busy ? <Spinner size="sm" /> : <Icon name="plus" size={14} />}
            {busy
              ? selectedMode === 'add'
                ? 'Agregando…'
                : 'Clonando…'
              : selectedMode === 'add'
                ? 'Agregar repositorio'
                : 'Clonar repositorio'}
          </button>
        </div>
      </form>
    );
  };

  // Repository list mode content
  const renderList = () => {
    return (
      <>
        <div className="selector-modal-search">
          <div className="search-input">
            <Icon name="search" size={14} />
            <input
              type="search"
              placeholder="Buscar repositorio por nombre, ruta o rama..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>
        </div>

        <div className="selector-modal-header">
          <div className="selector-modal-header-info">
            <h3 className="selector-modal-subtitle">Repositorios disponibles</h3>
            <span className="selector-modal-count">
              {filteredRepositories.length} de {repositories.length}
            </span>
          </div>
          <div className="selector-modal-header-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setSelectedMode('add')}
            >
              <Icon name="folder" size={13} />
              Agregar local
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setSelectedMode('clone')}
            >
              <Icon name="terminal" size={13} />
              Clonar
            </button>
          </div>
        </div>

        <div className="selector-modal-list">
          {filteredRepositories.length === 0 ? (
            <div className="selector-modal-empty">
              <Icon name="search" size={22} />
              <p>
                {search.trim()
                  ? 'No hay repositorios que coincidan con tu búsqueda'
                  : 'No hay repositorios disponibles'}
              </p>
              {!search.trim() && (
                <div className="selector-modal-empty-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => setSelectedMode('add')}
                  >
                    <Icon name="plus" size={12} />
                    Agregar tu primer repositorio
                  </button>
                </div>
              )}
            </div>
          ) : (
            filteredRepositories.map((repo) => (
              <button
                key={repo.id}
                type="button"
                className="selector-modal-item"
                onClick={() => {
                  onSelect(repo.id);
                  onClose();
                }}
              >
                <div className="selector-modal-item-avatar">
                  {repo.name.slice(0, 1).toUpperCase()}
                </div>
                <div className="selector-modal-item-content">
                  <div className="selector-modal-item-title">
                    <span className="selector-modal-item-name">{repo.name}</span>
                    {repo.warnings.length > 0 && (
                      <span className="selector-modal-item-warning" title="Tiene advertencias">
                        <Icon name="alert" size={12} />
                      </span>
                    )}
                  </div>
                  <p className="selector-modal-item-path" title={repo.localPath}>
                    {truncateMiddle(repo.localPath, 50)}
                  </p>
                  <div className="selector-modal-item-meta">
                    <span className="selector-modal-item-branch">
                      <Icon name="branch" size={11} />
                      base {repo.baseBranch}
                    </span>
                    <span className="selector-modal-item-env">
                      <Icon name="layers" size={11} />
                      {repo.configuredCount}/{repo.environments.length} ambientes
                    </span>
                  </div>
                </div>
                <div className="selector-modal-item-arrow">
                  <Icon name="chevron-right" size={14} />
                </div>
              </button>
            ))
          )}
        </div>
      </>
    );
  };

  if (!open) return null;

  return (
    <Modal
      onClose={busy ? () => undefined : onClose}
      size="lg"
      title={selectedMode === 'selector' ? 'Seleccionar repositorio' : 'Agregar repositorio'}
      description={
        selectedMode === 'selector'
          ? 'Elige un repositorio para ver su detalle'
          : selectedMode === 'add'
            ? 'Agrega un repositorio local existente'
            : 'Clona un repositorio desde una URL remota'
      }
    >
      <div className="repository-selector-modal">
        {selectedMode === 'selector' ? renderList() : renderForm()}
      </div>
    </Modal>
  );
}