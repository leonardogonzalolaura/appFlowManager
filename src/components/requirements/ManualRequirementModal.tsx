import { useEffect, useState } from 'react';
import { isTauri, normalizeError } from '../../lib/api';
import { listRepositories } from '../../lib/repositories';
import {
  createManualRequirement,
  updateManualRequirement,
} from '../../lib/requirements';
import type {
  ApiError,
  RepositorySummary,
  RequirementDetail,
} from '../../types';
import { Callout } from '../ui/Callout';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';

interface ManualRequirementModalProps {
  requirement?: RequirementDetail | null;
  onClose: () => void;
  onSaved: (requirement: RequirementDetail) => void;
}

export function ManualRequirementModal({
  requirement,
  onClose,
  onSaved,
}: ManualRequirementModalProps) {
  const editing = Boolean(requirement);
  const [externalKey, setExternalKey] = useState(requirement?.externalKey ?? '');
  const [title, setTitle] = useState(requirement?.title ?? '');
  const [feature, setFeature] = useState(requirement?.feature ?? '');
  const [type, setType] = useState(requirement?.type ?? '');
  const [developer, setDeveloper] = useState(requirement?.developer ?? '');
  const [qa, setQa] = useState(requirement?.qa ?? '');
  const [status, setStatus] = useState(requirement?.status ?? '');
  const [priority, setPriority] = useState(requirement?.priority ?? '');
  const [notes, setNotes] = useState(requirement?.notes ?? '');
  const [manualLocked, setManualLocked] = useState(
    requirement?.manualLocked ?? false,
  );
  const [repositories, setRepositories] = useState<RepositorySummary[]>([]);
  const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const demo = !isTauri();

  useEffect(() => {
    if (editing) return;
    let active = true;
    listRepositories()
      .then((loaded) => {
        if (active) setRepositories(loaded);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [editing]);

  function toggleRepo(repositoryId: string) {
    setSelectedRepos((current) => {
      const next = new Set(current);
      if (next.has(repositoryId)) next.delete(repositoryId);
      else next.add(repositoryId);
      return next;
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (demo || !title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const payload = {
        title: title.trim(),
        feature: feature.trim() || undefined,
        type: type.trim() || undefined,
        developer: developer.trim() || undefined,
        qa: qa.trim() || undefined,
        status: status.trim() || undefined,
        priority: priority.trim() || undefined,
        notes: notes.trim() || undefined,
        manualLocked,
      };
      const saved = requirement
        ? await updateManualRequirement(requirement.id, payload)
        : await createManualRequirement({
            ...payload,
            externalKey: externalKey.trim() || undefined,
            repositoryIds: selectedRepos.size
              ? Array.from(selectedRepos)
              : undefined,
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
      title={editing ? 'Editar requerimiento manual' : 'Nuevo requerimiento'}
      description={
        editing
          ? 'Los cambios se guardan solo en FlowManager.'
          : 'Registra un requerimiento que todavía no está en Monday. Puedes mapearlo a uno o varios repositorios.'
      }
      size="lg"
      icon={<Icon name="list" size={20} />}
      onClose={busy ? () => undefined : onClose}
      closeOnBackdrop={!busy}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button
            type="submit"
            form="manual-requirement-form"
            className="btn btn-primary"
            disabled={busy || demo || !title.trim()}
          >
            {busy ? <Spinner size="sm" /> : <Icon name="check" size={14} />}
            {busy ? 'Guardando…' : editing ? 'Guardar cambios' : 'Crear requerimiento'}
          </button>
        </>
      }
    >
      <form
        id="manual-requirement-form"
        className="form"
        onSubmit={(event) => void submit(event)}
      >
        <div className="field-grid">
          <div className="field">
            <label className="field-label" htmlFor="manual-key">
              Task ID <span className="field-optional">opcional</span>
            </label>
            <input
              id="manual-key"
              className="input"
              value={externalKey}
              onChange={(event) => setExternalKey(event.target.value)}
              placeholder="MAN-0001 (se genera solo)"
              disabled={editing || busy}
              autoComplete="off"
              spellCheck={false}
            />
            <p className="field-hint">
              Si lo dejas vacío, FlowManager genera la siguiente key disponible.
            </p>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="manual-title">
              Título
            </label>
            <input
              id="manual-title"
              className="input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Resumen corto del requerimiento"
              disabled={busy}
              autoComplete="off"
            />
          </div>
        </div>

        <div className="field-grid">
          <div className="field">
            <label className="field-label" htmlFor="manual-feature">
              Feature
            </label>
            <input
              id="manual-feature"
              className="input"
              value={feature}
              onChange={(event) => setFeature(event.target.value)}
              placeholder="Operación - Plataforma"
              disabled={busy}
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="manual-type">
              Tipo
            </label>
            <input
              id="manual-type"
              className="input"
              value={type}
              onChange={(event) => setType(event.target.value)}
              placeholder="User Story / Bug / Task"
              disabled={busy}
              autoComplete="off"
            />
          </div>
        </div>

        <div className="field-grid">
          <div className="field">
            <label className="field-label" htmlFor="manual-developer">
              Developer
            </label>
            <input
              id="manual-developer"
              className="input"
              value={developer}
              onChange={(event) => setDeveloper(event.target.value)}
              placeholder="Nombre del developer"
              disabled={busy}
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="manual-qa">
              QA
            </label>
            <input
              id="manual-qa"
              className="input"
              value={qa}
              onChange={(event) => setQa(event.target.value)}
              placeholder="Nombre del QA"
              disabled={busy}
              autoComplete="off"
            />
          </div>
        </div>

        <div className="field-grid">
          <div className="field">
            <label className="field-label" htmlFor="manual-status">
              Estado
            </label>
            <input
              id="manual-status"
              className="input"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              placeholder="To Do, In Progress…"
              disabled={busy}
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="manual-priority">
              Prioridad
            </label>
            <input
              id="manual-priority"
              className="input"
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
              placeholder="Critical / High / Medium / Low"
              disabled={busy}
              autoComplete="off"
            />
          </div>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="manual-notes">
            Notas
          </label>
          <textarea
            id="manual-notes"
            className="input textarea"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Contexto, enlaces o decisiones que deban quedar guardadas."
            rows={3}
            disabled={busy}
          />
        </div>

        {editing ? null : (
          <div className="field">
            <span className="field-label">Repositorios</span>
            {repositories.length === 0 ? (
              <p className="field-hint">
                No hay repositorios configurados todavía. Puedes mapearlo después.
              </p>
            ) : (
              <div className="repo-picker">
                {repositories.map((repository) => (
                  <label key={repository.id} className="repo-picker-item">
                    <input
                      type="checkbox"
                      checked={selectedRepos.has(repository.id)}
                      onChange={() => toggleRepo(repository.id)}
                      disabled={busy}
                    />
                    <span>
                      <strong>{repository.name}</strong>
                      <small>base {repository.baseBranch}</small>
                    </span>
                  </label>
                ))}
              </div>
            )}
            <p className="field-hint">
              La rama por defecto será <code>feature/&lt;Task ID&gt;</code>, o{' '}
              <code>fix/&lt;Task ID&gt;</code> si el tipo es Bug. Podrás cambiarla en el
              detalle.
            </p>
          </div>
        )}

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={manualLocked}
            onChange={(event) => setManualLocked(event.target.checked)}
            disabled={busy}
          />
          <span>
            Bloquear contra futuras importaciones de Monday
            <small>No se actualizará si el mismo Task ID aparece en un export.</small>
          </span>
        </label>

        {demo ? (
          <Callout tone="info" title="Vista previa web" icon="eye">
            Crear requerimientos requiere la app de escritorio.
          </Callout>
        ) : null}

        {error ? (
          <Callout tone="danger" title="No se pudo guardar el requerimiento">
            {error.message}
          </Callout>
        ) : null}
      </form>
    </Modal>
  );
}
