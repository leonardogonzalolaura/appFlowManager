import { useState } from 'react';
import type { DbScriptSummary, RequirementDetail } from '../../types';
import { RequirementScriptsModal } from '../database/RequirementScriptsModal';
import { Icon } from '../ui/Icon';
import { Spinner } from '../ui/Spinner';
import { StatusChip } from '../ui/StatusChip';
import { scriptPreview } from './RequirementDetailShared';
import '../../database.css';

interface RequirementScriptsTabProps {
  detail: RequirementDetail;
  scripts: DbScriptSummary[];
  loading: boolean;
  onRefreshScripts: () => void;
  onChanged: () => void;
}

export function RequirementScriptsTab({
  detail,
  scripts,
  loading,
  onRefreshScripts,
  onChanged,
}: RequirementScriptsTabProps) {
  const [scriptsOpen, setScriptsOpen] = useState(false);

  return (
    <>
      <section className="req-detail-section">
        <div className="req-tab-toolbar">
          <div className="req-section-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setScriptsOpen(true)}
            >
              <Icon name="database" size={13} />
              Gestionar scripts
            </button>
          </div>
        </div>

        {loading ? (
          <div className="req-scripts-loading">
            <Spinner size="sm" />
            <span>Leyendo scripts…</span>
          </div>
        ) : scripts.length === 0 ? (
          <p className="req-empty-line">
            No hay scripts SQL. Usa “Gestionar scripts” para agregar el primero.
          </p>
        ) : (
          <div className="req-script-list">
            {scripts.map((script) => (
              <button
                key={script.id}
                type="button"
                className="req-script-item"
                onClick={() => setScriptsOpen(true)}
                title="Abrir para editar o ejecutar"
              >
                <span className="req-script-seq">{script.sequenceNo}</span>
                <span className="req-script-copy">
                  <strong>{script.name}</strong>
                  <small>
                    {script.repositoryName} ·{' '}
                    {script.engine === 'sqlserver'
                      ? 'SQL Server'
                      : 'PostgreSQL'}{' '}
                    ·{' '}
                    {script.environmentScope === 'all'
                      ? 'todos los ambientes'
                      : `solo ${script.environmentScope}`}
                  </small>
                  <span
                    className="req-script-sql"
                    title={script.filePath ?? script.content ?? ''}
                  >
                    {scriptPreview(script)}
                  </span>
                </span>
                <code>{script.checksum.slice(0, 8)}</code>
                <StatusChip tone={script.isActive ? 'info' : 'neutral'}>
                  {script.isActive ? 'Activo' : 'Inactivo'}
                </StatusChip>
                <Icon name="chevron-right" size={13} />
              </button>
            ))}
          </div>
        )}
      </section>

      {scriptsOpen ? (
        <RequirementScriptsModal
          requirementId={detail.id}
          requirementKey={detail.externalKey}
          repositories={detail.repositories}
          onClose={() => setScriptsOpen(false)}
          onChanged={() => {
            onRefreshScripts();
            onChanged();
          }}
        />
      ) : null}
    </>
  );
}
