import { useEffect, useState } from 'react';
import { normalizeError } from '../../lib/api';
import { withAlpha } from '../../lib/format';
import {
  archiveEnvironment,
  createEnvironment,
  listEnvironments,
  reorderEnvironments,
  updateEnvironment,
} from '../../lib/repositories';
import type { ApiError, EnvironmentDefinition } from '../../types';
import { Callout } from '../ui/Callout';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';
import { StatusChip } from '../ui/StatusChip';
import { toast } from '../ui/Toast';

interface EnvironmentsModalProps {
  onClose: () => void;
  onChanged: () => void;
}

const PALETTE = [
  '#6aa8ff',
  '#f5b84b',
  '#b08cff',
  '#3dd68c',
  '#ff8fab',
  '#4dd0e1',
  '#a3e635',
];

interface FormState {
  key: string;
  label: string;
  color: string;
  aliases: string;
  pattern: string;
}

const EMPTY_FORM: FormState = {
  key: '',
  label: '',
  color: PALETTE[4],
  aliases: '',
  pattern: '',
};

export function EnvironmentsModal({ onClose, onChanged }: EnvironmentsModalProps) {
  const [items, setItems] = useState<EnvironmentDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);

  useEffect(() => {
    let active = true;
    listEnvironments()
      .then((loaded) => {
        if (active) {
          setItems(loaded);
          setError(null);
        }
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
  }, []);

  function openCreate() {
    setEditingKey(null);
    setForm({
      ...EMPTY_FORM,
      color: PALETTE[items.length % PALETTE.length],
    });
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(environment: EnvironmentDefinition) {
    setEditingKey(environment.key);
    setForm({
      key: environment.key,
      label: environment.label,
      color: environment.color,
      aliases: environment.aliases.join(', '),
      pattern: environment.pattern ?? '',
    });
    setFormError(null);
    setFormOpen(true);
  }

  async function saveForm(event: React.FormEvent) {
    event.preventDefault();
    const aliases = form.aliases
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const pattern = form.pattern.trim();

    setBusy(true);
    setFormError(null);
    try {
      const updated = editingKey
        ? await updateEnvironment({
            key: editingKey,
            label: form.label.trim() || undefined,
            color: form.color,
            aliases,
            pattern,
          })
        : await createEnvironment({
            key: form.key.trim(),
            label: form.label.trim() || undefined,
            color: form.color,
            aliases,
            pattern: pattern || undefined,
          });
      setItems(updated);
      onChanged();
      setFormOpen(false);
      toast.success(editingKey ? 'Ambiente actualizado' : 'Ambiente agregado', {
        description: editingKey
          ? 'Se volvieron a detectar las ramas automáticas.'
          : 'Los repositorios ya pueden configurar su rama.',
      });
    } catch (caught) {
      setFormError(normalizeError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function archive(key: string) {
    setBusy(true);
    try {
      const updated = await archiveEnvironment(key);
      setItems(updated);
      onChanged();
      setConfirmArchive(null);
      toast.success('Ambiente archivado', {
        description: 'Dejará de aparecer en la matriz. El historial se conserva.',
      });
    } catch (caught) {
      setError(normalizeError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= items.length || reordering) return;
    const keys = items.map((item) => item.key);
    [keys[index], keys[target]] = [keys[target], keys[index]];
    setReordering(true);
    try {
      const updated = await reorderEnvironments(keys);
      setItems(updated);
      onChanged();
    } catch (caught) {
      setError(normalizeError(caught));
    } finally {
      setReordering(false);
    }
  }

  return (
    <Modal
      title="Ambientes"
      description="Catálogo global para todos los repositorios. Cada repo resuelve su propia rama."
      size="lg"
      icon={<Icon name="layers" size={20} />}
      onClose={busy ? () => undefined : onClose}
      closeOnBackdrop={!busy}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cerrar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={openCreate}
            disabled={busy || formOpen}
          >
            <Icon name="plus" size={14} />
            Nuevo ambiente
          </button>
        </>
      }
    >
      <div className="env-manager-intro">
        <Icon name="info" size={15} />
        <span>
          DEV, QAS, UAT y PRD vienen por defecto y no se pueden archivar. STAGE
          viene incluido como ambiente personalizado y puedes archivarlo si no lo
          usas. Los ambientes que agregues son igual de importantes y sus ramas
          también quedan protegidas: FlowManager nunca hace push sobre ellas.
        </span>
      </div>

      {formOpen ? (
        <form className="env-manager-form" onSubmit={(event) => void saveForm(event)}>
          <div className="env-manager-form-head">
            <h3>{editingKey ? `Editar ${editingKey}` : 'Nuevo ambiente'}</h3>
            <button
              type="button"
              className="btn btn-icon btn-ghost btn-sm"
              aria-label="Cerrar formulario"
              onClick={() => setFormOpen(false)}
              disabled={busy}
            >
              <Icon name="x" size={14} />
            </button>
          </div>

          <div className="field-grid">
            <div className="field">
              <label className="field-label" htmlFor="env-key">
                Clave
              </label>
              <input
                id="env-key"
                className="input"
                value={form.key}
                onChange={(event) => setForm({ ...form, key: event.target.value })}
                placeholder="preprod"
                disabled={Boolean(editingKey) || busy}
                autoComplete="off"
                spellCheck={false}
              />
              <p className="field-hint">Minúsculas, números y guiones. No se puede cambiar después.</p>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="env-label">
                Etiqueta
              </label>
              <input
                id="env-label"
                className="input"
                value={form.label}
                onChange={(event) => setForm({ ...form, label: event.target.value })}
                placeholder="PREPROD"
                disabled={busy}
                autoComplete="off"
              />
            </div>
          </div>

          <div className="field-grid">
            <div className="field">
              <label className="field-label" htmlFor="env-color">
                Color
              </label>
              <div className="env-color-row">
                <input
                  id="env-color"
                  type="color"
                  className="env-color-input"
                  value={form.color}
                  onChange={(event) => setForm({ ...form, color: event.target.value })}
                  disabled={busy}
                />
                <div className="env-color-palette" aria-hidden="true">
                  {PALETTE.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={form.color === color ? 'is-selected' : ''}
                      style={{ background: color }}
                      onClick={() => setForm({ ...form, color })}
                      disabled={busy}
                      tabIndex={-1}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="env-pattern">
                Patrón de rama <span className="field-optional">opcional</span>
              </label>
              <input
                id="env-pattern"
                className="input"
                value={form.pattern}
                onChange={(event) => setForm({ ...form, pattern: event.target.value })}
                placeholder="release/*"
                disabled={busy}
                autoComplete="off"
                spellCheck={false}
              />
              <p className="field-hint">Si los alias no coinciden, se busca la mayor versión del patrón.</p>
            </div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="env-aliases">
              Alias de rama <span className="field-optional">separados por coma</span>
            </label>
            <input
              id="env-aliases"
              className="input"
              value={form.aliases}
              onChange={(event) => setForm({ ...form, aliases: event.target.value })}
              placeholder="preprod, pre-production"
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
            />
            <p className="field-hint">
              Si lo dejas vacío, se usa la clave como alias. La comparación ignora mayúsculas.
            </p>
          </div>

          {formError ? (
            <Callout tone="danger" title="No se pudo guardar el ambiente">
              {formError.message}
            </Callout>
          ) : null}

          <div className="env-manager-form-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setFormOpen(false)}
              disabled={busy}
            >
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? <Spinner size="sm" /> : <Icon name="check" size={14} />}
              {busy ? 'Guardando…' : 'Guardar ambiente'}
            </button>
          </div>
        </form>
      ) : null}

      {loading ? (
        <div className="env-manager-loading">
          <Spinner size="md" label="Leyendo ambientes…" />
        </div>
      ) : error ? (
        <Callout tone="danger" title="No pudimos leer los ambientes">
          {error.message}
        </Callout>
      ) : (
        <div className="env-manager-list">
          {items.map((environment, index) => (
            <div key={environment.key} className="env-manager-row">
              <span
                className="env-manager-dot"
                style={{ background: environment.color }}
                aria-hidden="true"
              />

              <div className="env-manager-copy">
                <div className="env-manager-title">
                  <strong>{environment.label}</strong>
                  <code>{environment.key}</code>
                  {environment.isSystem ? (
                    <StatusChip tone="neutral">Sistema</StatusChip>
                  ) : (
                    <StatusChip tone="info">Personalizado</StatusChip>
                  )}
                </div>
                <div className="env-manager-meta">
                  {environment.pattern ? (
                    <span>
                      patrón <code>{environment.pattern}</code>
                    </span>
                  ) : null}
                  <span>
                    {environment.resolvedCount}/{environment.repositoryCount} repos con rama
                  </span>
                  {environment.aliases.length > 0 ? (
                    <span className="env-manager-aliases">
                      alias: {environment.aliases.join(', ')}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="env-manager-actions">
                {confirmArchive === environment.key ? (
                  <>
                    <span className="env-manager-confirm">¿Archivar?</span>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => void archive(environment.key)}
                      disabled={busy}
                    >
                      Sí
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setConfirmArchive(null)}
                      disabled={busy}
                    >
                      No
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn btn-icon btn-ghost btn-xs"
                      aria-label={`Subir ${environment.label}`}
                      title="Subir"
                      onClick={() => void move(index, -1)}
                      disabled={index === 0 || reordering}
                    >
                      <Icon name="chevron-up" size={13} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-icon btn-ghost btn-xs"
                      aria-label={`Bajar ${environment.label}`}
                      title="Bajar"
                      onClick={() => void move(index, 1)}
                      disabled={index === items.length - 1 || reordering}
                    >
                      <Icon name="chevron-down" size={13} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-icon btn-ghost btn-xs"
                      aria-label={`Editar ${environment.label}`}
                      title="Editar"
                      onClick={() => openEdit(environment)}
                      disabled={busy}
                    >
                      <Icon name="settings" size={13} />
                    </button>
                    {!environment.isSystem ? (
                      <button
                        type="button"
                        className="btn btn-icon btn-ghost btn-xs env-manager-archive"
                        aria-label={`Archivar ${environment.label}`}
                        title="Archivar"
                        onClick={() => setConfirmArchive(environment.key)}
                        disabled={busy}
                      >
                        <Icon name="trash" size={13} />
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && !error && formOpen ? (
        <div
          className="env-manager-preview"
          style={{
            borderColor: withAlpha(form.color, 0.3),
            background: withAlpha(form.color, 0.08),
          }}
        >
          <span
            className="env-badge"
            style={{
              color: form.color,
              backgroundColor: withAlpha(form.color, 0.12),
              borderColor: withAlpha(form.color, 0.35),
            }}
          >
            {form.label.trim().toUpperCase() || 'NUEVO'}
          </span>
          <span>
            Así se verá el ambiente en la matriz. El color ayuda a reconocerlo de un
            vistazo.
          </span>
        </div>
      ) : null}
    </Modal>
  );
}
