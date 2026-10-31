import { PHASE_INFO } from '../../lib/phases';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { StatusChip } from '../ui/StatusChip';

interface PhaseModalProps {
  phase: string;
  onClose: () => void;
}

export function PhaseModal({ phase, onClose }: PhaseModalProps) {
  const info = PHASE_INFO[phase];

  if (!info) {
    return (
      <Modal title="Próximamente" size="sm" onClose={onClose}>
        <p className="confirm-message">
          Esta parte se habilita en una fase siguiente del roadmap.
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      title={info.title}
      description={info.summary}
      size="md"
      icon={<Icon name="rocket" size={20} />}
      badge={<StatusChip tone="neutral">{info.phase}</StatusChip>}
      onClose={onClose}
      footer={
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Entendido
        </button>
      }
    >
      <ul className="phase-bullets">
        {info.bullets.map((bullet) => (
          <li key={bullet}>
            <span className="phase-bullet-icon">
              <Icon name="check" size={12} />
            </span>
            {bullet}
          </li>
        ))}
      </ul>
      <div className="guide-note">
        <Icon name="info" size={15} />
        <span>
          Las fases se habilitan a medida que validamos la anterior. Cada pieza
          queda probada antes de seguir con la siguiente.
        </span>
      </div>
    </Modal>
  );
}
