import { useState } from 'react';
import { isTauri, normalizeError } from '../../lib/api';
import { pickDirectory } from '../../lib/dialog';
import {
  addRepository,
  cloneRepository,
} from '../../lib/repositories';
import type { ApiError, RepositoryDetail } from '../../types';
import { Callout } from '../ui/Callout';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';
import { toast } from '../ui/Toast';

interface AddRepositoryModalProps {
  initialMode?: 'local' | 'clone';
  onClose: () => void;
  onCreated: (repository: RepositoryDetail) => void;
}

export function AddRepositoryModal({
  initialMode = 'local',
  onClose,
  onCreated,
}: AddRepositoryModalProps) {
  const [mode, setMode] = useState<'local' | 'clone'>(initialMode);
  const [path, setPath] = useState('');
  const [url, setUrl] = useState('');
  const [parentDir, setParentDir] = useState('');
  const [folderName, setFolderName] = useState('');
  const [name, setName] = useState('');
  const [baseBranch, setBaseBranch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const demo = !isTauri();

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
        mode === 'local'
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
    } catch (caught) {
      setError(normalizeError(caught));
    } finally {
      setBusy(false);
    }
  }

  const canSubmit =
    !busy &&
    !demo &&
    (mode === 'local'
      ? path.trim().length > 0
      : url.trim().length > 0 && parentDir.trim().length > 0);

  return (
    <Modal
      title="Agregar repositorio"
      description="FlowManager leerá las ramas y propondrá la rama de cada ambiente. No modifica nada en tu repositorio."
      size="md"
      icon={<Icon name="branch" size={20} />}
      onClose={busy ? () => undefined : onClose}
      closeOnBackdrop={!busy}
      footer={
        <>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={busy}
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="add-repository-form"
            className="btn btn-primary"
            disabled={!canSubmit}
          >
            {busy ? <Spinner size="sm" /> : <Icon name="plus" size={14} />}
            {busy ? 'Agregando…' : mode === 'local' ? 'Agregar repositorio' : 'Clonar y agregar'}
          </button>
        </>
      }
    >
      <div className="segmented" role="tablist" aria-label="Forma de agregar el repositorio">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'local'}
          className={mode === 'local' ? 'is-active' : ''}
          onClick={() => setMode('local')}
        >
          <Icon name="folder" size={14} />
          Carpeta local
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'clone'}
          className={mode === 'clone' ? 'is-active' : ''}
          onClick={() => setMode('clone')}
        >
          <Icon name="terminal" size={14} />
          Clonar desde URL
        </button>
      </div>

      <form id="add-repository-form" className="form" onSubmit={(event) => void submit(event)}>
        {mode === 'local' ? (
          <div className="field">
            <label className="field-label" htmlFor="repo-path">
              Ruta del repositorio
            </label>
            <div className="input-row">
              <input
                id="repo-path"
                className="input"
                value={path}
                onChange={(event) => setPath(event.target.value)}
                placeholder="C:\ruta\a\tu\repositorio"
                autoComplete="off"
                spellCheck={false}
              />
              <button type="button" className="btn btn-secondary" onClick={() => void choosePath()}>
                <Icon name="folder" size={14} />
                Seleccionar
              </button>
            </div>
            <p className="field-hint">Debe ser una copia de trabajo Git con su carpeta .git.</p>
          </div>
        ) : (
          <>
            <div className="field">
              <label className="field-label" htmlFor="repo-url">
                URL del repositorio
              </label>
              <input
                id="repo-url"
                className="input"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://github.com/acme/payments.git"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="repo-parent">
                Carpeta destino
              </label>
              <div className="input-row">
                <input
                  id="repo-parent"
                  className="input"
                  value={parentDir}
                  onChange={(event) => setParentDir(event.target.value)}
                  placeholder="C:\Users\tu-usuario\source\repos"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button type="button" className="btn btn-secondary" onClick={() => void chooseParent()}>
                  <Icon name="folder" size={14} />
                  Elegir
                </button>
              </div>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="repo-folder">
                Nombre de carpeta <span className="field-optional">opcional</span>
              </label>
              <input
                id="repo-folder"
                className="input"
                value={folderName}
                onChange={(event) => setFolderName(event.target.value)}
                placeholder="payments-api"
                autoComplete="off"
                spellCheck={false}
              />
              <p className="field-hint">Si lo dejas vacío, se usa el nombre del repositorio de la URL.</p>
            </div>
          </>
        )}

        <div className="field-grid">
          <div className="field">
            <label className="field-label" htmlFor="repo-name">
              Nombre visible <span className="field-optional">opcional</span>
            </label>
            <input
              id="repo-name"
              className="input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Payments API"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="repo-base">
              Rama base
            </label>
            <input
              id="repo-base"
              className="input"
              value={baseBranch}
              onChange={(event) => setBaseBranch(event.target.value)}
              placeholder="Detección automática"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="field-hint">
              Si lo dejas vacío, se usa la rama por defecto del repositorio.
            </p>
          </div>
        </div>

        {error ? (
          <Callout tone="danger" title="No se pudo agregar el repositorio">
            {error.message}
          </Callout>
        ) : null}

        {demo ? (
          <Callout tone="info" title="Vista previa web" icon="eye">
            Agregar repositorios requiere la app de escritorio. Abre FlowManager con
            <code>npm run tauri dev</code> para usar esta acción.
          </Callout>
        ) : (
          <div className="form-note">
            <Icon name="info" size={14} />
            <span>
              Agregar no ejecuta <code>git fetch</code>. Después podrás pulsar
              <strong> Actualizar</strong> para leer las ramas más recientes del remoto.
            </span>
          </div>
        )}
      </form>
    </Modal>
  );
}
