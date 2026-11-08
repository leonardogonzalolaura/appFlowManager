-- Nivel de la nota local del requerimiento: informativa, alerta o peligro.
ALTER TABLE requirements
  ADD COLUMN note_level TEXT NOT NULL DEFAULT 'info'
  CHECK (note_level IN ('info', 'warning', 'danger'));
