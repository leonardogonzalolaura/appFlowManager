import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { normalizeError } from '../../lib/api';
import { upsertDbScript } from '../../lib/database';
import type {
  ApiError,
  DbEngine,
  DbScriptSummary,
  EnvironmentDefinition,
  RequirementRepositoryMapping,
} from '../../types';
import { Callout } from '../ui/Callout';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';

interface ScriptEditorModalProps {
  requirementId: string;
  repositories: RequirementRepositoryMapping[];
  environments: EnvironmentDefinition[];
  script?: DbScriptSummary | null;
  onClose: () => void;
  onSaved: (script: DbScriptSummary) => void;
}

export function ScriptEditorModal({
  requirementId,
  repositories,
  environments,
  script,
  onClose,
  onSaved,
}: ScriptEditorModalProps) {
  const [repositoryId, setRepositoryId] = useState(
    script?.repositoryId ?? repositories[0]?.repositoryId ?? '',
  );
  const [name, setName] = useState(script?.name ?? '');
  const [engine, setEngine] = useState<DbEngine>(script?.engine ?? 'sqlserver');
  const [environmentScope, setEnvironmentScope] = useState(
    script?.environmentScope ?? 'all',
  );
  const [sourceType, setSourceType] = useState<'inline' | 'file'>(
    script?.sourceType ?? 'inline',
  );
  const [content, setContent] = useState(script?.content ?? '');
  const [filePath, setFilePath] = useState(script?.filePath ?? '');
  const [isActive, setIsActive] = useState(script?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const canSubmit =
    Boolean(repositoryId && name.trim()) &&
    (sourceType === 'inline' ? content.trim().length > 0 : filePath.trim().length > 0);

  async function pickFile() {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [{ name: 'SQL', extensions: ['sql'] }],
      });
      if (typeof selected === 'string') setFilePath(selected);
    } catch (caught) {
      setError(normalizeError(caught));
    }
  }

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await upsertDbScript({
        id: script?.id,
        requirementId,
        repositoryId,
        name: name.trim(),
        engine,
        environmentScope,
        sourceType,
        content: sourceType === 'inline' ? content : undefined,
        filePath: sourceType === 'file' ? filePath : null,
        isActive,
      });
      onSaved(saved);
    } catch (caught) {
      setError(normalizeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={script ? 'Editar script SQL' : 'Nuevo script SQL'}
      description="El script se guarda en FlowManager; no se commitea automáticamente al repositorio."
      size="lg"
      icon={<Icon name="database" size={20} />}
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
            onClick={() => void submit()}
            disabled={busy || !canSubmit}
          >
            {busy ? <Spinner size="sm" /> : <Icon name="check" size={14} />}
            {busy ? 'Guardando…' : 'Guardar script'}
          </button>
        </>
      }
    >
      <div className="db-form">
        <div className="db-form-grid">
          <div className="field">
            <label className="field-label" htmlFor="script-repo">Repositorio</label>
            <select
              id="script-repo"
              className="input"
              value={repositoryId}
              onChange={(event) => setRepositoryId(event.target.value)}
              disabled={busy}
              autoComplete="off"
            >
              {repositories.map((repository) => (
                <option key={repository.repositoryId} value={repository.repositoryId}>
                  {repository.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="script-engine">Motor</label>
            <select
              id="script-engine"
              className="input"
              value={engine}
              onChange={(event) => setEngine(event.target.value as DbEngine)}
              disabled={busy}
              autoComplete="off"
            >
              <option value="sqlserver">SQL Server</option>
              <option value="postgres">PostgreSQL</option>
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="script-scope">Aplica a</label>
            <select
              id="script-scope"
              className="input"
              value={environmentScope}
              onChange={(event) => setEnvironmentScope(event.target.value)}
              disabled={busy}
              autoComplete="off"
            >
              <option value="all">Todos los ambientes</option>
              {environments.map((environment) => (
                <option key={environment.key} value={environment.key}>
                  Solo {environment.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="script-source">Origen</label>
            <select
              id="script-source"
              className="input"
              value={sourceType}
              onChange={(event) => setSourceType(event.target.value as 'inline' | 'file')}
              disabled={busy}
              autoComplete="off"
            >
              <option value="inline">Contenido en la app</option>
              <option value="file">Archivo .sql</option>
            </select>
          </div>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="script-name">Nombre</label>
          <input
            id="script-name"
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ej. crear tabla de ofertas"
            disabled={busy}
            autoComplete="off"
          />
        </div>

        {sourceType === 'file' ? (
          <div className="field">
            <label className="field-label" htmlFor="script-file">Archivo SQL</label>
            <div className="db-file-row">
              <input
                id="script-file"
                className="input"
                value={filePath}
                onChange={(event) => setFilePath(event.target.value)}
                placeholder="Ruta al archivo .sql"
                disabled={busy}
              />
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void pickFile()}
                disabled={busy}
              >
                <Icon name="folder" size={14} />
                Elegir
              </button>
            </div>
          </div>
        ) : (
          <div className="field">
            <label className="field-label" htmlFor="script-content">SQL</label>
            <textarea
              id="script-content"
              className="input textarea db-sql-editor"
              rows={14}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder={
                engine === 'sqlserver'
                  ? '-- SQL Server. Separa lotes con GO en una línea.'
                  : '-- PostgreSQL'
              }
              disabled={busy}
              spellCheck={false}
            />
          </div>
        )}

        <label className="checkbox-row checkbox-row-compact">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
            disabled={busy}
          />
          <span>Script activo</span>
        </label>

        <div className="form-note">
          <Icon name="shield" size={14} />
          <span>
            La ejecución requiere confirmación humana y una conexión configurada para el
            ambiente. Nunca se ejecuta automáticamente al desplegar.
          </span>
        </div>

        {error ? (
          <Callout tone="danger" title="No se pudo guardar el script">
            {error.message}
          </Callout>
        ) : null}
      </div>
    </Modal>
  );
}
