-- Fase 5: destino de despliegue, rama hija y push seguro.
ALTER TABLE squash_sessions ADD COLUMN environment TEXT;
ALTER TABLE squash_sessions ADD COLUMN target_branch TEXT;
ALTER TABLE squash_sessions ADD COLUMN target_base_sha TEXT;
ALTER TABLE squash_sessions ADD COLUMN deploy_branch TEXT;
ALTER TABLE squash_sessions ADD COLUMN deploy_sha TEXT;
ALTER TABLE squash_sessions ADD COLUMN pushed_sha TEXT;
ALTER TABLE squash_sessions ADD COLUMN pushed_at TEXT;
ALTER TABLE squash_sessions ADD COLUMN phase TEXT NOT NULL DEFAULT 'squash';
