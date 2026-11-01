export interface PhaseInfo {
  phase: string;
  title: string;
  /** Etiqueta corta para espacios reducidos (por ejemplo, el sidebar). */
  shortTitle?: string;
  summary: string;
  bullets: string[];
  status: 'done' | 'current' | 'next';
}

/** Fase ya entregada que la app toma como referencia. */
export const CURRENT_PHASE = 'Fase 7';
/** Fase en la que se está trabajando (roadmap opcional). */
export const NEXT_PHASE = 'Fase 8';
/** Fases planificadas en el roadmap (sin contar la fase futura). */
export const TOTAL_PHASES = 8;

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
    status: 'done',
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
    status: 'done',
  },
  'Fase 3': {
    phase: 'Fase 3',
    title: 'Ramas y análisis de commits',
    summary:
      'Crea la rama de cada requerimiento desde la base y revisa qué cambió realmente.',
    bullets: [
      'Creación de ramas desde origin/<base> con validación de nombres.',
      'Análisis base..rama: commits, ahead/behind, archivos y merge-base.',
      'Alerta y bloqueo cuando una rama no tiene commits.',
      'Comparación entre varios requerimientos del mismo repositorio.',
    ],
    status: 'done',
  },
  'Fase 4': {
    phase: 'Fase 4',
    title: 'Squash y resolución de conflictos',
    summary:
      'Unifica varios requerimientos por repositorio y prepara un solo commit por despliegue.',
    bullets: [
      'Selección de todos los commits o de un subconjunto por requerimiento.',
      'Squash con mensaje editable y trailers de trazabilidad.',
      'Pausa ante conflictos, apertura en VS Code, staging y continuación.',
      'Worktrees aislados para no tocar tu copia de trabajo.',
    ],
    status: 'done',
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
    status: 'done',
  },
  'Fase 6': {
    phase: 'Fase 6',
    title: 'Scripts de base de datos',
    shortTitle: 'Scripts BD',
    summary:
      'Ordena los scripts que acompañan cada requerimiento y ejecútalos con control.',
    bullets: [
      'Conexiones SQL Server y PostgreSQL por ambiente, con secretos cifrados.',
      'Scripts ordenados, con editor SQL y checksum.',
      'Ejecución con confirmación, salida en vivo y detención ante error.',
      'Alerta clara y opción de omitir cuando no hay conexión configurada.',
    ],
    status: 'done',
  },
  'Fase 7': {
    phase: 'Fase 7',
    title: 'Estado por ambiente e historial',
    summary:
      'Consulta en qué ambiente vive cada requerimiento y reanuda los lotes con reintentos.',
    bullets: [
      'Evaluador de presencia por Git, PR e historial de despliegues.',
      'Matriz por repositorio, chips multi-repo y refresco manual.',
      'Pantalla de lotes con reanudación y reintentos.',
      'El merge en GitHub se refleja como QAS 3/3.',
    ],
    status: 'done',
  },
  'Fase 8': {
    phase: 'Fase 8',
    title: 'Endurecimiento y entrega',
    summary:
      'Cierra la app con pruebas de extremo a extremo, accesibilidad y empaquetado.',
    bullets: [
      'Pruebas E2E manuales, manejo de errores, accesibilidad y rendimiento con 10k requerimientos.',
      'Empaquetado NSIS/MSI, iconos y workflow de release.',
      'Documentación de usuario y troubleshooting.',
      'Instalador y checklist de aceptación completo.',
    ],
    status: 'next',
  },
};
