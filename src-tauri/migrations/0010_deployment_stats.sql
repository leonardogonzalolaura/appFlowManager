-- Fase 6: estadísticas reales del commit de la rama hija.
-- `files_changed/additions/deletions` describen el squash (paso 1); estas
-- columnas describen lo que realmente agrega la rama hija sobre el ambiente.
ALTER TABLE squash_sessions ADD COLUMN deploy_files_changed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE squash_sessions ADD COLUMN deploy_additions INTEGER NOT NULL DEFAULT 0;
ALTER TABLE squash_sessions ADD COLUMN deploy_deletions INTEGER NOT NULL DEFAULT 0;
