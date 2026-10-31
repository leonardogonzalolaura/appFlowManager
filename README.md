# FlowManager

Aplicación de escritorio (Tauri 2 + React + Rust + SQLite) para orquestar
requerimientos, ramas, despliegues y scripts de base de datos entre varios
repositorios Git.

> Estado actual: **Fase 4 — Squash y conflictos**. La app importa requerimientos,
> crea ramas y las unifica en un commit squash aislado. Si hay conflictos, pausa
> y permite resolverlos en VS Code sin tocar tu copia principal. Las fases 5–8
> se implementan y validan por separado.

## Requisitos

- Node.js 20+
- Rust (stable) y MSVC Build Tools
- Git en el `PATH`
- WebView2 (incluido en Windows 10/11)

## Desarrollo

```powershell
npm install
npm run tauri dev
```

Solo frontend (modo demo, sin backend):

```powershell
npm run dev
```

## Calidad

```powershell
npm run typecheck
npm run test:run
npm run build
cd src-tauri; cargo test
```

## Qué incluye la Fase 1

- Alta de repositorios por carpeta local o clonado desde URL.
- Validación de que la ruta sea una copia de trabajo Git.
- Lectura de ramas remotas y locales con git2.
- `git fetch --prune` bajo demanda, sin bloquear el alta.
- Detección de ambientes:
  - catálogo global configurable: DEV, QAS, STAGE, UAT y PRD como iniciales,
  - ambientes personalizados (preprod, demo, sandbox…) con color, alias y patrón,
  - coincidencia exacta por alias (`dev`, `qas`, `uat`, `prd`, `main`…),
  - patrón `release/*` para QAS con versión semántica (`1.0.10 > 1.0.9`),
  - desempate por fecha de commit,
  - marca de ambigüedad cuando no hay un ganador claro.
- Override manual por ambiente y vuelta a detección automática.
- Matriz DEV/QAS/UAT/PRD + ambientes personalizados con rama, modo, SHA, evidencia y advertencias.
- Avisos de ruta en OneDrive, repos sin remoto y ramas compartidas.
- Quitar repositorio sin borrar la carpeta local ni el historial.

La app **no** crea ramas, no hace push y no modifica el remoto en esta fase.

## Qué incluye la Fase 2

- Importación del export real de Monday en **XLSX o CSV**.
- Vista previa antes de confirmar:
  - nuevos, actualizados, sin cambios y ausentes,
  - conflictos con requerimientos manuales,
  - filas inválidas y Task IDs duplicados.
- Upsert transaccional por `Task ID`; reimportar no duplica.
- Subitems de Monday guardados y visibles en el detalle.
- Registro manual de requerimientos con key automática `MAN-0001`.
- Edición, archivado (soft delete) y bloqueo contra futuras importaciones.
- Mapeo manual de requerimientos a repositorios y rama.
- Tabla tipo Excel con búsqueda, filtros por origen/developer/estado/prioridad/
  feature, “Solo mis requerimientos” y paginación.
- Detalle con campos de Monday, notas locales, subitems y repositorios.

Los campos de Monday son de solo lectura; notas y mapeos locales siempre se
conservan. Un manual no se sobrescribe por Monday sin confirmación.

## Qué incluye la Fase 3

- Creación de la rama de cada requerimiento desde `origin/<base>` (o la base local
  si el remoto no está disponible).
- Antes de crear se ejecuta `git fetch --prune origin <base>`; si el fetch falla,
  la rama no se crea y se muestra el error. Nunca se borra ni reescribe el
  `master` local.
- Convención de nombre:
  - `feature/<Task ID>` para User Story, Task y tipos normales.
  - `fix/<Task ID>` para Bug y Hotfix.
  - Las ramas planificadas existentes se normalizan al aplicar la migración.
- Si la rama ya existe en local:
  - muestra sus commits y ahead/behind,
  - permite **conservarla** o **recrearla desde cero**,
  - recrear elimina solo la rama local y avisa que los commits se descartan.
- Si la rama existe en `origin`, no se sobrescribe: se puede crear una copia local
  que la siga.
- Push opcional de la rama propia con `git push -u`; nunca `--force`.
- Análisis `base..rama`:
  - commits con autor y fecha,
  - marca de commits ajenos (el mensaje no menciona el Task ID),
  - ahead/behind, archivos modificados y líneas agregadas/eliminadas,
  - estado `sin commits` que bloquea el despliegue.
- El análisis queda guardado en el mapeo para futuras fases.

## Qué incluye la Fase 4

- Squash de uno o varios requerimientos del mismo repositorio.
- Worktree aislado por sesión; nunca se toca la copia principal.
- Dos estrategias:
  - **Todos los commits** con `merge --squash`,
  - **Selección de commits** con `cherry-pick -n`.
- Mensaje final editable y commit único.
- Pausa ante conflictos con:
  - detección de archivos sin resolver,
  - abrir worktree en VS Code o el explorador,
  - `git add` por archivo o agregar todos,
  - continuar cuando no queden conflictos,
  - abortar y limpiar el worktree sin tocar las ramas originales.
- Las sesiones quedan persistidas para reanudar después de cerrar la app.
- El resultado se marca como listo para que la Fase 5 lo aplique a la rama del ambiente.

## Dónde vive la información

| Dato | Ubicación |
|---|---|
| Base SQLite | `%APPDATA%\com.leona.flowmanager\flowmanager.db` |
| Logs | `%APPDATA%\com.leona.flowmanager\logs` |
| Respaldos | `%APPDATA%\com.leona.flowmanager\backups` |
| Worktrees | `%LOCALAPPDATA%\com.leona.flowmanager\worktrees` |

La base se respalda automáticamente antes de aplicar migraciones. Los
worktrees se mantienen fuera de OneDrive para evitar bloqueos de archivos.

## Diseño

El diseño técnico completo está en
[`docs/FlowManager-Diseno-Tecnico.md`](docs/FlowManager-Diseno-Tecnico.md).

Reglas que no se negocian:

- La app **nunca** hace push ni merge sobre ramas de ambiente.
- Solo empujará ramas de despliegue propias (`BPIM-183-qas`).
- Los secretos se cifran con DPAPI y no se envían al frontend.
- Las migraciones y acciones destructivas requieren confirmación.
