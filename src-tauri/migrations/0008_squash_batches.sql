-- Fase 5: agrupar las sesiones de un despliegue en un lote.
ALTER TABLE squash_sessions ADD COLUMN batch_id TEXT;

CREATE INDEX IF NOT EXISTS idx_squash_sessions_batch
  ON squash_sessions(batch_id);
