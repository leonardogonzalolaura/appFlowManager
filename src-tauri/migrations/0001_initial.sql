-- FlowManager - esquema inicial (Fase 0)
-- Fechas ISO-8601 UTC en TEXT. Booleanos 0/1.

CREATE TABLE app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

INSERT INTO app_settings (key, value, updated_at) VALUES
  ('base_branch', 'master', strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('manual_key_prefix', 'MAN', strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('log_level', 'info', strftime('%Y-%m-%dT%H:%M:%SZ','now'))
ON CONFLICT(key) DO NOTHING;

CREATE TABLE repositories (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  local_path      TEXT NOT NULL UNIQUE,
  remote_name     TEXT NOT NULL DEFAULT 'origin',
  remote_url      TEXT,
  provider        TEXT NOT NULL DEFAULT 'github'
                  CHECK (provider IN ('github','generic')),
  github_owner    TEXT,
  github_repo     TEXT,
  base_branch     TEXT NOT NULL DEFAULT 'master',
  is_active       INTEGER NOT NULL DEFAULT 1,
  last_fetched_at TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE repo_environments (
  id               TEXT PRIMARY KEY,
  repository_id    TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  environment      TEXT NOT NULL CHECK (environment IN ('dev','qas','uat','prd')),
  branch_name      TEXT,
  resolution_mode  TEXT NOT NULL DEFAULT 'auto'
                   CHECK (resolution_mode IN ('auto','manual')),
  aliases_json     TEXT NOT NULL DEFAULT '[]',
  pattern          TEXT,
  resolved_sha     TEXT,
  resolved_at      TEXT,
  resolution_note  TEXT,
  updated_at       TEXT NOT NULL,
  UNIQUE (repository_id, environment)
);

CREATE TABLE requirement_imports (
  id                 TEXT PRIMARY KEY,
  source             TEXT NOT NULL
                     CHECK (source IN ('monday_csv','monday_xlsx','jira','csv')),
  file_name          TEXT,
  file_hash          TEXT NOT NULL,
  imported_at        TEXT NOT NULL,
  total_rows         INTEGER NOT NULL DEFAULT 0,
  created_count      INTEGER NOT NULL DEFAULT 0,
  updated_count      INTEGER NOT NULL DEFAULT 0,
  unchanged_count    INTEGER NOT NULL DEFAULT 0,
  absent_count       INTEGER NOT NULL DEFAULT 0,
  raw_snapshot_path  TEXT
);

CREATE TABLE requirements (
  id                    TEXT PRIMARY KEY,
  external_key          TEXT NOT NULL UNIQUE,
  source                TEXT NOT NULL DEFAULT 'monday'
                        CHECK (source IN ('monday','manual','jira')),
  title                 TEXT NOT NULL,
  type                  TEXT,
  feature               TEXT,
  status                TEXT,
  priority              TEXT,
  developer_raw         TEXT,
  developer_normalized  TEXT,
  qa_raw                TEXT,
  informed_raw          TEXT,
  subtasks_summary      TEXT,
  timeline_start        TEXT,
  timeline_end          TEXT,
  monday_doc_url        TEXT,
  source_created_at     TEXT,
  source_updated_at     TEXT,
  first_seen_at         TEXT NOT NULL,
  last_seen_at          TEXT NOT NULL,
  last_import_id        TEXT REFERENCES requirement_imports(id) ON DELETE SET NULL,
  last_import_present   INTEGER NOT NULL DEFAULT 1,
  manual_created        INTEGER NOT NULL DEFAULT 0,
  manual_locked         INTEGER NOT NULL DEFAULT 0,
  is_active             INTEGER NOT NULL DEFAULT 1,
  archived_at           TEXT,
  raw_json              TEXT,
  notes                 TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE INDEX idx_requirements_developer ON requirements(developer_normalized);
CREATE INDEX idx_requirements_feature   ON requirements(feature);
CREATE INDEX idx_requirements_status    ON requirements(status);
CREATE INDEX idx_requirements_source    ON requirements(source);
CREATE INDEX idx_requirements_present   ON requirements(last_import_present, is_active);

CREATE TABLE requirement_subtasks (
  id             TEXT PRIMARY KEY,
  requirement_id TEXT NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  owner          TEXT,
  status         TEXT,
  estimated_sp   REAL,
  actual_sp      REAL,
  position_no    INTEGER NOT NULL,
  UNIQUE (requirement_id, position_no)
);

CREATE TABLE requirement_repositories (
  id             TEXT PRIMARY KEY,
  requirement_id TEXT NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  repository_id  TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  branch_name    TEXT NOT NULL,
  base_branch    TEXT NOT NULL DEFAULT 'master',
  branch_status  TEXT NOT NULL DEFAULT 'planned'
                 CHECK (branch_status IN ('planned','created','existing','missing','deleted')),
  mapping_source TEXT NOT NULL DEFAULT 'manual'
                 CHECK (mapping_source IN ('auto','manual')),
  notes          TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (requirement_id, repository_id)
);

CREATE TABLE bundles (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE bundle_members (
  bundle_id      TEXT NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
  requirement_id TEXT NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  position_no    INTEGER NOT NULL,
  PRIMARY KEY (bundle_id, requirement_id),
  UNIQUE (bundle_id, position_no)
);

CREATE TABLE bundle_repositories (
  id             TEXT PRIMARY KEY,
  bundle_id      TEXT NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
  repository_id  TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  branch_name    TEXT NOT NULL,
  base_branch    TEXT NOT NULL DEFAULT 'master',
  branch_status  TEXT NOT NULL DEFAULT 'planned'
                 CHECK (branch_status IN ('planned','created','existing','missing','deleted')),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (bundle_id, repository_id)
);

-- Secretos cifrados con DPAPI. Nunca se envían al frontend.
CREATE TABLE secrets (
  id           TEXT PRIMARY KEY,
  scope        TEXT NOT NULL,
  key          TEXT NOT NULL,
  ciphertext   BLOB NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE (scope, key)
);

CREATE TABLE db_connections (
  id             TEXT PRIMARY KEY,
  repository_id  TEXT REFERENCES repositories(id) ON DELETE CASCADE,
  environment    TEXT NOT NULL CHECK (environment IN ('dev','qas','uat','prd')),
  engine         TEXT NOT NULL CHECK (engine IN ('sqlserver','postgres')),
  host           TEXT NOT NULL,
  port           INTEGER NOT NULL,
  database_name  TEXT NOT NULL,
  username       TEXT NOT NULL,
  secret_id      TEXT NOT NULL REFERENCES secrets(id),
  ssl_mode       TEXT,
  options_json   TEXT,
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (repository_id, environment, engine)
);

CREATE UNIQUE INDEX ux_db_connections_global
  ON db_connections(environment, engine)
  WHERE repository_id IS NULL;

CREATE TABLE db_scripts (
  id                 TEXT PRIMARY KEY,
  requirement_id     TEXT NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  repository_id      TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  engine             TEXT NOT NULL CHECK (engine IN ('sqlserver','postgres')),
  sequence_no        INTEGER NOT NULL,
  environment_scope  TEXT NOT NULL DEFAULT 'all',
  source_type        TEXT NOT NULL DEFAULT 'inline'
                     CHECK (source_type IN ('inline','file')),
  content            TEXT,
  file_path          TEXT,
  checksum           TEXT,
  is_active          INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  UNIQUE (requirement_id, repository_id, sequence_no)
);

CREATE INDEX idx_db_scripts_req_repo ON db_scripts(requirement_id, repository_id, sequence_no);

CREATE TABLE deployment_batches (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  environment   TEXT NOT NULL CHECK (environment IN ('dev','qas','uat','prd')),
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','queued','running','paused_conflict',
                                  'paused_db','completed','partial','failed','cancelled')),
  notes         TEXT,
  settings_json TEXT,
  created_by    TEXT,
  created_at    TEXT NOT NULL,
  started_at    TEXT,
  finished_at   TEXT
);

CREATE TABLE deployment_items (
  id                  TEXT PRIMARY KEY,
  batch_id            TEXT NOT NULL REFERENCES deployment_batches(id) ON DELETE CASCADE,
  bundle_id           TEXT NOT NULL REFERENCES bundles(id),
  repository_id       TEXT NOT NULL REFERENCES repositories(id),
  deploy_branch_name  TEXT NOT NULL,
  target_branch_name  TEXT NOT NULL,
  target_base_sha     TEXT NOT NULL,
  squash_message      TEXT NOT NULL,
  commit_strategy     TEXT NOT NULL DEFAULT 'all_commits'
                      CHECK (commit_strategy IN ('all_commits','selected_commits')),
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','running','conflict','pushed',
                                        'done','failed','blocked','cancelled')),
  position_no         INTEGER NOT NULL,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  UNIQUE (batch_id, repository_id)
);

CREATE TABLE deployment_item_commits (
  id             TEXT PRIMARY KEY,
  item_id        TEXT NOT NULL REFERENCES deployment_items(id) ON DELETE CASCADE,
  requirement_id TEXT NOT NULL REFERENCES requirements(id),
  commit_sha     TEXT NOT NULL,
  commit_message TEXT,
  author         TEXT,
  committed_at   TEXT,
  is_selected    INTEGER NOT NULL DEFAULT 1,
  UNIQUE (item_id, commit_sha)
);

CREATE TABLE deployment_runs (
  id                     TEXT PRIMARY KEY,
  batch_id               TEXT NOT NULL REFERENCES deployment_batches(id) ON DELETE CASCADE,
  item_id                TEXT NOT NULL REFERENCES deployment_items(id) ON DELETE CASCADE,
  repository_id          TEXT NOT NULL REFERENCES repositories(id),
  environment            TEXT NOT NULL,
  attempt                INTEGER NOT NULL DEFAULT 1,
  state                  TEXT NOT NULL DEFAULT 'pending',
  substate               TEXT,
  version                INTEGER NOT NULL DEFAULT 0,
  worktree_path          TEXT,
  internal_squash_branch TEXT,
  deploy_branch_name     TEXT NOT NULL,
  target_branch_name     TEXT NOT NULL,
  base_sha               TEXT,
  target_base_sha        TEXT,
  squash_commit_sha      TEXT,
  pushed_commit_sha      TEXT,
  pushed_at              TEXT,
  error_code             TEXT,
  error_message          TEXT,
  checkpoint_json        TEXT,
  started_at             TEXT,
  finished_at            TEXT,
  updated_at             TEXT NOT NULL,
  UNIQUE (item_id, attempt)
);

CREATE INDEX idx_runs_active ON deployment_runs(state);
CREATE INDEX idx_runs_batch  ON deployment_runs(batch_id);

CREATE TABLE deployment_run_steps (
  id          TEXT PRIMARY KEY,
  run_id      TEXT NOT NULL REFERENCES deployment_runs(id) ON DELETE CASCADE,
  step_name   TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('pending','running','done','failed','skipped')),
  attempt     INTEGER NOT NULL DEFAULT 1,
  started_at  TEXT,
  finished_at TEXT,
  output      TEXT,
  error       TEXT,
  position_no INTEGER NOT NULL
);

CREATE TABLE deployment_conflicts (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL REFERENCES deployment_runs(id) ON DELETE CASCADE,
  file_path     TEXT NOT NULL,
  conflict_kind TEXT,
  detected_at   TEXT NOT NULL,
  resolved_at   TEXT,
  resolution    TEXT
);

CREATE TABLE deployment_env_status (
  id             TEXT PRIMARY KEY,
  requirement_id TEXT NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  repository_id  TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  environment    TEXT NOT NULL CHECK (environment IN ('dev','qas','uat','prd')),
  status         TEXT NOT NULL,
  confidence     TEXT NOT NULL DEFAULT 'low'
                 CHECK (confidence IN ('low','medium','high')),
  evidence       TEXT,
  commit_sha     TEXT,
  checked_at     TEXT NOT NULL,
  UNIQUE (requirement_id, repository_id, environment)
);

CREATE TABLE deployment_links (
  id          TEXT PRIMARY KEY,
  run_id      TEXT NOT NULL REFERENCES deployment_runs(id) ON DELETE CASCADE,
  provider    TEXT NOT NULL DEFAULT 'github',
  kind        TEXT NOT NULL CHECK (kind IN ('compare','pull_request')),
  external_id TEXT,
  url         TEXT NOT NULL,
  state       TEXT,
  checked_at  TEXT
);

CREATE TABLE operation_logs (
  id            TEXT PRIMARY KEY,
  batch_id      TEXT REFERENCES deployment_batches(id) ON DELETE CASCADE,
  run_id        TEXT REFERENCES deployment_runs(id) ON DELETE CASCADE,
  repository_id TEXT REFERENCES repositories(id) ON DELETE SET NULL,
  level         TEXT NOT NULL CHECK (level IN ('trace','debug','info','warn','error')),
  phase         TEXT,
  message       TEXT NOT NULL,
  detail        TEXT,
  created_at    TEXT NOT NULL
);

CREATE INDEX idx_logs_run_time   ON operation_logs(run_id, created_at);
CREATE INDEX idx_logs_batch_time ON operation_logs(batch_id, created_at);
