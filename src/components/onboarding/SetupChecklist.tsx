import type { ChecklistItem } from '../../lib/setup';
import { Icon } from '../ui/Icon';
import { StatusChip } from '../ui/StatusChip';

interface SetupChecklistProps {
  items: ChecklistItem[];
  onOpenDiagnostics: () => void;
  onOpenRepositories: () => void;
  onOpenRequirements: () => void;
  onOpenPhase: (phase: string) => void;
}

export function SetupChecklist({
  items,
  onOpenDiagnostics,
  onOpenRepositories,
  onOpenRequirements,
  onOpenPhase,
}: SetupChecklistProps) {
  return (
    <section className="surface setup-panel" aria-labelledby="setup-title">
      <header className="surface-header">
        <div>
          <h2 id="setup-title" className="surface-title">
            Primeros pasos
          </h2>
          <p className="surface-subtitle">
            Un camino corto para dejar todo listo, sin configuración innecesaria.
          </p>
        </div>
        <StatusChip tone="neutral">4 pasos</StatusChip>
      </header>

      <ol className="setup-list">
        {items.map((item) => (
          <li
            key={item.id}
            className={`setup-step ${item.done ? 'is-done' : ''} ${item.available ? '' : 'is-future'}`.trim()}
          >
            <span className={`setup-marker ${item.done ? 'is-done' : ''}`}>
              {item.done ? <Icon name="check" size={14} /> : item.step}
            </span>

            <div className="setup-body">
              <div className="setup-head">
                <h3 className="setup-title">{item.title}</h3>
                {item.done ? (
                  <StatusChip tone="success">Completado</StatusChip>
                ) : item.available ? (
                  <StatusChip tone="warning">Pendiente</StatusChip>
                ) : (
                  <StatusChip tone="neutral">{item.phase}</StatusChip>
                )}
              </div>
              <p className="setup-description">{item.description}</p>
              <div className="setup-footer">
                <span className="setup-detail">{item.detail}</span>
                {item.id === 'repositorios' ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={onOpenRepositories}
                  >
                    {item.done ? 'Revisar repositorios' : 'Configurar repositorios'}
                    <Icon name="chevron-right" size={13} />
                  </button>
                ) : item.id === 'requerimientos' ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={onOpenRequirements}
                  >
                    {item.done ? 'Ver requerimientos' : 'Cargar requerimientos'}
                    <Icon name="chevron-right" size={13} />
                  </button>
                ) : item.available ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={onOpenDiagnostics}
                  >
                    Ver diagnóstico
                    <Icon name="chevron-right" size={13} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => onOpenPhase(item.phase)}
                  >
                    Ver qué incluye
                    <Icon name="chevron-right" size={13} />
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
