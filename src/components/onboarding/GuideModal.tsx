import type { SystemInfo } from '../../types';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { StatusChip } from '../ui/StatusChip';

interface GuideModalProps {
  info: SystemInfo;
  onClose: () => void;
  onGoSettings: () => void;
}

export function GuideModal({ info, onClose, onGoSettings }: GuideModalProps) {
  const { setup } = info;

  const steps = [
    {
      title: 'Verifica el entorno',
      phase: 'Fase 0',
      description:
        'FlowManager comprueba Git y crea su base local. Si algo falta, aquí verás exactamente qué hacer.',
      done: setup.gitOk && setup.databaseOk,
      available: true,
    },
    {
      title: 'Conecta tus repositorios',
      phase: 'Fase 1',
      description:
        'Agrega tus repos y confirma la rama de cada ambiente. La app propone una detección automática y tú puedes cambiarla.',
      done: setup.repositoriesOk,
      available: true,
    },
    {
      title: 'Carga tus requerimientos',
      phase: 'Fase 2',
      description:
        'Importa el export de Monday o registra un requerimiento manual. Después podrás mapearlo a uno o varios repos.',
      done: setup.requirementsOk,
      available: true,
    },
    {
      title: 'Configura las bases de datos',
      phase: 'Fase 6',
      description:
        'Conecta SQL Server y PostgreSQL por ambiente, ordena los scripts y ejecútalos con confirmación.',
      done: setup.databaseConfigured,
      available: true,
    },
  ];

  return (
    <Modal
      title="Guía de configuración"
      description="Cuatro pasos para dejar FlowManager listo. Puedes avanzar a tu ritmo."
      size="lg"
      icon={<Icon name="book" size={20} />}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onGoSettings}>
            Ir a configuración
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Entendido
          </button>
        </>
      }
    >
      <div className="guide-intro">
        <span className="guide-intro-icon">
          <Icon name="sparkles" size={15} />
        </span>
        <p>
          No necesitas configurar todo hoy. La app te irá guiando en cada fase y
          nunca ejecutará nada destructivo sin tu confirmación.
        </p>
      </div>

      <ol className="guide-steps">
        {steps.map((step) => (
          <li key={step.title} className="guide-step">
            <span className={`guide-step-icon ${step.done ? 'is-done' : ''}`}>
              {step.done ? <Icon name="check" size={15} /> : <Icon name="play" size={13} />}
            </span>
            <div className="guide-step-body">
              <div className="guide-step-head">
                <h3>{step.title}</h3>
                {step.done ? (
                  <StatusChip tone="success">Listo</StatusChip>
                ) : step.available ? (
                  <StatusChip tone="warning">Pendiente</StatusChip>
                ) : (
                  <StatusChip tone="neutral">{step.phase}</StatusChip>
                )}
              </div>
              <p>{step.description}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="guide-note">
        <Icon name="shield" size={15} />
        <span>
          Tus credenciales se guardarán cifradas con DPAPI y la app nunca hará
          push ni merge sobre las ramas de ambiente.
        </span>
      </div>
    </Modal>
  );
}
