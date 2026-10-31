-- Fase 4: sesiones de squash aisladas en worktrees.
CREATE TABLE squash_sessions (
  id                    TEXT PRIMARY KEY,
  repository_id         TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  base_branch           TEXT NOT NULL,
  base_ref              TEXT NOT NULL,
  base_sha              TEXT NOT NULL,
  internal_branch       TEXT NOT NULL,
  worktree_path         TEXT NOT NULL,
  strategy              TEXT NOT NULL
                        CHECK (strategy IN ('all_commits','selected_commits')),
  status                TEXT NOT NULL DEFAULT 'preparing'
                        CHECK (status IN ('preparing','conflict','ready','no_changes','aborted','failed')),
  message               TEXT NOT NULL,
  selected_requirements_json TEXT NOT NULL DEFAULT '[]',
  selected_commits_json      TEXT NOT NULL DEFAULT '[]',
  plan_json             TEXT NOT NULL,
  conflicts_json        TEXT NOT NULL DEFAULT '[]',
  squash_sha            TEXT,
  files_changed         INTEGER NOT NULL DEFAULT 0,
  additions             INTEGER NOT NULL DEFAULT 0,
  deletions             INTEGER NOT NULL DEFAULT 0,
  error_message         TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE INDEX idx_squash_sessions_status ON squash_sessions(status);
CREATE INDEX idx_squash_sessions_repo ON squash_sessions(repository_id, created_at);
