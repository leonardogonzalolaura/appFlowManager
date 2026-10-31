import { useState } from 'react';
import { isTauri, normalizeError } from '../../lib/api';
import { pickImportFile } from '../../lib/dialog';
import { commitImport, previewImport } from '../../lib/requirements';
import type { ApiError, ImportPreview, ImportResult } from '../../types';
import { Callout } from '../ui/Callout';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';
import { StatusChip } from '../ui/StatusChip';

interface ImportRequirementsModalProps {
  onClose: () => void;
  onImported: (result: ImportResult) => void;
}

export function ImportRequirementsModal({
  onClose,
  onImported,
}: ImportRequirementsModalProps) {
  const [filePath, setFilePath] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [adoptManual, setAdoptManual] = useState(false);
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const demo = !isTauri();

  async function chooseFile() {
    const selected = await pickImportFile();
    if (!selected) return;
    setFilePath(selected);
    setPreview(null);
    setError(null);
    setLoading(true);
    try {
      const loaded = await previewImport(selected);
      setPreview(loaded);
    } catch (caught) {
      setError(normalizeError(caught));
    } finally {
      setLoading(false);
    }
  }

  async function commit() {
    if (!preview || !filePath) return;
    setCommitting(true);
    setError(null);
    try {
      const result = await commitImport({
        filePath,
        fileHash: preview.fileHash,
        adoptManualKeys: adoptManual,
      });
      onImported(result);
    } catch (caught) {
      setError(normalizeError(caught));
    } finally {
      setCommitting(false);
    }
  }

  const changes = preview
    ? preview.newCount +
      preview.updatedCount +
      preview.absentCount +
      (adoptManual ? Math.max(0, preview.manualConflictCount) : 0)
    : 0;

  return (
    <Modal
      title="Importar requerimientos"
      description="Importa el export de Monday en Excel o CSV. Reimportar no duplica: se actualiza por Task ID."
      size="lg"
      icon={<Icon name="package" size={20} />}
      onClose={committing ? () => undefined : onClose}
      closeOnBackdrop={!committing}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={committing}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void commit()}
            disabled={!preview || committing || changes === 0}
          >
            {committing ? <Spinner size="sm" /> : <Icon name="check" size={14} />}
            {committing
              ? 'Importando…'
              : preview
                ? `Importar ${changes} cambio(s)`
                : 'Importar'}
          </button>
        </>
      }
    >
      <div className="import-file">
        <div className="import-file-copy">
          <span className="import-file-icon">
            <Icon name="file" size={18} />
          </span>
          <div>
            <strong>
              {preview?.fileName ??
                (filePath ? filePath.split(/[\\/]/).pop() : 'Sin archivo seleccionado')}
            </strong>
            <span>
              {preview
                ? `${preview.totalRows} filas · ${preview.source === 'monday_xlsx' ? 'Excel de Monday' : 'CSV'}`
                : 'Selecciona el export que descargaste de Monday.'}
            </span>
          </div>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void chooseFile()}
          disabled={loading || committing || demo}
        >
          {loading ? <Spinner size="sm" /> : <Icon name="folder" size={14} />}
          {loading ? 'Leyendo…' : preview ? 'Cambiar archivo' : 'Seleccionar archivo'}
        </button>
      </div>

      {demo ? (
        <Callout tone="info" title="Vista previa web" icon="eye">
          La importación requiere la app de escritorio y un archivo local.
        </Callout>
      ) : null}

      {error ? (
        <Callout tone="danger" title="No se pudo importar">
          {error.message}
        </Callout>
      ) : null}

      {loading ? (
        <div className="import-loading">
          <Spinner size="lg" label="Leyendo filas y comparando con la base…" />
        </div>
      ) : preview ? (
        <>
          <div className="import-summary">
            <ImportCount label="Nuevos" value={preview.newCount} tone="success" />
            <ImportCount label="Actualizados" value={preview.updatedCount} tone="info" />
            <ImportCount label="Sin cambios" value={preview.unchangedCount} tone="neutral" />
            <ImportCount label="Ausentes" value={preview.absentCount} tone="warning" />
            <ImportCount
              label="Manuales"
              value={preview.manualConflictCount}
              tone={preview.manualConflictCount ? 'warning' : 'neutral'}
            />
            <ImportCount
              label="Inválidas"
              value={preview.invalidCount}
              tone={preview.invalidCount ? 'danger' : 'neutral'}
            />
          </div>

          {preview.manualConflictCount > 0 ? (
            <section className="import-section import-conflict-section">
              <div className="import-section-head">
                <h3>Conflictos con requerimientos manuales</h3>
                <StatusChip tone="warning">{preview.manualConflictCount}</StatusChip>
              </div>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={adoptManual}
                  onChange={(event) => setAdoptManual(event.target.checked)}
                />
                <span>
                  Vincular y actualizar los manuales que coincidan
                  <small>
                    Conserva notas, mapeos y scripts. Los que estén bloqueados se omiten.
                  </small>
                </span>
              </label>
              <div className="import-list">
                {preview.manualConflicts.map((conflict) => (
                  <div key={conflict.externalKey} className="import-list-row">
                    <code>{conflict.externalKey}</code>
                    <span>{conflict.title}</span>
                    <span className="import-list-meta">
                      {conflict.archived
                        ? 'Archivado'
                        : conflict.manualLocked
                          ? 'Bloqueado'
                          : 'Se conservará si no vinculas'}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {preview.newItems.length > 0 ? (
            <section className="import-section">
              <div className="import-section-head">
                <h3>Nuevos</h3>
                <span className="req-section-meta">mostrando {preview.newItems.length}</span>
              </div>
              <div className="import-list">
                {preview.newItems.map((item) => (
                  <div key={item.externalKey} className="import-list-row">
                    <code>{item.externalKey}</code>
                    <span>{item.title}</span>
                    <span className="import-list-meta">
                      {item.developer ?? 'Sin developer'}
                      {item.subtaskCount ? ` · ${item.subtaskCount} subitems` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {preview.updatedItems.length > 0 ? (
            <section className="import-section">
              <div className="import-section-head">
                <h3>Actualizados</h3>
                <span className="req-section-meta">mostrando {preview.updatedItems.length}</span>
              </div>
              <div className="import-list">
                {preview.updatedItems.map((item) => (
                  <div key={item.externalKey} className="import-list-row import-list-row-updated">
                    <code>{item.externalKey}</code>
                    <span>{item.title}</span>
                    <span className="import-list-meta">
                      {item.changes
                        .slice(0, 3)
                        .map((change) => change.field)
                        .join(', ')}
                      {item.changes.length > 3 ? ` +${item.changes.length - 3}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {preview.absentCount > 0 ? (
            <section className="import-section">
              <div className="import-section-head">
                <h3>Presentes en la base pero ausentes del archivo</h3>
                <StatusChip tone="warning">{preview.absentCount}</StatusChip>
              </div>
              <p className="import-section-hint">
                No se borran. Se marcan como ausentes de la última importación.
              </p>
              <div className="import-list">
                {preview.absentItems.slice(0, 8).map((item) => (
                  <div key={item.externalKey} className="import-list-row">
                    <code>{item.externalKey}</code>
                    <span>{item.title}</span>
                    <span className="import-list-meta">{item.status ?? '—'}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {preview.invalidCount > 0 ? (
            <section className="import-section">
              <div className="import-section-head">
                <h3>Filas inválidas</h3>
                <StatusChip tone="danger">{preview.invalidCount}</StatusChip>
              </div>
              <div className="import-list">
                {preview.invalidRows.slice(0, 8).map((row) => (
                  <div key={`${row.rowNumber}-${row.preview}`} className="import-list-row">
                    <code>Fila {row.rowNumber}</code>
                    <span>{row.reason}</span>
                    <span className="import-list-meta">{row.preview}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {preview.duplicateCount > 0 ? (
            <Callout tone="warning" title="Task IDs duplicados en el archivo">
              {preview.duplicateKeys.join(', ')}. Se fusionaron en una sola fila.
            </Callout>
          ) : null}
        </>
      ) : null}
    </Modal>
  );
}

function ImportCount({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'success' | 'info' | 'neutral' | 'warning' | 'danger';
}) {
  return (
    <div className={`import-count import-count-${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
