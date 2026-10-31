-- Fase 6: conexiones compatibles con ambientes personalizados y ejecuciones.
CREATE TABLE db_connections_new (
  id             TEXT PRIMARY KEY,
  repository_id  TEXT REFERENCES repositories(id) ON DELETE CASCADE,
  environment    TEXT NOT NULL REFERENCES environments(key) ON UPDATE CASCADE,
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

INSERT INTO db_connections_new
  (id, repository_id, environment, engine, host, port, database_name,
   username, secret_id, ssl_mode, options_json, is_active, created_at, updated_at)
SELECT id, repository_id, environment, engine, host, port, database_name,
       username, secret_id, ssl_mode, options_json, is_active, created_at, updated_at
FROM db_connections;

DROP TABLE db_connections;
ALTER TABLE db_connections_new RENAME TO db_connections;

CREATE UNIQUE INDEX ux_db_connections_global
  ON db_connections(environment, engine)
  WHERE repository_id IS NULL;

CREATE TABLE db_script_executions (
  id            TEXT PRIMARY KEY,
  script_id     TEXT REFERENCES db_scripts(id) ON DELETE SET NULL,
  connection_id TEXT REFERENCES db_connections(id) ON DELETE SET NULL,
  requirement_id TEXT,
  repository_id TEXT,
  script_name   TEXT NOT NULL,
  engine        TEXT NOT NULL,
  environment   TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('success','failed','skipped')),
  output        TEXT,
  error         TEXT,
  duration_ms   INTEGER NOT NULL DEFAULT 0,
  executed_at   TEXT NOT NULL
);

CREATE INDEX idx_db_script_executions_script
  ON db_script_executions(script_id, executed_at);
CREATE INDEX idx_db_script_executions_requirement
  ON db_script_executions(requirement_id, executed_at);
