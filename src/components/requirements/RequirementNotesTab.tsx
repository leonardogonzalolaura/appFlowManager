import type { NoteLevel } from '../../types';
import { Icon } from '../ui/Icon';
import { Spinner } from '../ui/Spinner';
import { NOTE_LEVELS, noteLevelMeta } from './RequirementDetailShared';

interface RequirementNotesTabProps {
  notes: string;
  noteLevel: NoteLevel;
  saving: boolean;
  dirty: boolean;
  onNotesChange: (value: string) => void;
  onNoteLevelChange: (level: NoteLevel) => void;
  onSave: () => void;
}

export function RequirementNotesTab({
  notes,
  noteLevel,
  saving,
  dirty,
  onNotesChange,
  onNoteLevelChange,
  onSave,
}: RequirementNotesTabProps) {
  const meta = noteLevelMeta(noteLevel);
  const hasNotes = notes.trim().length > 0;

  return (
    <section className="req-detail-section">
      <div className="req-tab-toolbar">
        <div className="req-section-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onSave}
            disabled={!dirty || saving}
          >
            {saving ? <Spinner size="sm" /> : <Icon name="check" size={13} />}
            Guardar notas
          </button>
        </div>
      </div>

      <div className="req-note-levels" role="group" aria-label="Nivel de la nota">
        {NOTE_LEVELS.map((level) => {
          const active = noteLevel === level.value;
          return (
            <button
              key={level.value}
              type="button"
              className={`req-note-level is-${level.tone} ${
                active ? 'is-active' : ''
              }`.trim()}
              aria-pressed={active}
              disabled={!hasNotes}
              title={level.hint}
              onClick={() => onNoteLevelChange(level.value)}
            >
              <Icon name={level.icon} size={13} />
              {level.label}
            </button>
          );
        })}
      </div>

      <div className={`req-note-editor is-${meta.tone}`.trim()}>
        <textarea
          className="input textarea"
          rows={7}
          value={notes}
          onChange={(event) => onNotesChange(event.target.value)}
          placeholder="Contexto, enlaces o decisiones locales."
        />
      </div>

      <p className="req-note-hint">
        <Icon name={hasNotes ? meta.icon : 'info'} size={12} />
        {hasNotes
          ? meta.hint
          : 'Escribe una nota y elige su nivel: Informativa, Alerta o Peligro.'}
      </p>
    </section>
  );
}
