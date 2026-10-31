-- Normalizar ramas planificadas a la convención por tipo:
-- feature/<Task ID> para historias/tareas y fix/<Task ID> para bugs/hotfix.
UPDATE requirement_repositories
SET branch_name = CASE
      WHEN lower(coalesce(
        (SELECT r.type FROM requirements r
          WHERE r.id = requirement_repositories.requirement_id),
        ''
      )) LIKE '%bug%'
      OR lower(coalesce(
        (SELECT r.type FROM requirements r
          WHERE r.id = requirement_repositories.requirement_id),
        ''
      )) LIKE '%hotfix%'
      THEN 'fix/' || branch_name
      ELSE 'feature/' || branch_name
    END,
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE branch_status IN ('planned', 'missing')
  AND branch_name IN (
    SELECT r.external_key FROM requirements r
    WHERE r.id = requirement_repositories.requirement_id
  );
