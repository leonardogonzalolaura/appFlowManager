-- Catálogo global de ambientes. Los cuatro originales pasan a ser datos
-- iniciales, no una restricción del esquema.

CREATE TABLE environments (
  key          TEXT PRIMARY KEY,
  label        TEXT NOT NULL,
  color        TEXT NOT NULL DEFAULT '#7c8cff',
  position_no  INTEGER NOT NULL DEFAULT 0,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  pattern      TEXT,
  is_system    INTEGER NOT NULL DEFAULT 0,
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

INSERT INTO environments
  (key, label, color, position_no, aliases_json, pattern, is_system, is_active, created_at, updated_at)
VALUES
  ('dev', 'DEV', '#6aa8ff', 0,
   '["dev","develop","development"]', NULL, 1, 1,
   strftime('%Y-%m-%dT%H:%M:%SZ','now'), strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('qas', 'QAS', '#f5b84b', 1,
   '["qas","qa","quality","staging","stage"]', 'release/*', 1, 1,
   strftime('%Y-%m-%dT%H:%M:%SZ','now'), strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('uat', 'UAT', '#b08cff', 2,
   '["uat","preuat","pre-uat"]', NULL, 1, 1,
   strftime('%Y-%m-%dT%H:%M:%SZ','now'), strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('prd', 'PRD', '#3dd68c', 3,
   '["prd","prod","production","main","master"]', NULL, 1, 1,
   strftime('%Y-%m-%dT%H:%M:%SZ','now'), strftime('%Y-%m-%dT%H:%M:%SZ','now'));

-- Reconstrucción para eliminar el CHECK fijo de dev/qas/uat/prd y mover
-- aliases/pattern al catálogo global.
CREATE TABLE repo_environments_new (
  id               TEXT PRIMARY KEY,
  repository_id    TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  environment      TEXT NOT NULL REFERENCES environments(key) ON UPDATE CASCADE,
  branch_name      TEXT,
  resolution_mode  TEXT NOT NULL DEFAULT 'auto'
                   CHECK (resolution_mode IN ('auto','manual')),
  resolved_sha     TEXT,
  resolved_at      TEXT,
  resolution_note  TEXT,
  updated_at       TEXT NOT NULL,
  UNIQUE (repository_id, environment)
);

INSERT INTO repo_environments_new
  (id, repository_id, environment, branch_name, resolution_mode,
   resolved_sha, resolved_at, resolution_note, updated_at)
SELECT id, repository_id, environment, branch_name, resolution_mode,
       resolved_sha, resolved_at, resolution_note, updated_at
FROM repo_environments;

DROP TABLE repo_environments;
ALTER TABLE repo_environments_new RENAME TO repo_environments;

CREATE INDEX idx_repo_environments_repo ON repo_environments(repository_id);
