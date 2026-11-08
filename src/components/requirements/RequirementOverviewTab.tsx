import type { RequirementDetail } from '../../types';
import { Icon } from '../ui/Icon';
import { StatusChip } from '../ui/StatusChip';
import { DetailField } from './RequirementDetailShared';

interface RequirementOverviewTabProps {
  detail: RequirementDetail;
}

export function RequirementOverviewTab({ detail }: RequirementOverviewTabProps) {
  const totalSp = detail.subtasks.reduce(
    (sum, subtask) => sum + (subtask.estimatedSp ?? 0),
    0,
  );

  return (
    <>
      <section className="req-detail-section">
        <div className="req-detail-section-head">
          <h3>Información del ticket</h3>
        </div>

        <div className="req-detail-grid">
          <DetailField label="Feature" value={detail.feature} />
          <DetailField label="Tipo" value={detail.type} />
          <DetailField label="Developer" value={detail.developer} />
          <DetailField label="QA" value={detail.qa} />
          <DetailField label="Estado" value={detail.status} />
          <DetailField label="Prioridad" value={detail.priority} />
          <DetailField label="Informed" value={detail.informed} />
          <DetailField
            label="Timeline"
            value={
              detail.timelineStart || detail.timelineEnd
                ? `${detail.timelineStart ?? '—'} → ${detail.timelineEnd ?? '—'}`
                : null
            }
          />
          <DetailField
            label="Sub Tasks (Monday)"
            value={detail.subtasksSummary}
            wide
          />
        </div>

        {detail.source === 'monday' ? (
          <div className="req-readonly-note">
            <Icon name="lock" size={14} />
            <span>
              Los campos de Monday no se editan aquí. Las notas locales y los
              mapeos sí se conservan y puedes cambiarlos.
            </span>
          </div>
        ) : null}
      </section>

      <section className="req-detail-section">
        <div className="req-detail-section-head">
          <h3>
            Subitems{' '}
            <span className="req-section-count">{detail.subtasks.length}</span>
          </h3>
          {totalSp > 0 ? (
            <span className="req-section-meta">{totalSp} SP estimados</span>
          ) : null}
        </div>

        {detail.subtasks.length === 0 ? (
          <p className="req-empty-line">
            {detail.subtasksSummary ?? 'Sin subitems en el export.'}
          </p>
        ) : (
          <div className="req-subtasks">
            {detail.subtasks.map((subtask) => (
              <div key={subtask.id} className="req-subtask">
                <span className="req-subtask-name">{subtask.name}</span>
                <span className="req-subtask-owner">{subtask.owner ?? '—'}</span>
                <StatusChip
                  tone={
                    subtask.status === 'Done'
                      ? 'success'
                      : subtask.status
                        ? 'info'
                        : 'neutral'
                  }
                >
                  {subtask.status ?? 'Sin estado'}
                </StatusChip>
                <span className="req-subtask-sp">
                  {subtask.estimatedSp ?? '—'} SP
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
