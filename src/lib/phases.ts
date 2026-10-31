export interface PhaseInfo {
  phase: string;
  title: string;
  summary: string;
  bullets: string[];
  status: 'done' | 'current' | 'next';
}

export const PHASE_INFO: Record<string, PhaseInfo> = {
  'Fase 1': {
    phase: 'Fase 1',
    title: 'Repositorios y ambientes',
    summary:
      'Conecta tus repos locales y deja que FlowManager detecte la rama de cada ambiente.',
    bullets: [
      'Alta de repositorios por ruta o clonado desde una URL.',
      'Detección de dev, qas, uat y prd con evidencia de la rama.',
      'Override manual por repositorio y validación de la rama base.',
      'Vista de matriz repo × ambiente para revisar todo de un vistazo.',
    ],
    status: 'next',
  },
  'Fase 2': {
    phase: 'Fase 2',
    title: 'Requerimientos desde Monday o manuales',
    summary:
      'Importa el export de Monday y registra los requerimientos que todavía no están allí.',
    bullets: [
      'Importación CSV/XLSX con vista previa y upsert por Task ID.',
      'Registro manual con key automática MAN-0001 y edición posterior.',
      'Lista tipo Excel con filtros, incluido "mis requerimientos".',
      'Mapeo de cada requerimiento a uno o varios repositorios.',
    ],
    status: 'next',
  },
  'Fase 5': {
    phase: 'Fase 5',
    title: 'Rama de despliegue y push seguro',
    summary:
      'Prepara una rama hija del ambiente y empuja solo esa rama, nunca el ambiente.',
    bullets: [
      'Rama hija creada desde origin/<ambiente> con base verificada.',
      'Push únicamente de la rama propia y con force-with-lease.',
      'Guard duro que rechaza cualquier push a dev, qas, uat, prd o release/*.',
      'Enlaces de comparación y PR para que el merge lo hagas tú en GitHub.',
    ],
    status: 'next',
  },
  'Fase 6': {
    phase: 'Fase 6',
    title: 'Scripts de base de datos',
    summary:
      'Ordena los scripts que acompañan cada requerimiento y ejecútalos con control.',
    bullets: [
      'Conexiones SQL Server y PostgreSQL por ambiente, con secretos cifrados.',
      'Scripts ordenados, con editor SQL y checksum.',
      'Ejecución con confirmación, salida en vivo y detención ante error.',
      'Alerta clara y opción de omitir cuando no hay conexión configurada.',
    ],
    status: 'next',
  },
};
