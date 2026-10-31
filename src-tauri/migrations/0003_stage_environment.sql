-- Separar STAGE de QAS.
-- Hasta 0002, QAS incluía los alias "staging" y "stage", lo que hacía que una
-- rama stage se mostrara como QAS. Ahora STAGE es un ambiente propio.

-- 1. Corregir el alias por defecto de QAS solo si nadie lo personalizó.
UPDATE environments
SET aliases_json = '["qas","qa","quality"]',
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE key = 'qas'
  AND aliases_json = '["qas","qa","quality","staging","stage"]';

-- 2. Crear STAGE como ambiente personalizado (se puede archivar) si no existe.
UPDATE environments
SET position_no = position_no + 1
WHERE position_no >= 2
  AND NOT EXISTS (SELECT 1 FROM environments WHERE key = 'stage');

INSERT INTO environments
  (key, label, color, position_no, aliases_json, pattern, is_system, is_active, created_at, updated_at)
SELECT 'stage', 'STAGE', '#4dd0e1', 2,
       '["stage","staging"]', NULL, 0, 1,
       strftime('%Y-%m-%dT%H:%M:%SZ','now'),
       strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE NOT EXISTS (SELECT 1 FROM environments WHERE key = 'stage');

-- 3. Crear la fila por repositorio para STAGE.
INSERT INTO repo_environments
  (id, repository_id, environment, branch_name, resolution_mode,
   resolved_sha, resolved_at, resolution_note, updated_at)
SELECT lower(hex(randomblob(16))), r.id, 'stage', NULL, 'auto',
       NULL, NULL, 'Pendiente de detección',
       strftime('%Y-%m-%dT%H:%M:%SZ','now')
FROM repositories r
WHERE r.is_active = 1
  AND EXISTS (SELECT 1 FROM environments WHERE key = 'stage' AND is_active = 1)
  AND NOT EXISTS (
    SELECT 1 FROM repo_environments re
    WHERE re.repository_id = r.id AND re.environment = 'stage'
  );

-- 4. Limpiar asociaciones automáticas de QAS que en realidad eran stage.
UPDATE repo_environments
SET branch_name = NULL,
    resolved_sha = NULL,
    resolved_at = NULL,
    resolution_note = 'Pendiente de detección',
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE environment = 'qas'
  AND resolution_mode = 'auto'
  AND lower(branch_name) IN ('stage', 'staging');
