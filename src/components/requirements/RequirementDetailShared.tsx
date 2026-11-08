import { formatDateTime } from '../../lib/format';
import type {
  DbScriptSummary,
  EnvironmentPresence,
  NoteLevel,
  Tone,
} from '../../types';
import type { IconName } from '../ui/Icon';

export interface NoteLevelMeta {
  value: NoteLevel;
  label: string;
  shortLabel: string;
  hint: string;
  tone: Tone;
  icon: IconName;
}

export const NOTE_LEVELS: NoteLevelMeta[] = [
  {
    value: 'info',
    label: 'Informativa',
    shortLabel: 'Informativa',
    hint: 'Contexto o detalle sin riesgo para el despliegue.',
    tone: 'info',
    icon: 'info',
  },
  {
    value: 'warning',
    label: 'Alerta',
    shortLabel: 'Alerta',
    hint: 'Algo que conviene vigilar antes de desplegar.',
    tone: 'warning',
    icon: 'alert',
  },
  {
    value: 'danger',
    label: 'Peligro',
    shortLabel: 'Peligro',
    hint: 'Bloquea o pone en riesgo el despliegue.',
    tone: 'danger',
    icon: 'alert',
  },
];

export function noteLevelMeta(level: NoteLevel): NoteLevelMeta {
  return NOTE_LEVELS.find((item) => item.value === level) ?? NOTE_LEVELS[0];
}

export function repositoryNeedsAttention(
  branchStatus: string | null | undefined,
): boolean {
  return branchStatus === 'missing' || branchStatus === 'planned';
}

export function scriptPreview(script: DbScriptSummary): string {
  const text = script.content?.trim() || script.filePath || '';
  if (!text) return 'SQL sin contenido';
  const line = text.split(/\r?\n/).find((value) => value.trim().length > 0) ?? text;
  const trimmed = line.trim();
  return trimmed.length > 110 ? `${trimmed.slice(0, 110)}…` : trimmed;
}

export function branchStatusTone(
  status: string,
): 'success' | 'warning' | 'info' | 'neutral' {
  switch (status) {
    case 'created':
      return 'success';
    case 'existing':
      return 'info';
    case 'missing':
      return 'warning';
    default:
      return 'neutral';
  }
}

export function branchStatusLabel(status: string): string {
  switch (status) {
    case 'created':
      return 'Creada';
    case 'existing':
      return 'Existente';
    case 'missing':
      return 'Falta';
    case 'deleted':
      return 'Borrada';
    default:
      return 'Planificada';
  }
}

export function DetailField({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string | null;
  wide?: boolean;
}) {
  return (
    <div className={`req-detail-field ${wide ? 'req-detail-field-wide' : ''}`}>
      <span className="req-detail-label">{label}</span>
      <span className="req-detail-value">{value?.trim() || '—'}</span>
    </div>
  );
}

const PRESENCE_LABEL: Record<EnvironmentPresence['status'], string> = {
  applied: 'aplicado',
  partial: 'parcial',
  pending: 'pendiente',
  unknown: 'sin datos',
  no_changes: 'sin cambios',
};

function presenceTooltip(env: EnvironmentPresence): string {
  const lines = [env.detail ?? PRESENCE_LABEL[env.status]];
  if (env.branch) lines.push(`Rama: ${env.branch}`);
  if (env.evidence === 'ancestry') {
    lines.push('Evidencia: el commit ya está en la rama del ambiente.');
  } else if (env.evidence === 'content') {
    lines.push('Evidencia: comparación de contenido entre ramas.');
  }
  if (env.pushedAt) {
    lines.push(
      `Última rama hija empujada: ${env.pushedBranch ?? '—'} (${formatDateTime(env.pushedAt)})`,
    );
  }
  if (env.pendingFiles.length > 0) {
    const shown = env.pendingFiles.slice(0, 6);
    lines.push(
      `Faltan: ${shown.join(', ')}${env.pendingFiles.length > shown.length ? '…' : ''}`,
    );
  }
  return lines.join('\n');
}

export function EnvPresenceChip({ env }: { env: EnvironmentPresence }) {
  const counter =
    env.status === 'no_changes'
      ? '—'
      : env.status === 'unknown'
        ? '?'
        : `${env.filesApplied}/${env.filesTotal}`;
  return (
    <span
      className={`req-env-chip is-${env.status}`}
      title={presenceTooltip(env)}
    >
      <span
        className="req-env-dot"
        style={env.color ? { background: env.color } : undefined}
      />
      <strong>{env.label}</strong>
      <em>{counter}</em>
      {env.pushedAt ? <span className="req-env-pushed">↑</span> : null}
    </span>
  );
}
