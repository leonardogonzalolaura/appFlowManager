-- Fase 3: metadatos de creación y análisis de ramas por requerimiento.
ALTER TABLE requirement_repositories ADD COLUMN base_sha TEXT;
ALTER TABLE requirement_repositories ADD COLUMN branch_created_at TEXT;
ALTER TABLE requirement_repositories ADD COLUMN last_analyzed_at TEXT;
ALTER TABLE requirement_repositories ADD COLUMN last_analysis_json TEXT;
ALTER TABLE requirement_repositories ADD COLUMN created_by_app INTEGER NOT NULL DEFAULT 0;
