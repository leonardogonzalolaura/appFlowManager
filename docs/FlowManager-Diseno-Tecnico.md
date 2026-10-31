# FlowManager — Diseño técnico y funcional

**Versión:** 1.0  
**Fecha:** 2026-10-31  
**Stack objetivo:** Tauri 2 + Rust + React 19 + TypeScript + Vite + SQLite  
**Documento base para:** implementación por fases, traspaso a otro modelo/agente y validación con el usuario.

---

## 0. Resumen ejecutivo

FlowManager es una aplicación de escritorio que orquesta el paso de requerimientos (Monday exportado a CSV/XLSX; Jira a futuro) hacia repositorios Git, creando ramas de trabajo, analizando commits contra la rama base, unificando requerimientos por repositorio, generando un squash y preparando una rama de despliegue por ambiente.

La aplicación **no modifica las ramas de ambiente** (`dev`, `qas`, `uat`, `prd` ni sus equivalentes `release/*`). Su responsabilidad termina en:

1. Crear/empujar la rama de trabajo del requerimiento.
2. Construir un commit squash limpio.
3. Crear una rama hija desde la rama remota del ambiente.
4. Aplicar el squash sobre esa rama hija.
5. Empujar **solo esa rama hija** a GitHub.
6. Opcionalmente, ejecutar los scripts de BD del requerimiento en el ambiente, con confirmación explícita.
7. Registrar y verificar el estado del requerimiento en cada ambiente.

El merge de la rama hija hacia `dev/qas/uat/prd` se hace **manualmente en GitHub**, tal como lo definió el usuario. Esto sustituye el punto 6 del requerimiento original ("push --force a la rama del ambiente").

### Decisiones cerradas

| # | Decisión | Justificación |
|---|---|---|
| D1 | Tauri 2 + React 19 + TypeScript + Vite 7 + CSS plano, igual que `tarugit` | Reutilización directa de patrones y componentes existentes. |
| D2 | Lecturas Git con `git2`; escrituras/merge/push con **git CLI** | `git2` es excelente para inspección; el CLI maneja mejor conflictos, hooks, LFS, credential helpers y mensajes de error. Es el patrón ya probado en `tarugit`. |
| D3 | Operar en un **git worktree temporal aislado** por ejecución | No mover la rama local del usuario, no ensuciar su copia de trabajo y permitir reintentos limpios. |
| D4 | La app **solo empuja sus propias ramas**; nunca `dev/qas/uat/prd` | El merge al ambiente se gestiona en GitHub. Elimina el riesgo de `--force` sobre ramas compartidas. |
| D5 | `--force-with-lease` únicamente sobre la rama propia ya empujada | Si el remoto cambió, se detecta y se evita pisar trabajo ajeno. Nunca `--force` a una rama de ambiente. |
| D6 | Detección automática de rama por ambiente + override manual por repo | Los repos son heterogéneos (`qas`, `release/1.0.5`, etc.). Se elige la versión semántica más alta y se muestra la evidencia. |
| D7 | Estado por ambiente = historial de despliegues + verificación Git + PR de GitHub (opcional) | Ninguna fuente por sí sola es suficiente, sobre todo con "Squash and merge" de GitHub. |
| D8 | Scripts BD: SQL Server + PostgreSQL, orden secuencial, ejecución **después del push y con confirmación** | Coincide con la operación real; si no hay conexión configurada se bloquea la ejecución con alerta. |
| D9 | Credenciales de BD y token GitHub cifrados con **DPAPI** y guardados en SQLite | Nunca en texto plano ni en logs. |
| D10 | Rama base configurable por repo, por defecto `master` | Hay repos con `main` u otra base. |
| D11 | Ingesta Monday por CSV/XLSX con **upsert por `Task ID`** | Reimportar no duplica ni borra datos locales (notas, mapeos, scripts). |
| D12 | Tabla de requerimientos con TanStack Table (headless) | Filtros, orden, selección, columnas redimensionables y virtualización sin imponer un design system. |
| D13 | Máquina de estados persistida y reanudable | La app puede cerrarse en conflicto y retomar sin perder el punto exacto. |
| D14 | Registro manual de requerimientos con `source = manual` | Permite cargar requerimientos que aún no están en Monday sin esperar el export; usa la misma entidad, lista y flujo de despliegue. |
| D15 | Un requerimiento manual que luego aparece en Monday se **vincula con confirmación** | Evita duplicados y evita que el import sobrescriba datos locales sin permiso. |
| D16 | Catálogo global de ambientes configurable; DEV/QAS/STAGE/UAT/PRD son los iniciales | Los equipos pueden agregar preprod, demo, sandbox u otros sin cambiar el código. STAGE se separó de QAS: `stage`/`staging` ya no se asocian a QAS. Cada repo resuelve su rama; todos los ambientes configurados quedan protegidos contra push. |

### Corrección explícita al requerimiento original

El texto original decía:

> "Push: `git push --force` a la rama del ambiente."

**No se implementará así.** La decisión vigente es:

- Se crea una rama hija desde `origin/<rama-del-ambiente>` (ej. `origin/release/1.0.5`).
- Se aplica el squash en esa rama hija (ej. `BPIM-183-qas`).
- Se hace push **solo de `BPIM-183-qas`**.
- El usuario abre el PR y hace el merge a `release/1.0.5` en GitHub.
- FlowManager verifica luego si el PR se mergeó o si los cambios ya están en el ambiente.

Esta corrección debe respetarse en cualquier implementación futura.

---

## 1. Alcance

### 1.1 En alcance (v1)

- Registro de repositorios locales, clonado si la ruta no existe, `fetch` y configuración de rama base.
- Detección y configuración manual de la rama de cada ambiente por repositorio (`dev`, `qas`, `uat`, `prd` y ambientes personalizados).
- Importación de requerimientos desde el export de Monday en CSV o XLSX.
- **Registro manual de requerimientos** (aún no presentes en Monday), con edición, archivado y mapeo a repos.
- Listado tipo Excel con filtros (incluido "mis requerimientos" por developer), estado por ambiente, detalle y acciones.
- Mapeo requerimiento ↔ repositorio ↔ rama, automático por `Task ID` y manual.
- Creación de ramas de requerimiento desde `origin/<base>`.
- Análisis `base..rama`: commits, ahead/behind, archivos, alerta si no hay commits.
- Unificación de varios requerimientos del mismo repositorio.
- Squash con selección de commits y mensaje editable.
- Creación de rama hija desde la rama remota del ambiente y aplicación del squash.
- Pausa por conflictos, apertura en VS Code, `git add`, continuar/abortar.
- Push de la rama hija propia (sin tocar ambientes).
- Consola de logs en tiempo real y persistencia de la ejecución.
- Reanudación tras cierre/reinicio.
- Scripts BD ordenados por requerimiento/repositorio, configuración de conexiones por ambiente y ejecución con confirmación.
- Estado del requerimiento por ambiente (local, dev, qas, uat, prd) con evidencia.
- Historial de lotes y ejecuciones.

### 1.2 Fuera de alcance (v1)

- Push, merge o force-push a ramas de ambiente.
- Creación/merge automático de Pull Requests (solo enlaces y lectura de estado).
- Resolución automática de conflictos o edición 3-way embebida (se puede reutilizar el `ConflictResolver` de `tarugit` en fase 2).
- Ejecución de scripts BD sin confirmación humana.
- Sincronización en vivo con la API de Monday (solo export).
- Multiusuario, servidor central, RBAC, aprobaciones formales.
- Rollback automático de código o BD.
- Firma de commits (se deja como configuración futura).

### 1.3 Supuestos

- Windows 10/11, WebView2 y Git instalado en `PATH` (>= 2.30 por `git worktree`).
- Los repositorios son locales y accesibles; GitHub por HTTPS o SSH con credential helper configurado.
- El export de Monday es la fuente principal de requerimientos; la app también permite crearlos manualmente.
- Un requerimiento manual puede convivir con el mismo `Task ID` en un export posterior; se vincula con confirmación.
- Un requerimiento puede tocar N repositorios y un repositorio puede tener N requerimientos.
- Uso mono-usuario de escritorio; la BD SQLite es local.
- Las ramas de ambiente ya existen en `origin` o el usuario las configura manualmente.
- La app no necesita que la copia local esté limpia porque trabaja en worktrees.

---

## 2. Glosario

| Término | Significado |
|---|---|
| **Requerimiento** | Entidad con `Task ID` (ej. `BPIM-183`), importada de Monday o creada manualmente. |
| **Requerimiento manual** | Requerimiento creado en la app con `source = manual`, sin esperar a que exista en Monday. |
| **Bundle / unificación** | Agrupación lógica de varios requerimientos que se despliegan juntos en un mismo repo y rama. |
| **Rama de requerimiento** | Rama de desarrollo creada desde `origin/master` (ej. `BPIM-183`). |
| **Rama de despliegue** | Rama hija creada desde la rama remota del ambiente (ej. `BPIM-183-qas`). Es la única que la app empuja. |
| **Ambiente** | `dev`, `qas`, `uat`, `prd` (y `local` como estado, no como destino de push). |
| **Rama de ambiente** | Rama remota que representa el ambiente en un repo (ej. `qas`, `release/1.0.5`). |
| **Lote / batch** | Conjunto de requerimientos y repos a preparar para un ambiente. |
| **Run** | Ejecución de la máquina de estados para un repositorio dentro de un lote. |
| **Worktree** | Copia de trabajo Git aislada, creada por la app, para no tocar la copia del usuario. |
| **Squash** | Un solo commit que resume los cambios seleccionados, sin reescribir la rama original. |
| **Base drift** | La rama de ambiente cambió entre la vista previa y la ejecución. |
| **PR** | Pull Request en GitHub; el merge al ambiente lo hace el usuario. |

---

## 3. Flujo funcional end-to-end

### 3.1 Vista general

```
[Configurar repos]
      │
      ▼
[Importar Monday CSV/XLSX] ─┐
                            ├──► [Listado de requerimientos + filtros]
[Registrar requerimiento] ──┘                 │
      │                                      ├─► [Detalle: repos, ramas, commits, scripts, ambientes]
      │                                      │
      ▼                                      ▼
[Detectar/definir ramas de ambiente]   [Seleccionar req(s) + ambiente]
      │                                      │
      ▼                                      ▼
[Crear ramas de requerimiento] ──► [Preflight / vista previa]
                                             │
                                             ▼
                                   [Ejecutar lote]
                                             │
                    ┌────────────────────────┼─────────────────────────┐
                    ▼                        ▼                         ▼
              [Fetch/Analyze]          [Squash en worktree]     [Conflicto → pausa]
                    │                        │                         │
                    │                        ▼                         ▼
                    │                 [Rama hija desde origin/env]  [VS Code + git add + Continuar]
                    │                        │
                    │                        ▼
                    │                 [Aplicar squash + commit]
                    │                        │
                    │                        ▼
                    │                 [Push rama propia]
                    │                        │
                    │                        ▼
                    │              [¿Ejecutar scripts BD?]
                    │                  │           │
                    │                 Sí          No
                    │                  ▼           ▼
                    │           [Ejecutar en orden] [Done / DB pendiente]
                    │                  │
                    └──────────────────┴────────────► [Done / Failed / Cancelled]
                                             │
                                             ▼
                                  [GitHub: PR + merge manual]
                                             │
                                             ▼
                                  [Refresh estado por ambiente]
```

### 3.2 Paso a paso (operativo)

#### Paso 1 — Configuración inicial del repositorio

1. El usuario agrega la ruta local del repo (o indica URL + ruta para clonar).
2. La app valida que sea un repo Git con `git2::Repository::open`.
3. Hace `git fetch origin --prune`.
4. Detecta la rama base (`master` por defecto; configurable).
5. Detecta ramas de ambiente con el algoritmo de la sección 4.3.
6. El usuario revisa y puede fijar manualmente cada rama.
7. Se guarda `last_verified_sha` y la evidencia.

#### Paso 2 — Ingesta o registro manual de requerimientos

**Opción A — Importar desde Monday:**

1. El usuario elige el archivo CSV/XLSX exportado de Monday.
2. La app parsea, detecta encabezados, secciones y subitems.
3. Muestra una vista previa: nuevos, actualizados, sin cambios y ausentes.
4. Si hay colisiones con requerimientos manuales, se muestran aparte y requieren confirmación.
5. El usuario confirma.
6. Se hace upsert por `Task ID` en una transacción.
7. Se conservan notas, mapeos, scripts y ramas ya configuradas.
8. Se puede disparar un escaneo de ramas para proponer mapeos `Task ID → repo/rama`.

**Opción B — Registrar manualmente:**

1. El usuario pulsa "Nuevo requerimiento".
2. Completa `Task ID` (o deja que la app genere `MAN-0001`), título, feature, tipo, developer, QA, estado, prioridad y notas.
3. Opcionalmente selecciona repositorios y nombre de rama; puede crearla en el mismo flujo.
4. Se guarda con `source = manual` y aparece en la misma lista.
5. Si después aparece en un export de Monday, la app lo detecta como colisión y pide vincular/actualizar.

#### Paso 3 — Mapeo y creación de ramas

1. Para cada requerimiento se muestran repos propuestos (rama que contiene el `Task ID`).
2. El usuario confirma o agrega manualmente.
3. El nombre por defecto de la rama es el `Task ID` (`BPIM-183`), editable.
4. Si no existe, se crea desde `origin/<base>` y opcionalmente se empuja (`-u origin BPIM-183`).
5. Si existe, se reutiliza y se informa si no tiene commits.
6. Si hay colisión con una rama ajena, se propone sufijo (`BPIM-183-2`) y nunca se sobrescribe.

#### Paso 4 — Análisis

1. `git fetch` del repo.
2. `git rev-list --left-right --count origin/<base>...<rama>`.
3. Si `ahead = 0`, se marca `BlockedNoCommits` y se alerta; no se puede desplegar.
4. Se listan commits (`base..rama`) con hash, mensaje, autor, fecha.
5. Se marcan commits que no contienen el `Task ID` como "posible commit ajeno".
6. Se muestran archivos y diff stat.
7. Si el requerimiento está en varios repos, se analiza cada uno por separado.

#### Paso 5 — Squash

1. Se crea un worktree aislado desde `origin/<base>`.
2. Se crea una rama interna `flowmgr/squash/<run-id>` (no se empuja).
3. Según la selección:
   - **Todos los commits de cada rama:** `git merge --squash <rama>` por cada rama, con commits WIP internos, y al final `git reset --soft <base_sha>` + commit final.
   - **Subconjunto de commits:** `git cherry-pick -n <sha>` en orden cronológico y commit final (con soft reset si se generaron commits intermedios).
4. El mensaje final es editable, con plantilla y trailers de trazabilidad.
5. Si no hay cambios netos, se marca `NoChanges` y no se empuja.

#### Paso 6 — Rama de despliegue y aplicación del squash

1. Se resuelve la rama remota del ambiente (ej. `origin/release/1.0.5`).
2. Se verifica que siga en el SHA de la vista previa; si cambió, `BaseDrift`.
3. Se crea la rama hija `BPIM-183-qas` desde `origin/release/1.0.5`.
4. Se aplica `git merge --squash flowmgr/squash/<run-id>`.
5. Se crea **un commit** con el mensaje final.
6. Se muestra el diff y se pide confirmación de push.

#### Paso 7 — Push de la rama propia

1. `git push -u origin BPIM-183-qas`.
2. Si la rama ya existía y fue empujada por la app, `--force-with-lease` contra el SHA esperado.
3. Se verifica con `git ls-remote` que el SHA remoto coincide.
4. **No se toca `origin/qas`, `origin/release/1.0.5` ni ninguna rama de ambiente.**
5. Se muestra el enlace de comparación/PR de GitHub.

#### Paso 8 — Scripts BD (opcional, con confirmación)

1. Se listan los scripts del bundle, ordenados.
2. Si no hay conexión configurada para el ambiente, se muestra alerta y se bloquea la ejecución; se puede omitir y dejar "DB pendiente".
3. El usuario confirma la ejecución en el ambiente.
4. Se ejecutan en orden, con salida en vivo; por defecto se detiene en el primer error.
5. Se registra ejecución, salida y error por script.

#### Paso 9 — Cierre y verificación

1. El lote queda `Done` (o `DoneWithPendingDb`, `Partial`, `Failed`).
2. El usuario crea el PR y mergea en GitHub.
3. FlowManager refresca el estado: verifica ancestría, PR mergeado o evidencia histórica.
4. La lista muestra `DEV`, `QAS`, `UAT`, `PRD` por requerimiento/repo.

---

## 4. Reglas de negocio

### 4.1 Ramas y nombres

#### Plantillas configurables

| Elemento | Plantilla por defecto | Ejemplos |
|---|---|---|
| Rama de requerimiento individual | `{keys}` | `BPIM-183` |
| Rama de bundle (unificación) | `{keys}` unidas por `-` | `BPIM-183-BPIM-184` |
| Rama de despliegue | `{bundle}-{env}` | `BPIM-183-BPIM-184-qas` |
| Rama interna de squash | `flowmgr/squash/{run_short}` | `flowmgr/squash/0192f3a4` |
| Rama opcional unificada de desarrollo | `{keys}` | `BPIM-183-BPIM-184` |

- `{keys}` se construye con los `Task ID` en el orden en que el usuario los seleccionó, sin duplicados.
- El usuario puede editar el nombre antes de crear/desplegar.
- Se valida con `git check-ref-format --branch <nombre>` y reglas adicionales: longitud <= 100, sin espacios, sin `..`, sin `~^:?*[\\`, sin terminar en `.lock`, sin empezar/terminar con `/`.
- Si el nombre excede 100 caracteres, se trunca y se agrega un sufijo hash de 6 caracteres, informando al usuario.
- Si la rama existe:
  - Si es una rama creada por FlowManager y su SHA coincide con el registrado → se reutiliza.
  - Si existe pero no es de FlowManager → se propone sufijo `-2`, `-3`, etc.; nunca se borra ni se sobrescribe sin confirmación.
- La app nunca hace checkout en la copia de trabajo del usuario para crear una rama; usa `git branch <nombre> origin/<base>`.
- Empujar la rama de requerimiento al crearla es configurable (por defecto **sí**), para que el equipo la vea.

#### Ejemplos

```
BPIM-183                         # rama de trabajo
BPIM-183-BPIM-184                # bundle lógico
BPIM-183-BPIM-184-qas            # rama de despliegue para qas
BPIM-183-BPIM-184-qas            # push a origin; PR a release/1.0.5
flowmgr/squash/0192f3a4b5c6      # interna, nunca se empuja
```

### 4.2 Rama base

- Configurable por repositorio: `base_branch` (default `master`).
- La app usa siempre `origin/<base_branch>` para crear ramas y comparar, no la rama local.
- Si `origin/<base>` no existe, el repo se marca inválido y se pide configurar/corregir.
- Actualizar la rama de requerimiento con la base **no es automático**. El análisis muestra `behind` y el usuario puede:
  - desplegar igual (el squash se construye desde la base actual, aplicando el diff de la rama), o
  - sincronizar la rama con `merge` de `origin/<base>` antes de continuar (opción explícita, nunca rebase automático).

### 4.3 Detección de la rama de cada ambiente

Cada repositorio tiene 4 configuraciones (`dev`, `qas`, `uat`, `prd`) con:

```rust
struct EnvironmentBranchConfig {
    environment: Environment,
    branch_name: Option<String>,   // resuelta
    resolution_mode: ResolutionMode, // Auto | Manual
    aliases: Vec<String>,          // ej. ["qas", "qa", "quality"]
    pattern: Option<String>,       // ej. "release/*"
    resolved_sha: Option<String>,
    resolved_at: Option<DateTime<Utc>>,
    resolution_note: Option<String>,
}
```

#### Algoritmo de resolución automática

1. `git fetch origin --prune`.
2. Listar refs remotas con `git for-each-ref refs/remotes/origin --format='%(refname:short)|%(objectname)|%(committerdate:iso-strict)'`.
3. Descartar `origin/HEAD` y la rama base si no aplica.
4. Si el modo es **Manual**: usar la rama indicada; si no existe en `origin`, error `EnvBranchNotFound` (no hacer fallback silencioso).
5. Si el modo es **Auto**:
   1. Buscar coincidencia exacta con algún alias (case-insensitive), por ejemplo `qas`.
   2. Si no hay, aplicar el patrón (`release/*`).
   3. Si hay varias candidatas, extraer versión con regex `(?:release[/_-])?v?(\d+)(?:\.(\d+))?(?:\.(\d+))?` y elegir la tupla mayor (`1.0.10 > 1.0.9`, no comparación lexicográfica).
   4. Si no hay versión o hay empate, elegir la de mayor fecha de commit.
   5. Si sigue habiendo ambigüedad, marcar `AmbiguousDetection` y mostrar candidatas; el usuario debe elegir manualmente.
6. Persistir `branch_name`, `resolved_sha`, `resolved_at` y una nota legible:
   - `"Coincidencia exacta con alias 'qas'"`
   - `"Mayor versión release/*: 1.0.5 (fecha 2026-09-30)"`
   - `"Selección manual del usuario"`
7. Si no se resuelve, el ambiente queda **no disponible** y cualquier despliegue a ese ambiente se bloquea solo para ese repo, mostrando un enlace a la configuración.

#### Reglas específicas

- `prd` suele ser `main`/`master`/`prod`; si coincide con la rama base, se permite, pero se muestra una advertencia.
- Para `qas`, si existen `qas` y `release/1.0.5`, **gana la coincidencia exacta** (`qas`), salvo que el usuario fuerce `release/*`. La UI muestra ambas candidatas para evitar sorpresas.
- `release/1.0.5` puede ser el ambiente de `qas` y `release/1.0.0` el de `uat`; eso se configura por repo, no se asume jerarquía global.
- La detección se ejecuta al agregar el repo, al hacer `fetch` manual y al abrir la configuración. No se re-resuelve silenciosamente si el modo es manual.
- Si la rama detectada cambia de SHA, se actualiza `resolved_sha`, pero un lote en curso conserva el SHA de la vista previa (`target_base_sha`) y falla con `BaseDrift` si cambió.

### 4.4 Fuente de verdad del estado por ambiente

El estado de un requerimiento en un ambiente se calcula por **tres evidencias**, en este orden:

1. **PR de GitHub (si hay token):**
   - `GET /repos/{owner}/{repo}/pulls?head={owner}:{deploy_branch}&state=all`.
   - Si `merged_at != null` y `base.ref == rama_ambiente` → `Merged` (confianza alta).
   - Si `state == open` → `PrOpen`.
   - Si `state == closed` y no mergeado → `Rejected`.
2. **Ancestría Git:**
   - `git merge-base --is-ancestor <pushed_sha> origin/<rama_ambiente>`.
   - Si es ancestro (merge commit o fast-forward) → `Merged` (confianza alta).
   - Si el requerimiento ya estaba en el ambiente por trabajo previo, se verifica el HEAD de la rama de requerimiento:
     `git merge-base --is-ancestor <req_branch_head> origin/<rama_ambiente>`.
3. **Evidencia histórica / patch equivalente:**
   - `git cherry -v origin/<rama_ambiente> <deploy_branch>` para comparar patch-ids.
   - `git log origin/<rama_ambiente> --grep="<Task ID>" --fixed-strings`.
   - Si hay coincidencia → `Probable` (confianza media), mostrada con tooltip.
4. **Historial de FlowManager:**
   - Si la app empujó la rama pero no hay evidencia de merge → `Pushed` / `PrPending`.
   - Permite que el usuario marque manualmente `Mergeado` o `Rechazado` con nota.

#### Estados por ambiente

```
Unknown | NotPresent | LocalOnly | Pushed | PrOpen | Merged | Rejected | Probable
```

- `LocalOnly`: la rama de requerimiento existe con commits, pero no está en ningún ambiente.
- `Pushed`: la rama de despliegue fue empujada; el PR aún no se detecta.
- `PrOpen`: PR abierto.
- `Merged`: merge confirmado.
- `Probable`: evidencia indirecta; la UI no lo muestra como confirmado.
- `Unknown`: sin datos o repo no accesible.

#### Agregación multi-repo

Un requerimiento puede estar en 3 repos y en ambientes distintos. La UI **no debe mentir con un solo chip**. Se muestra:

- En la lista: `QAS 2/3`, `DEV 3/3`, `PRD 0/3`, con tooltip por repo.
- En el detalle: matriz repo × ambiente, con estado y evidencia.
- El "ambiente global" se deriva solo si todos los repos tienen el mismo estado; si no, se muestra `Parcial`.

### 4.5 Unificación de requerimientos

- Si el usuario selecciona 2+ requerimientos que comparten un repositorio para el mismo lote, se crea un **bundle**.
- El nombre del bundle por defecto es la unión de keys: `BPIM-183-BPIM-184`.
- La rama de despliegue por defecto es `BPIM-183-BPIM-184-<env>`.
- El squash incluye los commits seleccionados de cada rama, deduplicados por SHA; el mensaje final se genera una sola vez.
- Los scripts BD de todos los requerimientos del bundle se ejecutan una sola vez, en orden determinista:
  1. orden de los requerimientos en el bundle,
  2. `sequence_no` del script.
- Si dos requerimientos del bundle tocan el mismo archivo, el conflicto se resuelve una vez en el worktree y se continúa.
- Un bundle es una agrupación de despliegue, no una rama de desarrollo permanente. Las ramas individuales siguen existiendo.
- Un requerimiento puede pertenecer a varios bundles históricos; la UI muestra el historial.

### 4.6 Conflictos

- Se detectan con `git diff --name-only --diff-filter=U -z` y `git ls-files -u -z` (nunca parseando texto humano de `git status`).
- Al detectar conflicto:
  - La run pasa a `Conflict` y se persiste el contexto: fase (`Squash` o `ApplyToEnv`), rama/commit en curso, `base_sha`, archivos.
  - La UI muestra los archivos, el worktree y botones:
    - **Abrir en VS Code** (`code <worktree>` o `code --goto <archivo>:1`).
    - **Abrir carpeta** en el explorador.
    - **git add** por archivo y **Agregar todos**.
    - **Continuar** (habilitado solo si `git ls-files -u` está vacío).
    - **Abortar** (reset seguro del worktree a `base_sha`, sin tocar la copia principal).
- La app no auto-resuelve ni auto-stagea conflictos.
- Si el conflicto es binario, se informa y se abre el archivo; la resolución es manual.
- Continuar:
  - **Squash con merge:** `git commit -m "wip: <rama>"` y seguir con la siguiente rama; al final se colapsa con soft reset.
  - **Squash con cherry-pick:** `git cherry-pick --continue` (crea commits intermedios) y seguir; al final soft reset.
  - **ApplyToEnv:** `git commit -m "<mensaje final>"` y pasar a `Pushing`.
- Abortar:
  - `git reset --hard <base_sha>` y `git clean -fd` **dentro del worktree**.
  - Se elimina la rama local de despliegue si fue creada por la app y no se empujó.
  - La run pasa a `Cancelled`; el worktree se conserva o elimina según configuración.
- Nunca se ejecuta `git reset --hard` en la copia de trabajo principal del usuario.

### 4.7 Push seguro

- La app **solo** empuja ramas de despliegue cuyo nombre corresponda al bundle/requerimiento (ej. `BPIM-183-qas`). Las ramas internas `flowmgr/*` **nunca** se empujan.
- Antes de empujar, valida que el destino no sea una rama de ambiente configurada. Si el nombre coincide con `dev/qas/uat/prd/release/*` de la configuración, se rechaza con `RefusingToPushEnvironmentBranch`.
- Si la rama remota no existe: `git push -u origin <rama>`.
- Si existe y `last_pushed_sha` es conocido:
  - `git push --force-with-lease=refs/heads/<rama>:<last_pushed_sha> origin HEAD:refs/heads/<rama>`.
- Si existe y no es de la app: se rechaza y se propone otro nombre; nunca `--force`.
- No se usa `--force` simple en ninguna circunstancia.
- Se verifica el SHA remoto con `git ls-remote origin refs/heads/<rama>`.
- Se registra `pushed_sha`, fecha y URL de comparación:
  `https://github.com/{owner}/{repo}/compare/{target_branch}...{deploy_branch}?expand=1`.

### 4.8 Base drift

- Al crear la vista previa se guarda `target_base_sha` de `origin/<rama_ambiente>`.
- Al iniciar la ejecución y antes de crear la rama hija:
  - `git fetch origin`.
  - `git rev-parse origin/<rama_ambiente>`.
  - Si el SHA difiere → `BaseDrift`:
    - La run se pausa/falla con mensaje claro.
    - Opciones: **Recalcular** (nueva vista previa desde el SHA actual) o **Cancelar**.
    - Nunca se continúa silenciosamente sobre una base distinta.
- Si cambia durante la ejecución (después de crear la rama hija), el push de la rama propia sigue siendo válido, pero el PR puede requerir actualización; se advierte.

### 4.9 No reescritura de historia

- Las ramas de requerimiento **no se rebasean ni se resetean**.
- El squash se hace en ramas temporales internas y en la rama hija de despliegue, que son nuevas.
- `git reset --soft` solo se usa en la rama interna `flowmgr/squash/*` para colapsar commits WIP.
- No se hace `push --force` a ramas de desarrollo ni de ambiente.
- No se borran ramas remotas automáticamente.

---

## 5. Modelo de datos (SQLite)

### 5.1 Principios

- IDs `TEXT` con UUID v7 (ordenables por tiempo).
- Fechas `TEXT` ISO-8601 UTC (`2026-10-31T14:05:00Z`).
- Booleanos `INTEGER 0/1`.
- JSON solo para datos variables (settings, raw de Monday, evidencia), no para relaciones.
- `PRAGMA foreign_keys = ON`, `journal_mode = WAL`, `busy_timeout = 5000`, `synchronous = NORMAL`.
- Migraciones versionadas con `sqlx::migrate!`; backup del archivo antes de migrar.
- Los datos del usuario (notas, mapeos, scripts) nunca se borran en una reimportación.
- Timestamps de auditoría en todas las tablas mutables.

### 5.2 ERD lógico

```
repositories 1──N repo_environments
repositories 1──N requirement_repositories N──1 requirements
repositories 1──N bundle_repositories   N──1 bundles N──N requirements (bundle_members)
requirements 1──N requirement_subtasks
requirements 1──N db_scripts
repositories 1──N db_connections
bundles 1──N deployment_items
deployment_batches 1──N deployment_items
deployment_items 1──N deployment_runs 1──N deployment_run_steps
deployment_runs 1──N deployment_conflicts
deployment_runs 1──N deployment_links
requirements 1──N deployment_env_status
requirement_imports 1──N requirements
operation_logs (batch/run/repo)
```

### 5.3 DDL principal

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
-- Claves conocidas: base_branch, manual_key_prefix (MAN), developer_aliases,
-- worktree_root, log_level, git_author_name/email, github_token_encrypted.

CREATE TABLE repositories (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  local_path     TEXT NOT NULL UNIQUE,
  remote_name    TEXT NOT NULL DEFAULT 'origin',
  remote_url     TEXT,
  provider       TEXT NOT NULL DEFAULT 'github'
                 CHECK (provider IN ('github','generic')),
  github_owner   TEXT,
  github_repo    TEXT,
  base_branch    TEXT NOT NULL DEFAULT 'master',
  is_active      INTEGER NOT NULL DEFAULT 1,
  last_fetched_at TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

-- Implementación Fase 1 (migraciones 0002 y 0003): el catálogo vive en `environments`
-- (key, label, color, position_no, aliases_json, pattern, is_system, is_active)
-- y repo_environments referencia ese catálogo. DEV/QAS/STAGE/UAT/PRD son los
-- iniciales; STAGE es personalizado y archivable. Los aliases de QAS ya no
-- incluyen stage/staging.
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
  external_key          TEXT NOT NULL UNIQUE,          -- BPIM-183 | MAN-0001
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
  manual_created        INTEGER NOT NULL DEFAULT 0,    -- auditoría: nació manual
  manual_locked         INTEGER NOT NULL DEFAULT 0,    -- 1 = Monday no lo sobrescribe
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

-- Secretos cifrados con DPAPI. Nunca se devuelven al frontend.
CREATE TABLE secrets (
  id           TEXT PRIMARY KEY,
  scope        TEXT NOT NULL,               -- db_connection | github
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
-- SQLite permite varios NULL en UNIQUE; para la conexión global por ambiente:
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
  environment_scope  TEXT NOT NULL DEFAULT 'all',  -- all | dev | qas | uat | prd
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
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  environment  TEXT NOT NULL CHECK (environment IN ('dev','qas','uat','prd')),
  status       TEXT NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft','queued','running','paused_conflict',
                                 'paused_db','completed','partial','failed','cancelled')),
  notes        TEXT,
  settings_json TEXT,
  created_by   TEXT,
  created_at   TEXT NOT NULL,
  started_at   TEXT,
  finished_at  TEXT
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
  id                  TEXT PRIMARY KEY,
  batch_id            TEXT NOT NULL REFERENCES deployment_batches(id) ON DELETE CASCADE,
  item_id             TEXT NOT NULL REFERENCES deployment_items(id) ON DELETE CASCADE,
  repository_id       TEXT NOT NULL REFERENCES repositories(id),
  environment         TEXT NOT NULL,
  attempt             INTEGER NOT NULL DEFAULT 1,
  state               TEXT NOT NULL DEFAULT 'pending',
  substate            TEXT,
  version             INTEGER NOT NULL DEFAULT 0,
  worktree_path        TEXT,
  internal_squash_branch TEXT,
  deploy_branch_name  TEXT NOT NULL,
  target_branch_name  TEXT NOT NULL,
  base_sha            TEXT,
  target_base_sha     TEXT,
  squash_commit_sha   TEXT,
  pushed_commit_sha   TEXT,
  pushed_at           TEXT,
  error_code          TEXT,
  error_message       TEXT,
  checkpoint_json     TEXT,
  started_at          TEXT,
  finished_at         TEXT,
  updated_at          TEXT NOT NULL,
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
  id           TEXT PRIMARY KEY,
  run_id       TEXT NOT NULL REFERENCES deployment_runs(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL DEFAULT 'github',
  kind         TEXT NOT NULL CHECK (kind IN ('compare','pull_request')),
  external_id  TEXT,
  url          TEXT NOT NULL,
  state        TEXT,
  checked_at   TEXT
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
CREATE INDEX idx_logs_run_time ON operation_logs(run_id, created_at);
CREATE INDEX idx_logs_batch_time ON operation_logs(batch_id, created_at);
```

### 5.4 Enumeraciones canónicas

```rust
pub enum Environment { Dev, Qas, Uat, Prd }
pub enum ResolutionMode { Auto, Manual }
pub enum BranchStatus { Planned, Created, Existing, Missing, Deleted }
pub enum RunState {
    Pending, Fetching, Analyzing, Squashing, Merging,
    Conflict, Pushing, AwaitingDbDecision, RunningDbScripts,
    Done, Blocked, Failed, Cancelled,
}
pub enum RunSubstate {
    PreparingWorktree, MergingBranches, CherryPicking,
    CreatingDeployBranch, ApplyingSquash, VerifyingPush,
}
pub enum EnvPresence {
    Unknown, NotPresent, LocalOnly, Pushed, PrOpen, Merged, Rejected, Probable,
}
pub enum BatchStatus {
    Draft, Queued, Running, PausedConflict, PausedDb,
    Completed, Partial, Failed, Cancelled,
}
```

- En SQLite se guardan en minúsculas (`awaiting_db_decision`, etc.).
- `serde(rename_all = "snake_case")` para DTOs.
- La UI traduce a etiquetas: `Local`, `DEV`, `QAS`, `UAT`, `PRD`, `PR abierto`, `Mergeado`, `Probable`.

### 5.5 Retención y limpieza

- `operation_logs`: retención configurable (default 90 días).
- `deployment_run_steps.output`: truncar a 1 MB por paso; el resto va al archivo de log.
- `raw_snapshot_path`: conservar el último import por hash; limpiar > 10.
- Worktrees: eliminar al terminar con éxito; conservar en conflicto/fallo por 7 días o hasta que el usuario limpie.
- Ramas internas `flowmgr/squash/*`: borrar al terminar; conservar en fallo para diagnóstico.
- No borrar ramas remotas automáticamente.

---

## 6. Arquitectura

### 6.1 Estilo: puertos y adaptadores (hexagonal) + capas

```
┌──────────────────────────────────────────────────────────────┐
│ Interface (Tauri commands, DTOs, eventos)                    │
│  - comandos finos, validación de entrada, mapeo de errores   │
└───────────────────────────┬──────────────────────────────────┘
                            │ depende de
┌───────────────────────────▼──────────────────────────────────┐
│ Application (casos de uso / orquestación)                    │
│  - ImportRequirements, CreateBranches, AnalyzeRequirement    │
│  - PrepareSquash, DeployToEnvironment, ResumeConflict        │
│  - ExecuteDbScripts, RefreshEnvironmentStatus                │
└───────────────────────────┬──────────────────────────────────┘
                            │ depende solo de puertos
┌───────────────────────────▼──────────────────────────────────┐
│ Domain (entidades, value objects, reglas, máquina de estados)│
│  - Requirement, Repository, EnvironmentBranch, Bundle        │
│  - RunStateMachine, BranchName, TaskKey, DeploymentPlan      │
│  - Puertos: GitReader, GitWriter, WorktreeManager, ...       │
└───────────────────────────▲──────────────────────────────────┘
                            │ implementan
┌───────────────────────────┴──────────────────────────────────┐
│ Infrastructure (adaptadores)                                 │
│  - git2 / git CLI / worktrees                                │
│  - sqlx SQLite (repositorios)                                │
│  - Monday CSV/XLSX, GitHub, DPAPI, SQL Server/PostgreSQL     │
│  - Tauri event publisher, tracing                            │
└──────────────────────────────────────────────────────────────┘
```

**Regla de dependencias:** `domain` no conoce Tauri, `git2`, `sqlx`, `reqwest` ni `std::process::Command`. `application` tampoco. `infrastructure` e `interface` sí.

### 6.2 Estructura de carpetas propuesta

```
appFlowManager/
├─ package.json
├─ vite.config.ts
├─ tsconfig.json
├─ src/                                  # React
│  ├─ main.tsx
│  ├─ App.tsx
│  ├─ styles/
│  │  ├─ tokens.css                      # variables de tarugit
│  │  └─ global.css
│  ├─ lib/
│  │  ├─ api.ts                          # wrapper invoke tipado
│  │  ├─ events.ts                       # listen + reconexión
│  │  ├─ queryClient.ts
│  │  └─ format.ts
│  ├─ types/                             # DTOs espejo del backend
│  ├─ components/ui/                     # Modal, Toast, Spinner, BranchCombo, DiffViewer
│  ├─ features/
│  │  ├─ requirements/                   # tabla, filtros, detalle, import wizard
│  │  ├─ repositories/                   # config, env matrix, detección
│  │  ├─ deployment/                     # wizard, run console, conflict modal
│  │  ├─ databases/                      # scripts, conexiones, ejecución
│  │  ├─ history/                        # lotes, runs, estados
│  │  └─ settings/
│  └─ stores/                            # zustand: run activo, consola
└─ src-tauri/
   ├─ Cargo.toml
   ├─ tauri.conf.json
   ├─ capabilities/default.json
   ├─ migrations/
   │  ├─ 0001_init.sql
   │  ├─ 0002_indexes.sql
   │  └─ ...
   └─ src/
      ├─ main.rs
      ├─ lib.rs                          # builder, state, handler registration
      ├─ config.rs                       # rutas, settings tipados
      ├─ error.rs                        # DomainError + ApiError
      ├─ state.rs                        # AppState, RunCoordinator
      ├─ domain/
      │  ├─ mod.rs
      │  ├─ requirement.rs
      │  ├─ repository.rs
      │  ├─ environment.rs
      │  ├─ bundle.rs
      │  ├─ deployment.rs
      │  ├─ run_state.rs
      │  ├─ value_objects.rs             # TaskKey, BranchName, RepoPath
      │  └─ ports.rs                     # traits
      ├─ application/
      │  ├─ mod.rs
      │  ├─ import_requirements.rs
      │  ├─ manage_repositories.rs
      │  ├─ resolve_environments.rs
      │  ├─ create_branches.rs
      │  ├─ analyze.rs
      │  ├─ squash.rs
      │  ├─ deploy.rs
      │  ├─ conflicts.rs
      │  ├─ db_scripts.rs
      │  ├─ environment_status.rs
      │  └─ dto.rs
      ├─ infrastructure/
      │  ├─ git/
      │  │  ├─ mod.rs
      │  │  ├─ cli.rs                    # runner seguro, timeouts, redacción
      │  │  ├─ reader.rs                 # git2: commits, ancestry, refs
      │  │  ├─ writer.rs                 # merge --squash, cherry-pick, push
      │  │  └─ worktree.rs
      │  ├─ persistence/
      │  │  ├─ mod.rs
      │  │  ├─ requirements.rs
      │  │  ├─ repositories.rs
      │  │  ├─ deployments.rs
      │  │  ├─ scripts.rs
      │  │  └─ logs.rs
      │  ├─ sources/
      │  │  ├─ mod.rs
      │  │  ├─ monday_csv.rs
      │  │  ├─ monday_xlsx.rs
      │  │  └─ common.rs
      │  ├─ secrets/dpapi.rs
      │  ├─ dbexec/
      │  │  ├─ mod.rs
      │  │  ├─ sqlserver.rs
      │  │  └─ postgres.rs
      │  ├─ github/client.rs
      │  └─ events/tauri_emitter.rs
      └─ interface/
         └─ tauri/
            ├─ mod.rs
            ├─ commands/
            │  ├─ requirements.rs
            │  ├─ repositories.rs
            │  ├─ branches.rs
            │  ├─ deployments.rs
            │  ├─ databases.rs
            │  ├─ settings.rs
            │  └─ system.rs
            └─ dto.rs
```

### 6.3 Puertos principales

```rust
#[async_trait]
pub trait GitReader: Send + Sync {
    async fn fetch(&self, repo: &RepoHandle) -> Result<FetchReport, GitError>;
    async fn branches(&self, repo: &RepoHandle) -> Result<Vec<RemoteBranch>, GitError>;
    async fn commits_between(&self, repo: &RepoHandle, from: &str, to: &str)
        -> Result<Vec<CommitInfo>, GitError>;
    async fn ahead_behind(&self, repo: &RepoHandle, base: &str, head: &str)
        -> Result<AheadBehind, GitError>;
    async fn is_ancestor(&self, repo: &RepoHandle, ancestor: &str, descendant: &str)
        -> Result<bool, GitError>;
    async fn diff_stat(&self, repo: &RepoHandle, from: &str, to: &str)
        -> Result<DiffStat, GitError>;
    async fn rev_parse(&self, repo: &RepoHandle, rev: &str) -> Result<String, GitError>;
}

#[async_trait]
pub trait GitWriter: Send + Sync {
    async fn create_branch(&self, repo: &RepoHandle, name: &str, start: &str)
        -> Result<(), GitError>;
    async fn create_worktree(&self, repo: &RepoHandle, path: &Path, branch: &str, start: &str)
        -> Result<(), GitError>;
    async fn remove_worktree(&self, repo: &RepoHandle, path: &Path, force: bool)
        -> Result<(), GitError>;
    async fn merge_squash(&self, wt: &Worktree, rev: &str) -> Result<MergeOutcome, GitError>;
    async fn cherry_pick_no_commit(&self, wt: &Worktree, sha: &str) -> Result<MergeOutcome, GitError>;
    async fn commit(&self, wt: &Worktree, message: &str) -> Result<String, GitError>;
    async fn soft_reset(&self, wt: &Worktree, to: &str) -> Result<(), GitError>;
    async fn hard_reset(&self, wt: &Worktree, to: &str) -> Result<(), GitError>;
    async fn conflicted_files(&self, wt: &Worktree) -> Result<Vec<String>, GitError>;
    async fn stage_all(&self, wt: &Worktree) -> Result<(), GitError>;
    async fn push_branch(&self, repo: &RepoHandle, branch: &str, lease: Option<&str>)
        -> Result<PushReport, GitError>;
}

#[async_trait]
pub trait RequirementSource: Send + Sync {
    async fn preview(&self, file: &Path) -> Result<ImportPreview, ImportError>;
    async fn parse(&self, file: &Path) -> Result<Vec<ParsedRequirement>, ImportError>;
}

#[async_trait]
pub trait SecretStore: Send + Sync {
    fn protect(&self, plaintext: &[u8]) -> Result<Vec<u8>, SecretError>;
    fn unprotect(&self, ciphertext: &[u8]) -> Result<Vec<u8>, SecretError>;
}

#[async_trait]
pub trait DatabaseExecutor: Send + Sync {
    fn engine(&self) -> DbEngine;
    async fn test_connection(&self, conn: &DbConnectionConfig) -> Result<(), DbError>;
    async fn execute(&self, conn: &DbConnectionConfig, script: &SqlScript, tx: bool)
        -> Result<ScriptResult, DbError>;
}
```

**ISP:** traits pequeños y específicos (`GitReader`, `GitWriter`, `WorktreeManager`, `GitHubClient`, `EnvironmentStatusReader`), no un "GitService" gigante.

### 6.4 Mapeo SOLID

| Principio | Aplicación concreta |
|---|---|
| **S**RP | Un caso de uso por operación (`CreateBranches`, `AnalyzeRequirement`, `DeployToEnvironment`). `GitCliRunner` solo ejecuta y normaliza; `GitReader` solo lee; la máquina de estados solo valida transiciones. |
| **O**CP | Nuevas fuentes (`JiraSource`), motores BD (`OracleExecutor`) o proveedores (`GitLabClient`) se agregan como adaptadores sin tocar los casos de uso. |
| **L**SP | Todos los `RequirementSource` devuelven el mismo `ParsedRequirement`; todos los `DatabaseExecutor` respetan el mismo contrato de resultado/error. |
| **I**SP | Puertos separados de lectura/escritura Git, secretos, fuentes, ejecutores, eventos. |
| **D**IP | `application` recibe `Arc<dyn GitReader>`, `Arc<dyn DeploymentRepository>`, etc.; el wiring se hace en `lib.rs`. Los tests usan dobles en memoria. |

### 6.5 Patrones aplicados

| Patrón | Dónde | Para qué |
|---|---|---|
| **Ports & Adapters** | Toda la arquitectura | Aislar Git, SQLite, GitHub, DPAPI, SQL Server. |
| **State** | `RunStateMachine` | Transiciones válidas, persistencia y reanudación. |
| **Strategy** | `BranchResolver`, `RequirementSource`, `CommitSelectionStrategy` (`MergeSquash` / `CherryPick`), `DatabaseExecutor` | Variantes de detección, importación, squash y motores. |
| **Factory** | `SourceFactory`, `ExecutorFactory` | Crear el adaptador por extensión/engine. |
| **Repository** | `persistence/*` | Acceso a SQLite sin filtrar SQL al dominio. |
| **Unit of Work** | `SqliteUnitOfWork` | Importación y transiciones atómicas. |
| **Command / Use Case** | `application/*` | Una intención de negocio por comando. |
| **Observer** | `EventPublisher` + Tauri `emit` | Logs y estado en tiempo real hacia React. |
| **Template Method** | `PipelineStep` (`preflight → execute → verify → persist`) | Pasos homogéneos, logs y checkpoints. |
| **Value Object** | `TaskKey`, `BranchName`, `Environment`, `RepoPath` | Validación e invariantes en un solo lugar. |
| **Idempotent Checkpoint** | `deployment_runs.checkpoint_json` | Reintentar sin duplicar commits ni ramas. |
| **Optimistic Concurrency** | `version` en runs | Evitar doble click/continuar dos veces. |
| **Outbox ligero** | Persistir estado y luego emitir | La UI siempre puede reconsultar; el evento es una optimización. |

No se introduce un framework de mediadores ni CQRS completo: sería sobreingeniería para una app de escritorio mono-usuario. Los casos de uso se invocan directamente desde los comandos Tauri.

### 6.6 Coordinador de ejecuciones

La UI no orquesta pasos. El backend es el dueño de la máquina de estados.

```rust
pub struct AppState {
    pub db: SqlitePool,
    pub config: AppConfig,
    pub coordinator: Arc<RunCoordinator>,
}

pub struct RunCoordinator {
    // Un run activo por repositorio.
    active_by_repo: Mutex<HashMap<RepoId, RunId>>,
    controls: Mutex<HashMap<RunId, RunControl>>,
}

pub struct RunControl {
    pub cancel: CancellationToken,
    pub decision: Arc<Notify>,       // continuar conflicto / decidir scripts
    pub decision_value: Mutex<Option<RunDecision>>,
}
```

Flujo:

1. `deployment_start` valida, crea batch/items/runs en estado `Pending` y lanza un `tokio::spawn`.
2. El worker recorre pasos, persiste cada transición y emite `flow://run-updated` + `flow://log`.
3. En `Conflict`, guarda archivos y espera `Notify` (con `select!` sobre cancelación).
4. `deployment_continue_conflict` valida que no queden unmerged, actualiza `checkpoint`, guarda decisión y notifica.
5. En `AwaitingDbDecision`, espera decisión `run_scripts` o `skip`.
6. Al terminar, libera el lock del repo y actualiza el batch.
7. Al iniciar la app, `runs_recoverable_list` detecta runs no terminales; el usuario reanuda o cancela.

**Concurrencia:** por defecto secuencial entre repos (evita prompts de credenciales y saturación). Configurable `max_parallel_repos` (default 1). Un run por repo; si ya hay uno activo, `RepoBusy`.

**Cancelación:** se revisa entre pasos y durante la espera de conflicto. No se mata un proceso Git a mitad; se usan timeouts (fetch 5 min, push 5 min, merge 2 min) y se reporta.

### 6.7 Persistencia SQLite

- `sqlx` con `runtime-tokio-rustls`, features `sqlite`, `postgres`, `chrono`, `uuid`, `migrate`.
- Consultas **runtime** (`sqlx::query_as`) para no exigir `DATABASE_URL` en compilación; no usar macros `query!` salvo que se configure `.sqlx` offline.
- Un pool con `max_connections(5)`; SQLite en WAL. Las escrituras críticas usan transacción.
- `SqliteUnitOfWork` recibe un `&mut Transaction` y agrupa repositorios.
- `sqlx::migrate!("./migrations")` al iniciar; si falla, la app no arranca y muestra el error con la ruta del backup.
- Ruta: `%APPDATA%\com.leona.flowmanager\flowmanager.db`.
- Backup previo a migración: `flowmanager.db.bak-<timestamp>`.

### 6.8 Rutas y archivos

| Uso | Ruta |
|---|---|
| BD | `%APPDATA%\com.leona.flowmanager\flowmanager.db` |
| Logs | `%APPDATA%\com.leona.flowmanager\logs\` |
| Imports raw | `%LOCALAPPDATA%\FlowManager\imports\` |
| Worktrees | `%LOCALAPPDATA%\FlowManager\worktrees\<run_id>\<repo_slug>\` |
| Temporales | `%LOCALAPPDATA%\FlowManager\tmp\` |
| Backups de BD | `%APPDATA%\com.leona.flowmanager\backups\` |

**Importante:** los worktrees van a `LOCALAPPDATA`, no a `APPDATA`/OneDrive, para evitar locks y sincronización. Si un repo está dentro de OneDrive, se advierte que el rendimiento y los locks pueden verse afectados; la app no mueve el repo.

### 6.9 Dependencias Rust

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-dialog = "2"
tauri-plugin-opener = "2"
tauri-plugin-single-instance = "2"     # opcional, evita doble instancia
serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "2"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter", "json"] }
tracing-appender = "0.2"
tokio = { version = "1", features = ["full"] }
tokio-util = { version = "0.7", features = ["rt"] }
async-trait = "0.1"
futures = "0.3"
uuid = { version = "1", features = ["v7", "serde"] }
chrono = { version = "0.4", features = ["serde"] }
sqlx = { version = "0.8", features = ["runtime-tokio-rustls", "sqlite", "postgres", "chrono", "uuid", "migrate"] }
git2 = "0.18.3"                        # misma versión que tarugit
reqwest = { version = "0.12", features = ["json", "rustls-tls"] }
calamine = "0.26"                      # XLSX
csv = "1"
encoding_rs = "0.8"
regex = "1"
semver = "1"                           # o comparador propio de versiones
sha2 = "0.10"
base64 = "0.22"
windows = { version = "0.58", features = ["Win32_Security_Cryptography"] }  # DPAPI
tiberius = { version = "0.12", features = ["rustls"] }   # SQL Server
tokio-util = { version = "0.7", features = ["compat"] }  # compat tiberius
which = "7"                            # detectar VS Code / git
```

Notas:

- Mantener `git2 = 0.18.3` para alinearse con `tarugit`; revisar compatibilidad antes de subir.
- `sqlx` soporta SQLite y PostgreSQL; **no** SQL Server. Para SQL Server se usa `tiberius` (o `bb8-tiberius` si se quiere pool). Validar la versión actual al implementar.
- `windows`/DPAPI solo compila en Windows; el proyecto es Windows-first. Si se quiere multiplataforma, definir `SecretStore` alternativo (keyring) sin tocar el dominio.
- Evitar `anyhow` en dominio; usarlo solo en binarios/adaptadores si simplifica, pero el error de API debe ser tipado.

### 6.10 Dependencias frontend

```json
{
  "@tauri-apps/api": "^2",
  "@tauri-apps/plugin-dialog": "^2",
  "@tauri-apps/plugin-opener": "^2",
  "@tanstack/react-table": "^8",
  "@tanstack/react-query": "^5",
  "@tanstack/react-virtual": "^3",
  "zustand": "^5",
  "react-hook-form": "^7",
  "zod": "^3",
  "codemirror": "^6",
  "@codemirror/lang-sql": "^6",
  "diff": "^9"
}
```

- Sin Tailwind ni librería de componentes: se reutilizan los tokens CSS y componentes de `tarugit`.
- `react-hook-form` + `zod` solo para formularios complejos (repo, conexión, wizard); no para todo.
- `@tanstack/react-query` para datos del backend; `zustand` para estado efímero de la consola/run.

---

## 7. Motor Git

### 7.1 Híbrido `git2` + CLI

| Operación | Tecnología | Motivo |
|---|---|---|
| Abrir repo, listar refs/ramas, leer commits, autores/fechas | `git2` | Rápido, tipado, sin parsear texto. |
| `ahead/behind`, merge-base, ancestría | `git2` (`graph_ahead_behind`, `merge_base`, `graph_descendant_of`) | Preciso y sin subprocess. |
| Leer blobs/etapas de conflicto (`ours/theirs/base`) | `git2` (índice) | Igual que `tarugit`. |
| `fetch`, crear rama, worktree, merge --squash, cherry-pick, commit, reset, add, push | **git CLI** | Conflictos, hooks, LFS, credential helpers y mensajes reales. |
| Detección de archivos en conflicto | CLI `git diff --diff-filter=U` + `git ls-files -u` | Más confiable que parsear `git status`. |
| Estado de PR / enlaces | `reqwest` a GitHub API | Solo lectura. |

**No se mezclan escrituras con `git2` y CLI en la misma fase** para evitar estados de índice inconsistentes. La regla es: `git2` lee, CLI escribe.

### 7.2 Runner de Git CLI

```rust
pub struct GitCliRunner {
    git_bin: PathBuf,       // "git" o ruta configurada
    timeout: Duration,
}

impl GitCliRunner {
    pub async fn run(&self, cwd: &Path, args: &[&str]) -> Result<GitOutput, GitError> {
        // Command::new(git).args(args).current_dir(cwd)
        // .env("GIT_TERMINAL_PROMPT", "0")
        // .env("LC_ALL", "C") / .env("LANG", "C")
        // .env("GIT_OPTIONAL_LOCKS", "0")  # solo lecturas
        // CREATE_NO_WINDOW en Windows
        // timeout + kill
        // stdout/stderr a String::from_utf8_lossy
        // redactar tokens/passwords antes de loggear
    }
}
```

Reglas:

- Nunca usar `cmd /C` ni concatenar argumentos en un string; siempre `arg()`.
- Validar nombres de rama con `git check-ref-format --branch` antes de usarlos.
- Para listas usar formatos con separador improbable (`%x1f`, `%x1e`) o `-z`.
- En Windows, `CREATE_NO_WINDOW` para no abrir consolas.
- `GIT_TERMINAL_PROMPT=0` evita que un fetch quede colgado esperando usuario; Git Credential Manager puede mostrar su propia ventana.
- Timeouts: fetch 300 s, push 300 s, merge/commit 120 s, comandos de lectura 30 s.
- Errores: capturar `status.code()`, `stdout`, `stderr`; mapear a códigos conocidos (`auth`, `not_found`, `non_fast_forward`, `conflict`, `hook_failed`, `lfs`) y conservar el stderr completo en `details` (redactado).

### 7.3 Worktrees

#### Creación

```bash
git fetch origin --prune
git worktree add -b flowmgr/squash/<run_short> <worktree_path> origin/<base_branch>
```

- `worktree_path = %LOCALAPPDATA%\FlowManager\worktrees\<run_id>\<repo_slug>`.
- `repo_slug` se sanitiza (solo `[A-Za-z0-9._-]`, máximo 40 chars).
- Si el path ya existe, se valida que pertenezca al mismo repo/run; si no, se elige otro.
- Requiere Git >= 2.30. Si falla, error accionable con la versión detectada.

#### Cambio a la rama de despliegue

```bash
# con el worktree limpio (ya se hizo el commit squash)
git switch -c <deploy_branch> origin/<target_branch>
git merge --squash flowmgr/squash/<run_short>
# resolver conflictos si aplica
git commit -m "<mensaje final>"
```

#### Limpieza

```bash
git worktree remove --force <worktree_path>
git branch -D flowmgr/squash/<run_short>
```

- En éxito se elimina el worktree.
- En conflicto/fallo se conserva (configurable) y la UI muestra "Abrir carpeta" / "Abrir VS Code".
- Nunca se elimina un worktree que no esté registrado como creado por FlowManager.

#### Por qué no usar la copia del usuario

- No se mueve su rama actual.
- No se toca su índice ni su stash.
- Se puede abortar con `reset --hard` sin riesgo.
- Permite reintentos y ejecuciones de varios repos.
- Evita el error clásico de "tienes cambios sin commitear" en la copia principal.

### 7.4 Creación de ramas de requerimiento

```bash
git fetch origin --prune
git branch <branch_name> origin/<base_branch>
git push -u origin <branch_name>     # opcional, configurable; default sí
```

- No se hace checkout.
- Si `git branch` falla porque existe: se consulta `git rev-parse --verify refs/heads/<name>` y `git ls-remote --heads origin <name>`.
- Si existe local y remoto, se reutiliza.
- Si existe solo remoto, se crea la local con tracking:
  `git branch --track <name> origin/<name>`.
- Se registra `branch_status` y `head_sha`.

### 7.5 Análisis

```bash
git fetch origin --prune

git rev-list --left-right --count origin/<base>...<branch>
# salida: "<behind>\t<ahead>"

git merge-base origin/<base> <branch>

git log --reverse --topo-order \
  --format='%H%x1f%s%x1f%an%x1f%ae%x1f%aI%x1f%P%x1e' \
  origin/<base>..<branch>

git diff --stat origin/<base>...<branch>
git diff --name-status origin/<base>...<branch>
```

- `ahead = 0` → `BlockedNoCommits` con mensaje "La rama no tiene commits respecto a <base>".
- `behind > 0` → advertencia, no bloqueo.
- Commits con más de un padre (merge) se marcan y, por defecto, no se seleccionan para cherry-pick; para merge-squash completo sí se incluyen en el diff de la rama.
- Commit "ajeno": mensaje/asunto que no contiene el `Task ID` ni el key del bundle. Se muestra con badge y se puede deseleccionar; no se oculta.
- Autor/fecha se muestran en UTC y en local.
- Para múltiples ramas, se repite y se deduplican SHAs.

### 7.6 Estrategias de squash

#### Estrategia A — `MergeSquash` (por defecto, todos los commits)

Requisito original: "merge --squash de las ramas seleccionadas".

```bash
# worktree en flowmgr/squash/<run>, creado desde origin/<base>
git merge --squash <branch_1>
# si conflicto: pausa; al continuar se hace git add + git commit -m "wip: <branch_1>"
git commit -m "wip: <branch_1>"

git merge --squash <branch_2>
# ...
git commit -m "wip: <branch_2>"

# colapsar todos los WIP en un solo commit
git reset --soft <base_sha>
git commit -m "<mensaje final>"
```

- Cada `merge --squash` deja cambios en índice/worktree; el commit WIP es necesario para poder aplicar el siguiente sin árbol sucio.
- Los commits WIP viven solo en la rama interna; no se empujan.
- Al final, `reset --soft` mueve HEAD a `base_sha` conservando el árbol; un único commit final.
- Si una rama no tiene cambios respecto a la base, se omite.
- Si el árbol final queda igual a `base_sha` (`git diff --quiet <base_sha>`), se marca `NoChanges` y no se crea commit.

#### Estrategia B — `CherryPick` (subconjunto de commits)

```bash
git cherry-pick -n <sha_1>
# si conflicto: pausa; al continuar: git add -A + git cherry-pick --continue
git cherry-pick -n <sha_2>
# ...
git reset --soft <base_sha>     # si se crearon commits intermedios
git commit -m "<mensaje final>"
```

- `-n` aplica sin commitear; si hay conflicto, Git deja `CHERRY_PICK_HEAD` y `--continue` crea un commit intermedio. Al final se colapsa con soft reset.
- Se ordenan por `--reverse --topo-order` para respetar dependencias.
- Los merge commits se rechazan en esta estrategia (la UI los deshabilita) salvo que el usuario indique el padre principal; v1: no seleccionables.
- Si un commit ya está en la base (patch-id), se omite y se informa.

#### Mensaje final

Plantilla por defecto:

```
{keys}: {titles}

Requerimientos:
- BPIM-183 Generador de CUVs - Ajustes Reglas de Duplicidad
- BPIM-184 ...

Commits incluidos:
- abc1234 mensaje del commit
- def5678 mensaje del commit

FlowManager-Run: 0192f3a4-b5c6-7d8e-9f00-112233445566
FlowManager-Env: qas
FlowManager-Target: release/1.0.5
```

- Editable en un textarea (CodeMirror opcional).
- Validación: no vacío, <= 8000 caracteres, primera línea <= 100.
- Se configura `user.name` y `user.email` para el commit con `git -c user.name=... -c user.email=... commit`; si no está configurado, se pide en Settings.
- No se firma en v1 (`commit.gpgsign=false` explícito para evitar fallos por configuración global).
- Los trailers permiten buscar el run en el historial del ambiente.

### 7.7 Aplicación sobre la rama de despliegue

```bash
git fetch origin --prune
git rev-parse origin/<target_branch>       # verificar base drift
git switch -c <deploy_branch> origin/<target_branch>
git merge --squash flowmgr/squash/<run_short>
# conflicto -> pausa
git commit -m "<mensaje final>"
```

- La rama hija se crea **desde el remoto del ambiente**, no desde master.
- El merge squash aplica el diff del squash sobre el árbol del ambiente; si el ambiente ya tiene parte de los cambios, puede haber conflicto y se resuelve.
- Un solo commit en la rama hija.
- Si el commit queda vacío (los cambios ya están en el ambiente), se marca `NoChanges` y no se empuja; se informa que probablemente ya está desplegado.

### 7.8 Push y verificación

```bash
# primera vez
git push -u origin <deploy_branch>

# si ya existe y es nuestra
git push --force-with-lease=refs/heads/<deploy_branch>:<expected_sha> \
  origin HEAD:refs/heads/<deploy_branch>

# verificación
git ls-remote origin refs/heads/<deploy_branch>
```

Guardrails:

- `assert_not_environment_branch(deploy_branch)` antes de cualquier push.
- Si `deploy_branch` coincide con una rama configurada de `dev/qas/uat/prd` o con `release/*` → `RefusingToPushEnvironmentBranch`.
- Si la rama remota existe y `expected_sha` es `None` → se rechaza el force; se pide al usuario elegir otro nombre.
- Nunca `--force` sin lease.
- No se empuja `flowmgr/squash/*`.
- El push puede fallar por auth, protección de rama, hooks remotos o red; se conserva el worktree y se ofrece reintentar.

### 7.9 API de GitHub (solo lectura)

- Parsear `origin` (`git remote get-url origin`) para obtener `owner/repo` en HTTPS o SSH.
- Token opcional en `secrets` (scope `github`), cifrado con DPAPI; se envía como `Authorization: Bearer <token>`.
- Endpoints:
  - `GET /repos/{owner}/{repo}/pulls?head={owner}:{branch}&state=all&per_page=100`
  - `GET /repos/{owner}/{repo}/pulls/{number}` (detalle/mergeado)
  - `GET /repos/{owner}/{repo}/commits/{sha}/pulls` (alternativa para encontrar PR por commit)
- Cache de 5 minutos por repo/rama para evitar rate limit.
- Sin token: solo se genera el enlace de comparación; el estado del PR queda `Unknown` y se usa Git/historial.
- No se crean, actualizan ni mergean PRs en v1.
- Enlace de comparación:
  `https://github.com/{owner}/{repo}/compare/{target_branch}...{deploy_branch}?expand=1`.
- Enlace directo a PR si se conoce: `https://github.com/{owner}/{repo}/pull/{number}`.

### 7.10 Estados de Git que la app debe reconocer

| Estado | Detección | Acción |
|---|---|---|
| `CONFLICT` | `git ls-files -u` no vacío | Pausar, mostrar archivos. |
| `CHERRY_PICK_HEAD` | archivo en `.git` del worktree | Continuar/abortar cherry-pick. |
| `MERGE_HEAD` | archivo en `.git` del worktree | No se usa en squash; si aparece, operación externa. |
| `SQUASH_MSG` | archivo en `.git` del worktree | Mensaje sugerido; se ignora y se usa el nuestro. |
| `rebase-merge/apply` | archivos en `.git` | La app no hace rebase; si existe, advertir y no tocar. |
| `index.lock` | archivo | Reintentar tras esperar; si persiste, error accionable. |
| Worktree inválido | `git worktree list --porcelain` | Recrear o cancelar. |

---

## 8. Máquina de estados

### 8.1 Diagrama

```
                    ┌──────────┐
                    │ Pending  │
                    └────┬─────┘
                         ▼
                    ┌──────────┐
                    │ Fetching │
                    └────┬─────┘
                         ▼
                    ┌──────────┐   sin commits   ┌─────────┐
                    │Analyzing │────────────────►│ Blocked │
                    └────┬─────┘                 └─────────┘
                         ▼
                    ┌──────────┐
                    │Squashing │◄──────────────┐
                    └────┬─────┘               │
                         │ conflicto           │ continuar
                         ▼                     │
                    ┌──────────┐               │
                    │ Conflict │───────────────┘
                    └────┬─────┘
                         │ abortar
                         ▼
                    ┌──────────┐
                    │Cancelled │
                    └──────────┘
                         │ sin conflicto
                         ▼
                    ┌──────────┐
                    │ Merging  │  (rama hija desde origin/env + squash)
                    └────┬─────┘
                         │ conflicto
                         ▼
                    ┌──────────┐
                    │ Conflict │
                    └────┬─────┘
                         │ continuar
                         ▼
                    ┌──────────┐
                    │ Pushing  │
                    └────┬─────┘
                         ▼
                ┌──────────────────┐
                │AwaitingDbDecision│
                └───┬──────────┬───┘
             omitir │          │ ejecutar
                    ▼          ▼
                ┌──────┐  ┌────────────────┐
                │ Done │  │RunningDbScripts│
                └──────┘  └───────┬────────┘
                                  ▼
                             ┌────────┐
                             │ Done / │
                             │ Failed │
                             └────────┘
```

### 8.2 Transiciones y guardas

| Desde | Hacia | Guarda | Efecto |
|---|---|---|---|
| `Pending` | `Fetching` | Repo válido, no hay run activo en el repo | Crea worktree, registra paso. |
| `Fetching` | `Analyzing` | Fetch OK | Snapshot de SHAs. |
| `Analyzing` | `Squashing` | `ahead > 0` | Persiste commits seleccionados. |
| `Analyzing` | `Blocked` | `ahead == 0` | Alerta "sin commits". |
| `Squashing` | `Merging` | Commit squash creado | Guarda `squash_commit_sha`. |
| `Squashing` | `Conflict` | `unmerged > 0` | Guarda fase, rama/commit y archivos. |
| `Squashing` | `Blocked` | `NoChanges` | No se empuja. |
| `Merging` | `Pushing` | Commit en rama hija creado | Verifica target base. |
| `Merging` | `Conflict` | `unmerged > 0` | Guarda fase `ApplyToEnv`. |
| `Merging` | `Blocked` | `BaseDrift` / `NoChanges` | Recalcular o cancelar. |
| `Pushing` | `AwaitingDbDecision` | SHA remoto verificado | Guarda `pushed_sha` y enlace. |
| `Conflict` | `Squashing` | `unmerged == 0` y fase `Squash` | Commit WIP / continuar. |
| `Conflict` | `Merging` | `unmerged == 0` y fase `ApplyToEnv` | Commit final. |
| `Conflict` | `Cancelled` | Abortar | Reset al `base_sha` del worktree. |
| `AwaitingDbDecision` | `RunningDbScripts` | Confirmación + conexión OK | Ejecuta en orden. |
| `AwaitingDbDecision` | `Done` | Omitir | `db_status = skipped`. |
| `RunningDbScripts` | `Done` | Todos OK | `db_status = executed`. |
| `RunningDbScripts` | `Failed` | Error y `stop_on_error` | `db_status = failed`; Git ya empujado. |
| Cualquiera | `Failed` | Error no recuperable | Guarda error y worktree. |
| Cualquiera | `Cancelled` | Cancelación segura | Limpieza según configuración. |

- `Done`, `Failed` y `Cancelled` son terminales para el intento. `Failed` permite **retry** creando `attempt + 1`, no cambiando el run anterior.
- `Blocked` es terminal para el intento, pero el usuario puede corregir y reintentar.
- No se permiten transiciones no listadas; `RunStateMachine::transition` devuelve `InvalidTransition`.

### 8.3 Persistencia y reanudación

Cada transición:

1. Valida la transición en memoria.
2. Actualiza `deployment_runs` (`state`, `substate`, `version = version + 1`, `checkpoint_json`, `updated_at`) en una transacción.
3. Inserta/actualiza `deployment_run_steps`.
4. Hace commit.
5. Emite evento (`flow://run-updated`).

`checkpoint_json` contiene:

```json
{
  "phase": "squash",
  "branchIndex": 1,
  "commitIndex": 4,
  "pendingBranches": ["BPIM-184"],
  "baseSha": "abc...",
  "squashBranch": "flowmgr/squash/0192...",
  "targetBranch": "release/1.0.5",
  "deployBranch": "BPIM-183-qas",
  "worktree": "C:\\...\\worktrees\\...",
  "lastCompletedStep": "merge_squash_BPIM-183"
}
```

Reanudación:

- Al arrancar, buscar runs en estados no terminales.
- Validar que el worktree exista y pertenezca al repo (`git worktree list --porcelain`).
- Reconciliar con la realidad:
  - Si la rama interna ya tiene el commit final, no repetir el squash.
  - Si la rama de despliegue ya existe con el commit, no repetir.
  - Si el push ya se hizo, verificar `ls-remote` y saltar a `AwaitingDbDecision`.
- Si el estado real no coincide con el checkpoint, ofrecer **Reconciliar** (recalcular desde Git) o **Cancelar**; nunca adivinar silenciosamente.
- El usuario ve un banner "Ejecución pendiente de reanudar" con acción.

### 8.4 Idempotencia

- `CreateBranch`: si existe, reutilizar; si el SHA no coincide, solo se permite si es la misma rama de trabajo y el usuario confirma.
- `Worktree`: si existe y está registrado, reutilizar; si está corrupto, recrear.
- `Squash`: si el commit final ya existe en la rama interna, saltar.
- `DeployBranch`: si existe y apunta al commit esperado, reutilizar; si no, recrear solo con confirmación.
- `Push`: si el remoto ya tiene el SHA, marcar como hecho.
- `Scripts`: `db_script_executions` evita duplicados por run/script; si se reintenta, se pregunta "¿reejecutar?" (default no).
- `Continue`: valida `version` para evitar doble click; si `version` cambió, devuelve `Conflict`/`StaleRun`.

---

## 9. Ingesta y registro de requerimientos (Monday CSV/XLSX + manual)

### 9.1 Formato observado en el archivo entregado

Archivo: `Tasks_Bplanner_Changes_Improvements_1793459694.xlsx` (export de Monday).

Columnas del bloque principal:

| Columna Monday | Campo destino | Notas |
|---|---|---|
| `Name` | `title` | Obligatorio. |
| `Sub Tasks` | `subtasks_summary` | Texto resumido; los detalles vienen en bloques `Subitems`. |
| `Feature` | `feature` | Agrupador funcional. |
| `Type` | `type` | Bug, User Story, Task. |
| `Informed` | `informed_raw` | Puede tener varios nombres. |
| `Developer` | `developer_raw` / `developer_normalized` | Filtro "mis requerimientos". |
| `QA` | `qa_raw` | Texto. |
| `Status` | `status` | Valores cambian con el tiempo; no hardcodear. |
| `Priority` | `priority` | Critical, High, Medium, Low, Missing. |
| `Timeline - Start` | `timeline_start` | Puede venir vacío. |
| `Timeline - End` | `timeline_end` | Puede venir vacío. |
| `monday Doc v2` | `monday_doc_url` | URL. |
| `Task ID` | `external_key` | Clave única (`BPIM-183`). |
| `Registro de creación` | `source_created_at` | Texto de Monday; parsear best-effort. |
| `Registro de actualización` | `source_updated_at` | Sirve para resolver duplicados. |

El archivo contiene:

- Una fila de título (`Tasks`).
- Una fila de encabezado.
- Filas de requerimientos.
- Filas `Subitems | Name | Owner | Status | Estimated SP | Actual SP`, seguidas de filas sin `Task ID` que pertenecen al requerimiento anterior.
- Una segunda sección `All Tasks` con su propio encabezado y más requerimientos/subitems.
- Filas vacías al final de cada sección.

### 9.2 Parser

Interfaz común:

```rust
pub struct ParsedRequirement {
    pub external_key: String,
    pub title: String,
    pub subtasks_summary: Option<String>,
    pub feature: Option<String>,
    pub r#type: Option<String>,
    pub informed_raw: Option<String>,
    pub developer_raw: Option<String>,
    pub qa_raw: Option<String>,
    pub status: Option<String>,
    pub priority: Option<String>,
    pub timeline_start: Option<String>,
    pub timeline_end: Option<String>,
    pub monday_doc_url: Option<String>,
    pub source_created_at: Option<String>,
    pub source_updated_at: Option<String>,
    pub subtasks: Vec<ParsedSubtask>,
    pub raw: serde_json::Value,
}
```

Algoritmo:

1. Leer el archivo:
   - CSV: detectar BOM, delimiter (`,`, `;`, tab) y encoding (UTF-8; fallback Windows-1252). Usar `csv` + `encoding_rs`.
   - XLSX: `calamine`, recorrer todas las hojas; convertir celdas a string (fechas a ISO).
2. Normalizar encabezados: trim, colapsar espacios, comparar case-insensitive.
3. Detectar una fila de encabezado cuando contenga `Task ID` **y** `Name` (o `Name` + `Type` en un bloque de subitems).
4. Recorrer filas:
   - Fila vacía → fin de sección.
   - Fila con `Task ID` → nuevo requerimiento; el último requerimiento pasa a ser el "padre actual".
   - Fila `Subitems` (header) → activar modo subitems; las siguientes filas sin `Task ID` se agregan al requerimiento padre.
   - Fila sin `Task ID` y sin modo subitems → ignorar (título de sección, basura).
   - Fila con `Task ID` duplicado → fusionar campos no vacíos; elegir el `source_updated_at` más reciente; registrar warning.
5. Validar `Task ID` con `^[A-Z][A-Z0-9]+-\d+$` (trim + uppercase). Si no cumple, warning y se ignora la fila (no rompe el import).
6. `Name` vacío → warning, se ignora.
7. Guardar `raw` de la fila para auditoría.

**No depender de índices de columna:** el export puede cambiar el orden. Mapear por nombre de encabezado.

### 9.3 Vista previa de importación

```rust
pub struct ImportPreview {
    pub import_id: String,
    pub file_hash: String,
    pub total_rows: usize,
    pub new: Vec<RequirementPreview>,
    pub updated: Vec<RequirementDiff>,
    pub unchanged: usize,
    pub absent: Vec<RequirementPreview>,   // en BD pero no en el archivo
    pub manual_conflicts: Vec<ManualConflict>, // key ya existe como manual
    pub duplicates: Vec<DuplicateWarning>,
    pub invalid_rows: Vec<InvalidRow>,
}
```

- `new`: key no existe.
- `updated`: existe y al menos un campo mapeado cambió; mostrar diff campo a campo.
- `unchanged`: existe y todos los campos mapeados coinciden.
- `absent`: existe en BD y no aparece en el archivo; **no se borra**; se marca `last_import_present = 0` (solo si `source = monday`).
- `manual_conflicts`: la key existe con `source = manual`. Por defecto **no se actualiza**; el usuario puede marcar "Vincular y actualizar con Monday" (pasa a `source = monday` conservando `manual_created = 1`). Si `manual_locked = 1`, no se permite sin desbloquear.
- `duplicates`: misma key en varias filas; se muestra el ganador y los campos fusionados.
- `invalid_rows`: filas sin key/título; se muestran para corregir el export.
- El preview se puede guardar en un JSON temporal (`%LOCALAPPDATA%\FlowManager\tmp\import-<hash>.json`) y se revalida el hash al confirmar. Si el archivo cambió, se vuelve a previsualizar.

### 9.4 Upsert transaccional

```sql
INSERT INTO requirements (...) VALUES (...)
ON CONFLICT(external_key) DO UPDATE SET
  title = excluded.title,
  feature = excluded.feature,
  status = excluded.status,
  ...,
  source = CASE WHEN requirements.source = 'manual'
                THEN requirements.source ELSE excluded.source END,
  last_seen_at = excluded.last_seen_at,
  last_import_id = excluded.last_import_id,
  last_import_present = 1,
  updated_at = excluded.updated_at;
-- No tocar: notes, is_active, created_at, first_seen_at, manual_created
```

- Todo el import en una transacción.
- Subitems: borrar y reinsertar solo los del requerimiento importado (son datos de Monday); no tocar notas locales.
- `requirements.notes`, `requirement_repositories`, `db_scripts`, bundles y despliegues **nunca** se tocan.
- `first_seen_at` se conserva; `last_seen_at` se actualiza.
- Un requerimiento manual **no se actualiza por defecto**: se lista en `manual_conflicts` y solo se adopta si el usuario lo confirma (`adoptManualKeys`). Al adoptarlo, `source = monday`, `manual_created = 1` y se conservan notas/mapeos/scripts.
- `manual_locked = 1` impide la adopción hasta que el usuario lo desbloquee explícitamente.
- Al final, `last_import_present = 0` para las keys ausentes del archivo (solo si el import fue exitoso y `source = monday`).
- Se registra `requirement_imports` con contadores y `raw_snapshot_path`.
- Idempotencia: importar el mismo archivo dos veces produce `unchanged` y no duplica.

### 9.5 Normalización de developers y filtro "mis requerimientos"

- `developer_normalized`: minúsculas, sin acentos, sin sufijos de empresa (` - Inetum`, ` - Sapiens`), espacios colapsados.
- El valor original se conserva en `developer_raw`.
- Settings: lista de alias del usuario, por ejemplo:
  ```json
  ["leonardo daniel gonzalo laura", "leonardo gonzalo laura", "lgonzalo"]
  ```
- El filtro "Mis requerimientos" compara por token/contiene contra los alias, no por igualdad exacta.
- La UI permite mapear nombres desde Settings si hay variantes.
- `QA`, `Informed` y `Developer` pueden contener varios nombres separados por coma; se conserva el texto y se hace match por inclusión.

### 9.6 Mapeo automático requerimiento → repositorio/rama

1. El usuario pulsa "Detectar ramas" en un repo (o se ejecuta al importar, opcional).
2. La app lista todas las refs remotas una vez:
   ```bash
   git for-each-ref refs/remotes/origin \
     --format='%(refname:short)%x1f%(objectname)%x1f%(committerdate:iso-strict)%x1e'
   ```
3. En memoria, para cada requerimiento, busca su `external_key` (case-insensitive) dentro del nombre de rama.
4. Resultado:
   - 1 rama → propuesta automática (`mapping_source = auto`).
   - >1 rama → mostrar candidatas; el usuario elige.
   - 0 ramas → sin mapeo; el usuario puede crearla.
5. El mapeo manual siempre gana y no se sobrescribe en escaneos posteriores.
6. Si la rama propuesta no existe localmente, se crea al confirmar.

### 9.7 Importación de CSV (plantilla)

El usuario puede exportar desde Monday a CSV. La app acepta el CSV tal cual, siempre que tenga `Task ID` y `Name`. Plantilla mínima:

```csv
Task ID,Name,Sub Tasks,Feature,Type,Informed,Developer,QA,Status,Priority,Timeline - Start,Timeline - End,monday Doc v2,Registro de creación,Registro de actualización
BPIM-183,Generador de CUVs - Ajustes Reglas de Duplicidad,,Generador de CUVs - Ajustes Reglas de Duplicidad,User Story,Kevin Ubaldo Atachagua Flores,Edgar Alexander Malca Rojas - Inetum,Monica Chacon,Code Review,Medium,,,,,,
```

- Se aceptan columnas extra; se ignoran.
- Se aceptan filas de subitems con el bloque `Subitems,Name,Owner,Status,Estimated SP,Actual SP` o un formato alternativo con `Parent Task ID` + `Name`. Si existe `Parent Task ID`, se usa para asociar directamente; si no, se usa el "último padre".
- Para CSV grandes (>10k filas), parsear en streaming y mostrar progreso; la vista previa puede limitarse a 500 filas con "ver más".

### 9.8 Registro manual de requerimientos

#### Cuándo usarlo

- El requerimiento aún no está en Monday.
- Llegó por correo/chat/ticket y se necesita empezar a trabajar ya.
- Se quiere preparar el despliegue antes de que Monday se actualice.

#### Campos

| Campo | Obligatorio | Regla |
|---|---|---|
| `Task ID` | Sí (o auto-generado) | `^[A-Z][A-Z0-9]*-\d+$`; único; se normaliza a mayúsculas. |
| Título | Sí | 1..300 caracteres. |
| Feature | No | Texto libre. |
| Tipo | No | Bug / User Story / Task u otro. |
| Developer | No | Texto; se normaliza igual que Monday. |
| QA | No | Texto. |
| Estado | No | Texto libre con sugerencias. |
| Prioridad | No | Texto libre con sugerencias. |
| Notas | No | Texto largo. |
| Repositorios | No | Se pueden mapear ahora o después. |
| Rama | No | Default `Task ID`; validada. |

#### Reglas

- Si el usuario deja vacío el `Task ID`, la app genera `MAN-0001`, `MAN-0002`, etc. El prefijo es configurable (`manual_key_prefix`, default `MAN`).
- Se guarda `source = 'manual'`, `manual_created = 1`, `manual_locked` según configuración (default `0`).
- `last_import_present = 1` pero **no** participa del marcado de ausentes de Monday.
- Los campos de Monday no existen para un manual; se muestran vacíos y editables.
- Se puede editar cualquier campo mientras `source = 'manual'`; si fue adoptado por Monday (`source = 'monday'`, `manual_created = 1`), los campos de Monday pasan a read-only y solo se editan notas/mapeos.
- Se puede **archivar** (soft delete): `is_active = 0`, `archived_at`. No se borra el historial de despliegues. Si tiene runs activos, se bloquea.
- Un manual puede seleccionarse para despliegue como cualquier otro.
- La lista muestra un badge `Manual` y permite filtrar por origen.
- Si el `Task ID` ya existe (manual o Monday), se rechaza con `DUPLICATE_KEY` y se ofrece abrir el existente.
- Al crear con repos, se puede disparar "crear ramas" en el mismo flujo; si falla Git, el requerimiento queda creado y la rama `missing` para reintentar.

#### Colisión con Monday

Escenario: existe `BPIM-999` manual y luego aparece `BPIM-999` en el export.

1. El preview de importación lo muestra en `manual_conflicts`, no en `updated`.
2. El usuario puede:
   - **Vincular y actualizar:** `source = 'monday'`, se actualizan campos de Monday, se conservan notas, mapeos, ramas y scripts.
   - **Mantener manual:** no se actualiza; se registra la decisión.
   - **Bloquear:** `manual_locked = 1` para que futuros imports no vuelvan a preguntar.
3. Si el usuario no hace nada, el manual queda intacto.
4. Nunca se crea un duplicado por la misma key.

### 9.9 Adaptadores futuros

```rust
pub trait RequirementSource {
    fn id(&self) -> SourceId;
    fn can_handle(&self, path: &Path) -> bool;
    async fn preview(&self, path: &Path) -> Result<ImportPreview, ImportError>;
    async fn parse(&self, path: &Path) -> Result<Vec<ParsedRequirement>, ImportError>;
}
```

- `MondayXlsxSource`, `MondayCsvSource`, `JiraCsvSource`, `JiraApiSource` (futuro).
- La UI de importación solo habla del puerto; agregar una fuente no cambia la pantalla.

---

## 10. UI / UX

### 10.1 Navegación principal

Barra lateral con:

1. **Requerimientos** (dashboard/tabla).
2. **Lotes** (historial de despliegues).
3. **Repositorios**.
4. **Bases de datos** (conexiones y scripts globales).
5. **Configuración**.

Barra superior: repo(s) activos, estado de conexión, botones "Importar" y "Nuevo requerimiento", búsqueda global, indicador de runs activos.

### 10.2 Pantalla "Requerimientos"

#### Filtros

- Búsqueda por `Task ID`, título, feature.
- **Mis requerimientos** (toggle; usa alias de developer).
- Developer (multi-select, incluye "Sin asignar").
- Origen: `Monday` / `Manual` / `Todos`.
- Estado Monday, prioridad, tipo, feature.
- Presencia por ambiente: `Local`, `DEV`, `QAS`, `UAT`, `PRD`, `Sin rama`, `PR abierto`.
- Repositorio.
- "Solo con commits", "Solo sin cambios", "No está en la última importación".
- Rango de fechas de actualización.
- Botón "Limpiar filtros" y vistas guardadas (opcional fase 2).

#### Tabla (tipo Excel)

| Columna | Contenido |
|---|---|
| Checkbox | Selección para lote. |
| `Task ID` | `BPIM-183` o `MAN-0001`, click abre detalle. |
| Origen | Badge `Monday` / `Manual`. |
| Título | Truncado con tooltip. |
| Feature | Texto. |
| Tipo | Badge. |
| Developer | Texto; resaltado si es "mío". |
| Estado | Badge con color por estado. |
| Prioridad | Badge. |
| Repos | `3 repos` con tooltip de nombres/ramas. |
| Local | Chip si hay rama con commits. |
| Ambientes | Matriz compacta `DEV 2/3`, `QAS 1/3`, etc. Tooltip por repo. |
| Última actualización | Fecha. |
| Acciones | Analizar, Crear ramas, Desplegar, Detalle. |

- Encabezados sticky, columnas redimensionables, orden multi-columna, virtualización.
- Selección múltiple con `Shift`/`Ctrl`.
- Edición inline solo en campos locales: `notes`, nombre de rama, mapeo. Los campos de Monday son read-only; los manuales son editables.
- Botón "Nuevo requerimiento" abre el formulario de alta manual.
- Exportar vista a CSV (fase 2).
- Empty state con CTA "Importar requerimientos", "Nuevo requerimiento" / "Agregar repositorio".
- Loading skeletons; error con reintento.

#### Formulario "Nuevo requerimiento"

- `Task ID` con botón "Generar" (`MAN-0001`); valida duplicados en vivo.
- Título obligatorio; feature, tipo, developer, QA, estado, prioridad y notas opcionales.
- Sección "Repositorios": agregar uno o varios, con rama default = `Task ID` y checkbox "Crear rama ahora".
- Botones "Guardar", "Guardar y crear ramas", "Cancelar".
- Al guardar, aparece en la lista y se puede abrir el detalle.
- Si el usuario intenta usar una key existente, se muestra "Ya existe" con enlace al requerimiento.
- Formulario reutilizable para editar un manual.

#### Acciones masivas

- "Crear ramas" para los seleccionados (elige repos y confirma nombres).
- "Analizar" (solo lectura; muestra resultados).
- "Preparar despliegue" → wizard.
- "Asignar repositorio" manual.
- "Archivar" solo para manuales (con confirmación; bloquea si hay runs activos).

### 10.3 Detalle del requerimiento (drawer/modal grande)

Pestañas:

1. **Resumen**: todos los campos, link al doc, notas locales; edición si es manual.
2. **Repos y ramas**: tabla repo, rama, base, ahead/behind, último análisis, estado, acciones (crear/analizar/abrir en GitHub).
3. **Commits**: lista con checkbox (cuando se prepara squash), autor, fecha, mensaje, badge "ajeno".
4. **Scripts BD**: lista ordenable, editor SQL, engine, scope, checksum, botón probar conexión.
5. **Ambientes**: matriz repo × ambiente con estado, evidencia y fecha; botón refrescar.
6. **Historial**: bundles, lotes, runs, PRs, logs.

- Cambios locales se guardan con debounce y confirmación.
- `Task ID` no editable una vez creado; en manuales se pueden editar los demás campos. Si fue adoptado por Monday, los campos de Monday pasan a read-only.
- Si es manual, mostrar badge y acciones "Editar", "Archivar", "Vincular con Monday" (cuando exista colisión).

### 10.4 Wizard de despliegue

Paso 1 — **Ambiente**
- Selección `dev/qas/uat/prd`.
- Tabla por repo con rama de ambiente resuelta, SHA, modo (auto/manual) y advertencias.
- Si un repo no tiene ambiente resuelto, se muestra bloqueado y se puede excluir.

Paso 2 — **Requerimientos y repos**
- Lista de los requerimientos seleccionados.
- Agrupación automática por repo.
- Si hay 2+ requerimientos en el mismo repo, se muestra "Se unificarán en `BPIM-183-BPIM-184`".
- Se pueden quitar requerimientos o repos.

Paso 3 — **Commits y squash**
- Por repo: ramas fuente, ahead/behind, lista de commits con checkbox (todos por defecto).
- Estrategia: "Todos los commits (merge --squash)" o "Selección de commits (cherry-pick)".
- Mensaje final editable, con preview.
- Nombre de rama de despliegue editable (`BPIM-183-qas`).
- Advertencia si hay commits ajenos o la rama está behind.

Paso 4 — **Vista previa / preflight**
- Target branch y SHA por repo.
- Archivos cambiados y diff stat.
- Scripts BD que se ejecutarán (y si falta conexión).
- Bloqueos y advertencias.
- Botón "Iniciar despliegue" (deshabilitado si hay bloqueos).

Paso 5 — **Ejecución**
- Ver sección 10.5.

### 10.5 Consola de ejecución

- Cabecera del batch: ambiente, estado, tiempo, botón cancelar.
- Tarjetas por repo:
  - Estado (`Analyzing`, `Squashing`, `Conflict`, etc.) con icono y color.
  - Barra de pasos.
  - Target branch, deploy branch, SHAs.
  - Botones: abrir worktree, abrir VS Code, ver diff, copiar logs.
- Consola de logs:
  - Stream en vivo (`flow://log`).
  - Filtro por repo/nivel/fase.
  - Autoscroll con pausa.
  - Copiar/exportar.
  - Límite en memoria (5k líneas) y persistencia completa en disco/BD.
- Panel de conflicto (sección 10.6).
- Panel de decisión de scripts (sección 10.7).
- Al terminar: resumen, enlace a GitHub, siguiente acción ("Crear PR en GitHub", "Refrescar estado").

### 10.6 Modal de conflicto

- Título: "Conflicto en `<repo>` — fase `<Squash|ApplyToEnv>`".
- Lista de archivos con estado (`UU`, `AA`, `DU`, etc.).
- Por archivo: "Abrir en VS Code", "Abrir carpeta", "git add".
- Botón "Agregar todos" (solo si el usuario confirma).
- Botón "Continuar" deshabilitado si hay unmerged; muestra "Faltan N archivos por resolver".
- Botón "Abortar" con confirmación que explica que se descarta el worktree, no la copia principal.
- Instrucciones cortas:
  1. Abre el archivo en VS Code.
  2. Resuelve los marcadores `<<<<<<<`, `=======`, `>>>>>>>`.
  3. Guarda y pulsa "git add".
  4. Cuando no queden archivos, pulsa "Continuar".
- Si se cierra el modal, el batch queda en pausa y se puede reabrir desde la lista de lotes.
- Fase 2: integrar el `ConflictResolver` de `tarugit` (3-way) como alternativa embebida.

### 10.7 Panel de scripts BD

- Lista de scripts con orden, nombre, engine, scope y checksum.
- Estado de conexión por ambiente: `Configurada` / `No configurada`.
- Si no hay conexión:
  - Banner rojo: "No se pueden ejecutar los scripts en `<ambiente>` hasta configurar la conexión."
  - Botones: "Configurar conexión" (abre modal) y "Omitir por ahora" (deja `DB pendiente`).
- Si hay conexión:
  - Botón "Ejecutar scripts" con confirmación que muestra ambiente, host/base (sin password) y lista.
  - Checkbox "Detener en el primer error" (default ON).
  - Checkbox "Usar transacción por script" (default ON si el motor lo permite).
  - Consola de salida por script.
- Estados: `pending`, `running`, `success`, `failed`, `skipped`.
- Un fallo no revierte el push ya hecho; se muestra claramente "Git OK / BD falló".

### 10.8 Pantalla "Repositorios"

- Lista con nombre, ruta, remoto, base, última actualización, estado.
- Agregar:
  - "Seleccionar carpeta" (dialog) → validar repo.
  - "Clonar" (URL + carpeta) si la ruta no existe.
- Detalle:
  - Datos generales editables (nombre, base, remoto, GitHub owner/repo).
  - Botón "Fetch ahora".
  - Matriz de ambientes:
    | Ambiente | Rama detectada | Modo | SHA | Evidencia | Acciones |
    - Selector de rama con candidatas y opción "Auto".
    - Botón "Detectar de nuevo".
  - Estado de credenciales Git (no se muestran; solo "OK/Falta").
  - Advertencia si la ruta está en OneDrive.
  - Botón "Escanear ramas de requerimientos" (propuestas de mapeo).

### 10.9 Pantalla "Bases de datos"

- Conexiones:
  - Lista por repo/ambiente/engine.
  - Alta/edición: host, puerto, base, usuario, password (write-only), SSL, opciones.
  - Botón "Probar conexión" (`SELECT 1`).
  - Password nunca se devuelve; solo `hasPassword`.
- Scripts:
  - Vista global filtrable por requerimiento/repo.
  - Editor SQL (CodeMirror `lang-sql`), engine, sequence, scope.
  - Validación de sintaxis básica y advertencia de statements destructivos (`DROP`, `TRUNCATE`, `DELETE` sin `WHERE`) — no bloquea, pero resalta.
- Ejecuciones: historial con salida, error, duración, usuario.

### 10.10 Pantalla "Lotes" / historial

- Tabla: nombre, ambiente, estado, repos, requerimientos, creado, iniciado, terminado, PRs.
- Filtros por estado/ambiente/fecha.
- Detalle: misma consola de ejecución en modo lectura, con logs persistidos y botones "Reintentar repo fallido", "Refrescar estado", "Abrir PR".
- Runs recuperables al inicio: banner global.

### 10.11 Configuración

- **Usuario Git**: nombre, email para commits.
- **Mis alias de developer**.
- **Editor**: comando (`code`, `cursor`, ruta), detectado automáticamente.
- **Plantillas de rama**: requerimiento, bundle, despliegue.
- **Concurrencia**: `max_parallel_repos` (default 1).
- **Worktrees**: retención en éxito/fallo, limpieza manual.
- **Logs**: retención, nivel.
- **GitHub**: token (write-only, DPAPI), owner/repo por repo.
- **Seguridad**: explicar DPAPI, no exportar secretos.
- **Avanzado**: ruta de Git, flags de hooks (respetar hooks por defecto), long paths.

### 10.12 Componentes reutilizados de `tarugit`

- `components/ui/Modal.tsx`, `Toast.tsx`, `Spinner.tsx`, `BranchCombo.tsx`.
- `components/DiffViewer.tsx`, `components/history/FileDiffViewer.tsx`.
- `components/OperationStatusBar.tsx` (adaptar a la máquina de estados).
- `components/ConflictResolver/*` (fase 2; el parser de bloques y el visor 3-way son reutilizables).
- `components/history/SquashForm.tsx` (solo la UI del mensaje; la lógica es nueva).
- `App.css` / variables de color y tipografía.
- `hooks/useRepository.ts` (patrón de `invoke` + `listen` + refresh).
- `watcher.rs` (opcional; FlowManager no necesita vigilar cambios del usuario, pero puede usarlo para refrescar el estado del repo).

**No reutilizar tal cual:**

- `git reset --soft HEAD~N` de `SquashForm`: reescribe la rama actual; FlowManager solo lo hace en ramas internas.
- `push -f` sin lease de `push_branch`.
- Errores como `String`; FlowManager usa errores tipados.
- Token de GitHub en el frontend; FlowManager lo cifra en backend.
- Operaciones sobre la copia de trabajo del usuario; FlowManager usa worktrees.

---

## 11. Contratos Tauri

### 11.1 Convenciones

- Nombres de comandos en `snake_case` (`requirements_list`), argumentos en `camelCase` (Tauri los mapea).
- DTOs en `camelCase` (`serde(rename_all = "camelCase")`).
- Fechas ISO-8601 UTC.
- IDs string (UUID v7).
- Errores estructurados, nunca solo un string.
- Comandos de lectura son rápidos y paginados; las operaciones largas se lanzan en background y devuelven un `runId`/`batchId` inmediatamente.
- Toda mutación devuelve el estado actualizado o el ID creado.

### 11.2 Errores

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiError {
    pub code: String,          // GIT_AUTH, NO_COMMITS, CONFLICT, ...
    pub message: String,       // mensaje para el usuario
    pub details: Option<String>,
    pub retryable: bool,
    pub context: Option<serde_json::Value>,
}
```

Códigos principales:

| Código | Significado | Acción UI |
|---|---|---|
| `VALIDATION` | Datos inválidos | Resaltar campo. |
| `REPO_NOT_FOUND` | Ruta no es repo | Pedir ruta/clonar. |
| `GIT_AUTH` | Credenciales | Configurar credential helper. |
| `BRANCH_NOT_FOUND` | Rama no existe | Crear/configurar. |
| `BRANCH_EXISTS` | Colisión | Elegir otro nombre. |
| `NO_COMMITS` | Sin commits vs base | Alerta; no desplegar. |
| `ENV_UNRESOLVED` | Ambiente sin rama | Configurar manualmente. |
| `BASE_DRIFT` | Rama ambiente cambió | Recalcular. |
| `CONFLICT` | Archivos unmerged | Abrir modal. |
| `PUSH_REJECTED` | Remoto rechazó | Revisar lease/auth. |
| `REFUSING_ENV_PUSH` | Intento de push a ambiente | Bloqueo duro (bug). |
| `DB_NOT_CONFIGURED` | Sin conexión | Configurar u omitir. |
| `DB_CONN_FAILED` | No conecta | Revisar credenciales/red. |
| `DB_SCRIPT_FAILED` | Error SQL | Ver salida; reintentar. |
| `IMPORT_INVALID` | Archivo/columnas | Corregir export. |
| `REPO_EXISTS` | Ruta ya registrada | Abrir el repositorio existente. |
| `GIT_MISSING` | Git no está en el PATH | Instalar Git y reiniciar. |
| `GIT_ERROR` | Git rechazó una operación | Revisar el detalle y reintentar. |
| `GIT_TIMEOUT` | Git excedió el tiempo | Revisar red/credenciales. |
| `ENV_BRANCH_NOT_FOUND` | La rama manual no existe | Elegir otra rama. |
| `DUPLICATE_KEY` | `Task ID` ya existe | Abrir el existente. |
| `MANUAL_LOCKED` | Manual protegido contra Monday | Desbloquear con confirmación. |
| `REQUIREMENT_ARCHIVED` | Requerimiento archivado | Restaurar o elegir otro. |
| `REQUIREMENT_NOT_EDITABLE` | Campo de Monday en modo lectura | Editar solo campos locales. |
| `STALE_RUN` | Versión cambió | Refrescar. |
| `REPO_BUSY` | Run activo en repo | Esperar/cancelar. |

### 11.3 Comandos — Requerimientos

```ts
requirements_list({ filter, page, pageSize }) => { items: RequirementListItem[], total }
requirements_get({ requirementId }) => RequirementDetail
requirements_create_manual({ input, repositories?, createBranches? }) => RequirementDetail
requirements_update_manual({ requirementId, patch }) => RequirementDetail
requirements_archive_manual({ requirementId }) => void
requirements_import_preview({ filePath, source? }) => ImportPreview
requirements_import_commit({ previewId, fileHash, adoptManualKeys? }) => ImportResult
requirements_link_manual({ requirementId }) => RequirementDetail
requirements_update_local({ requirementId, notes? }) => RequirementDetail
requirements_assign_repository({ requirementId, repositoryId, branchName?, baseBranch? }) => RequirementRepository
requirements_unassign_repository({ requirementId, repositoryId }) => void
requirements_scan_branches({ repositoryId }) => BranchMappingSuggestion[]
requirements_environment_status({ requirementId? }) => EnvironmentStatusMatrix
```

`requirements_create_manual` input:

```ts
{
  externalKey?: string;        // vacío => MAN-0001
  title: string;
  feature?: string;
  type?: string;
  developer?: string;
  qa?: string;
  status?: string;
  priority?: string;
  notes?: string;
  manualLocked?: boolean;
}
```

`RequirementListItem`:

```ts
{
  id: string;
  externalKey: string;          // BPIM-183 | MAN-0001
  source: 'monday' | 'manual';
  manualCreated: boolean;
  manualLocked: boolean;
  title: string;
  feature: string | null;
  type: string | null;
  developer: string | null;
  status: string | null;
  priority: string | null;
  repos: { repositoryId: string; name: string; branch: string }[];
  local: boolean;
  environments: {
    dev: EnvSummary; qas: EnvSummary; uat: EnvSummary; prd: EnvSummary;
  };
  lastSeenAt: string;
  lastImportPresent: boolean;
  archivedAt: string | null;
}

type EnvSummary = {
  status: 'unknown'|'not_present'|'pushed'|'pr_open'|'merged'|'probable'|'rejected';
  present: number;   // repos con evidencia
  total: number;     // repos mapeados
  confidence: 'low'|'medium'|'high';
};
```

### 11.4 Comandos — Repositorios y ambientes

```ts
repositories_list() => RepositorySummary[]
repositories_get({ repositoryId }) => RepositoryDetail
repositories_add({ path }) => RepositoryDetail
repositories_clone({ url, path, name? }) => RepositoryDetail
repositories_update({ repositoryId, name?, baseBranch?, remoteName?, githubOwner?, githubRepo? }) => RepositoryDetail
repositories_remove({ repositoryId, deleteLocal? }) => void
repositories_fetch({ repositoryId }) => FetchReport
repositories_detect_environments({ repositoryId }) => EnvironmentDetectionResult[]
repositories_set_environment({ repositoryId, environment, branchName?, mode }) => EnvironmentDetectionResult
repositories_list_branches({ repositoryId, includeRemote? }) => BranchInfo[]
```

`EnvironmentDetectionResult`:

```ts
{
  environment: 'dev'|'qas'|'uat'|'prd';
  branchName: string | null;
  mode: 'auto'|'manual';
  sha: string | null;
  candidates: { name: string; sha: string; committedAt: string; version?: string }[];
  note: string;
  ambiguous: boolean;
}
```

### 11.5 Comandos — Ramas y análisis

```ts
branches_create({ requirementIds, repositoryIds, branchNames? , push? }) => BranchCreationResult[]
branches_analyze({ requirementIds, repositoryIds }) => AnalysisResult[]
branches_list_commits({ requirementId, repositoryId }) => CommitInfo[]
branches_diff({ repositoryId, base, head }) => DiffStat
```

`AnalysisResult`:

```ts
{
  requirementId: string;
  repositoryId: string;
  branch: string;
  base: string;
  ahead: number;
  behind: number;
  mergeBase: string;
  headSha: string;
  commits: {
    sha: string; subject: string; author: string; date: string;
    foreign: boolean; isMerge: boolean;
  }[];
  filesChanged: number;
  additions: number;
  deletions: number;
  blocked: boolean;
  warnings: string[];
}
```

### 11.6 Comandos — Despliegue

```ts
deployment_prepare({ environment, items, options? }) => DeploymentPreview
deployment_start({ previewToken, confirm }) => { batchId: string }
deployment_get({ batchId }) => BatchDetail
deployment_list({ filter, page, pageSize }) => { items: BatchSummary[]; total: number }
deployment_continue_conflict({ runId, expectedVersion }) => void
deployment_abort({ runId, expectedVersion, keepWorktree? }) => void
deployment_retry({ runId }) => { newRunId: string }
deployment_cancel({ batchId }) => void
deployment_refresh_target({ batchId }) => DeploymentPreview   // recalcular BaseDrift
deployment_open_worktree({ runId }) => void
deployment_open_in_editor({ runId, filePath? }) => void
deployment_stage_file({ runId, filePath }) => void
deployment_stage_all({ runId }) => void
deployment_push_preview({ runId }) => { diff: string; files: string[]; targetSha: string }
```

`items` del preview:

```ts
{
  bundleId: string;
  repositoryId: string;
  requirementIds: string[];
  sourceBranches: { branch: string; commits: string[] }[];
  targetBranch: string;
  targetBaseSha: string;
  deployBranch: string;
  squashMessage: string;
  strategy: 'all_commits' | 'selected_commits';
}
```

`DeploymentPreview` incluye `previewToken` (hash del plan + SHAs), `blockers`, `warnings`, `scripts`, `targets`.

### 11.7 Comandos — BD

```ts
db_connections_list({ repositoryId? }) => DbConnectionSummary[]
db_connections_upsert({ id?, repositoryId?, environment, engine, host, port, databaseName, username, password?, sslMode?, options? }) => DbConnectionSummary
db_connections_delete({ id }) => void
db_connections_test({ id }) => { ok: boolean; latencyMs: number; message?: string }
db_scripts_list({ requirementId?, repositoryId? }) => DbScript[]
db_scripts_upsert({ id?, requirementId, repositoryId, name, engine, sequenceNo, environmentScope, sourceType, content?, filePath? }) => DbScript
db_scripts_reorder({ requirementId, repositoryId, orderedIds }) => void
db_scripts_delete({ id }) => void
db_scripts_validate({ content, engine }) => { valid: boolean; warnings: string[] }
deployment_run_scripts({ runId, expectedVersion, stopOnError?, useTransaction? }) => void
deployment_skip_scripts({ runId, expectedVersion, reason? }) => void
db_executions_list({ runId }) => DbScriptExecution[]
```

### 11.8 Comandos — Settings / sistema

```ts
settings_get() => AppSettings
settings_set({ patch }) => AppSettings
system_info() => { appVersion, gitVersion, os, editor, dpapiAvailable }
logs_list({ runId?, batchId?, level?, after?, limit? }) => LogEntry[]
logs_export({ runId, format }) => { path: string }
runs_recoverable_list() => RecoverableRun[]
runs_recover({ runId, action: 'resume'|'cancel' }) => void
github_set_token({ token }) => { ok: true }
github_token_status() => { configured: boolean; login?: string }
github_pr_status({ repositoryId, deployBranch, targetBranch }) => PrStatus
```

### 11.9 Eventos

| Evento | Payload | Cuándo |
|---|---|---|
| `flow://batch-updated` | `{ batchId, status, updatedAt }` | Cambia el batch. |
| `flow://run-updated` | `RunSnapshot` | Cada transición. |
| `flow://log` | `{ runId, batchId, repoId, level, phase, message, detail?, at }` | Cada línea relevante. |
| `flow://conflict` | `{ runId, files, phase, worktree }` | Se detecta conflicto. |
| `flow://db-output` | `{ runId, scriptId, stream, chunk }` | Salida SQL en vivo. |
| `flow://import-progress` | `{ importId, processed, total }` | Import grande. |
| `flow://repo-updated` | `{ repositoryId }` | Fetch/rama creada. |

`RunSnapshot`:

```ts
{
  runId: string;
  batchId: string;
  repositoryId: string;
  state: RunState;
  substate: string | null;
  version: number;
  attempt: number;
  progress: number;            // 0..100
  deployBranch: string | null;
  targetBranch: string;
  worktree: string | null;
  conflictFiles: string[];
  error: { code: string; message: string } | null;
  updatedAt: string;
}
```

- El frontend escucha y actualiza el store; además refetch del batch al recibir un estado terminal.
- Los eventos no reemplazan la fuente de verdad: al abrir una pantalla se consulta el estado actual.

### 11.10 Seguridad de comandos

- Todos los comandos validan que el `runId`/`batchId` exista y pertenezca al usuario local.
- No se aceptan rutas arbitrarias para escribir: los worktrees los elige el backend.
- `repositories_add` valida `.git` y canonicaliza la ruta.
- `deployment_stage_file` valida que el archivo esté dentro del worktree y esté en conflicto.
- `deployment_open_in_editor` valida el path y usa el comando configurado; no ejecuta shell strings.
- Los secretos nunca se serializan; `password` es write-only.

---

## 12. Scripts BD y conexiones

### 12.1 Motores

| Motor | Driver | Notas |
|---|---|---|
| SQL Server | `tiberius` (async, rustls) | Separar batches por `GO`; autenticación SQL; TLS configurable. |
| PostgreSQL | `sqlx` (`PgPool`) | `raw_sql` para múltiples statements; transacción por script. |

- SQLite se usa solo para metadatos de la app; no para scripts de negocio.
- `sqlx` no soporta SQL Server; no forzar esa combinación.

### 12.2 Modelo de conexión

- Una conexión por `(repository_id, environment, engine)`; `repository_id` nullable para una conexión global de fallback.
- Resolución: primero la conexión del repo+ambiente; si no existe, la global del ambiente.
- Campos: host, puerto (default 1433 SQL Server / 5432 PostgreSQL), base, usuario, password cifrado, SSL, opciones.
- Password:
  - Se cifra con DPAPI (`CryptProtectData`) y se guarda en `secrets.ciphertext`.
  - Nunca se loggea ni se devuelve.
  - `db_connections_test` recibe `id`, no la password desde el frontend.
- Prueba de conexión: `SELECT 1` con timeout de 10 s.
- SQL Server:
  - `encrypt=true` por defecto; `trust_server_certificate` configurable.
  - Autenticación SQL (usuario/password). Windows Integrated queda como futuro.
- PostgreSQL:
  - `sslmode` configurable (`disable`, `prefer`, `require`).
  - Timeout de conexión y de statement.

### 12.3 Orden de ejecución

Para un run (bundle + repo + ambiente):

1. Scripts de los requerimientos del bundle, en el orden del bundle.
2. Dentro de cada requerimiento, `sequence_no` ascendente.
3. Filtrar por `environment_scope` (`all` o el ambiente actual).
4. Deduplicar por `script.id` (si un script se comparte, se ejecuta una vez).
5. Saltar `is_active = 0`.

Ejemplo:

```
BPIM-183
  10  create_table_x.sql
  20  seed_x.sql
BPIM-184
  10  alter_table_y.sql
```

Si hay dependencias entre requerimientos, el usuario las controla con el orden del bundle y `sequence_no`.

### 12.4 Ejecución

- Se ejecuta **después** del push y con confirmación explícita.
- Si no hay conexión:
  - `DB_NOT_CONFIGURED`; la UI muestra alerta y no permite ejecutar.
  - El usuario puede "Omitir por ahora"; el batch termina `DoneWithPendingDb`.
- Si hay conexión:
  - Diálogo de confirmación con ambiente, host, base, lista de scripts, checkbox de transacción y stop-on-error.
  - PRD: confirmación adicional escribiendo el nombre del ambiente (`prd`).
  - Ejecución secuencial; salida en vivo (`flow://db-output`).
  - Por script: `db_script_executions` con estado, timestamps, output (truncado), error.
  - Si `stop_on_error` (default): se detiene y la run queda `Failed` con `db_status=failed`; Git ya está empujado.
  - Si no: continúa y al final reporta scripts fallidos.
- SQL Server:
  - Dividir por líneas que sean exactamente `GO` (case-insensitive, permitiendo comentarios) y ejecutar cada batch con `simple_query`.
  - `GO` no es SQL; nunca enviarlo al servidor.
  - Capturar mensajes/rows; limitar output.
- PostgreSQL:
  - `sqlx::raw_sql(&script)` dentro de una transacción si el usuario lo pidió.
  - Si el script contiene `BEGIN/COMMIT` propios, desactivar la transacción externa y advertir.
- No se permiten scripts que cambien de base (`USE`) en SQL Server dentro de una conexión; se advierte.

### 12.5 Seguridad y guardrails

- Solo se ejecutan scripts guardados en la app; no SQL arbitrario desde la consola.
- Mostrar advertencia si el script contiene:
  - `DROP`, `TRUNCATE`, `ALTER`, `DELETE` sin `WHERE`, `UPDATE` sin `WHERE`.
- No ejecutar en `prd` sin confirmación tipada.
- No ejecutar si el ambiente no está resuelto o el repo no está mapeado.
- Registrar usuario de Windows, host, base, script, checksum, hora y resultado.
- Si el checksum del script cambió entre la vista previa y la ejecución, pedir confirmación.
- No reintentar automáticamente un script fallido; el usuario decide.
- No ejecutar scripts de un bundle que no se empujó correctamente.

### 12.6 DPAPI

```rust
pub struct DpapiSecretStore;

impl SecretStore for DpapiSecretStore {
    fn protect(&self, plaintext: &[u8]) -> Result<Vec<u8>, SecretError> {
        // CryptProtectData con CRYPTPROTECT_UI_FORBIDDEN
        // entropía adicional fija de la app
    }
    fn unprotect(&self, ciphertext: &[u8]) -> Result<Vec<u8>, SecretError> {
        // CryptUnprotectData
    }
}
```

- El cifrado está ligado al usuario de Windows (y normalmente a la máquina).
- Si se copia la BD a otra máquina/usuario, los secretos no se pueden descifrar; se muestra "reconfigurar".
- No se incluye la clave en la BD ni en el código.
- Los secretos se guardan como BLOB; base64 solo si se exporta (no se exporta en v1).
- Logs y errores redactan cualquier valor que parezca password/token.

---

## 13. Seguridad, permisos y guardrails

### 13.1 Reglas duras (no negociables)

1. **Nunca** push/merge a `dev`, `qas`, `uat`, `prd` ni `release/*`.
2. **Nunca** `git push --force` sin `--force-with-lease`; y solo a ramas propias.
3. **Nunca** `reset --hard`, `clean -fd`, `branch -D` fuera de un worktree de FlowManager.
4. **Nunca** reescribir ramas de desarrollo o de ambiente.
5. **Nunca** ejecutar scripts BD sin confirmación explícita.
6. **Nunca** loggear passwords, tokens, cadenas de conexión completas ni contenido de secretos.
7. **Nunca** devolver secretos al frontend (solo `hasPassword`/`configured`).
8. **Nunca** ejecutar comandos Git concatenados en shell; siempre args separados.
9. **Nunca** borrar datos locales del usuario en una reimportación.
10. **Nunca** continuar un conflicto con archivos unmerged.

### 13.2 Defensa en profundidad

| Riesgo | Mitigación |
|---|---|
| Push accidental a ambiente | Validación por lista de ramas configuradas + patrón `release/*` + test automatizado que verifica que el SHA del ambiente no cambia. |
| Fuerza sobre rama ajena | `--force-with-lease` + ownership por `last_pushed_sha` + nombre nuevo si no es nuestra. |
| Pérdida de trabajo local | Worktrees aislados; nunca checkout/reset en la copia principal. |
| Inyección de comandos | `Command::arg`, validación `check-ref-format`, no `sh -c`. |
| Path traversal | Canonicalizar rutas; validar que archivos estén dentro del worktree; worktrees bajo `LOCALAPPDATA`. |
| Credenciales expuestas | DPAPI, redacción, write-only, no incluir en errores. |
| Scripts destructivos | Confirmación, advertencias, transacción opcional, stop-on-error, PRD con confirmación tipada. |
| Doble ejecución | `version` optimista, locks por repo, checkpoints idempotentes. |
| App cerrada en conflicto | Estado persistido + worktree + reanudación. |
| Repo corrupto/bloqueado | Detectar `index.lock`, worktree inválido; no forzar; mensaje accionable. |
| OneDrive/locks | Worktrees en `LOCALAPPDATA`; advertencia si el repo está sincronizado. |
| Rate limit GitHub | Cache 5 min; token opcional; solo lectura. |
| Logs gigantes | Truncado por paso + archivo rotativo. |

### 13.3 Permisos Tauri

`capabilities/default.json` mínimo:

```json
{
  "identifier": "default",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "dialog:default",
    "opener:default",
    "core:window:allow-minimize",
    "core:window:allow-toggle-maximize",
    "core:window:allow-close",
    "core:window:allow-is-maximized",
    "core:app:allow-version"
  ]
}
```

- No se habilita `shell` genérico. Abrir VS Code se hace con un comando Rust que ejecuta el binario configurado con args validados.
- `opener` solo para URLs HTTPS de GitHub y rutas locales permitidas.
- No se expone `fs` al frontend.

---

## 14. Observabilidad y logs

### 14.1 Tres niveles

1. **Consola en vivo:** eventos `flow://log`, con fase, repo y nivel.
2. **`operation_logs` en SQLite:** auditoría consultable por batch/run.
3. **Archivo rotativo:** `%APPDATA%\com.leona.flowmanager\logs\flowmanager.YYYY-MM-DD.log`, retención configurable.

### 14.2 Campos

```rust
struct LogRecord {
    run_id: Option<RunId>,
    batch_id: Option<BatchId>,
    repository_id: Option<RepoId>,
    level: LogLevel,
    phase: String,          // fetch, analyze, squash, merge, push, db
    message: String,
    detail: Option<String>, // stderr, diff, etc.
    at: DateTime<Utc>,
}
```

- Cada run tiene un `run_id` y un `attempt`; los logs se correlacionan.
- Al iniciar un paso se emite `info` con parámetros redactados; al terminar, `info` con duración; al fallar, `error` con código y detalle.
- Nunca se loggea el contenido completo de un archivo de credenciales ni la password.
- Los comandos Git se loggean como `git <args>` con `***` en tokens.
- El frontend limita a 5.000 líneas en memoria; el resto se consulta paginado.
- Exportar logs: `.log` o `.jsonl` con `run_id`, sin secretos.

### 14.3 Tracing

- `tracing_subscriber` con `EnvFilter` (`flowmanager=info,git2=warn`).
- Spans: `run{run_id, batch_id, repo_id, env}`, `step{name}`.
- En desarrollo, `RUST_LOG=flowmanager=debug`.
- No se envía telemetría a Internet.

---

## 15. Testing

### 15.1 Unitarios (rápidos, sin Git real)

| Área | Casos |
|---|---|
| `TaskKey` | Formato válido/inválido, normalización, duplicados. |
| `BranchName` | `check-ref-format`, longitud, caracteres prohibidos, truncado con hash, plantillas. |
| `BranchResolver` | Alias exacto, `release/*` con 1.0.9 vs 1.0.10, empate por fecha, ambigüedad, modo manual, rama inexistente, `prd=main`. |
| `RunStateMachine` | Todas las transiciones válidas e inválidas; terminales; retry. |
| `SquashPlanner` | Todos los commits, subconjunto, merge commits excluidos, commits ajenos, sin cambios. |
| `MondayParser` | Encabezados desordenados, secciones múltiples, subitems, duplicados, filas inválidas, CSV con BOM/delimiter. |
| `ManualRequirement` | Key autogenerada, duplicado, campos editables, archivado, colisión con Monday, `manual_locked`. |
| `DeveloperMatcher` | Alias, acentos, sufijos de empresa, múltiples nombres. |
| `EnvStatusEvaluator` | Ancestro, PR mergeado, PR abierto, probable, desconocido, multi-repo. |
| `SqlScriptSplitter` | `GO` en SQL Server, `GO` dentro de string/comentario, scripts PG. |
| `SecretStore` | Round-trip DPAPI, ciphertext distinto, error en otra máquina (manual). |
| `ErrorMapper` | stderr de Git → códigos de API. |
| `BranchGuard` | Rechazo de push a cualquier rama de ambiente. |

### 15.2 Integración con Git real

Crear un harness con `tempfile`:

```
tmp/
  remote.git        (bare)
  repo/             (clone)
  worktrees/
```

Escenarios:

1. Repo vacío / sin commits → error claro.
2. `master` con 1 commit; rama `BPIM-183` con 3 commits → ahead=3.
3. Rama sin commits → `BlockedNoCommits`.
4. Squash de una rama → un commit con el árbol esperado.
5. Squash de dos ramas (bundle) → un commit, sin duplicados.
6. Cherry-pick de subconjunto → solo esos cambios.
7. Conflicto en squash → `Conflict`, archivos correctos, `git add` + continue → commit.
8. Conflicto en apply-to-env → continue → rama hija con un commit.
9. Abortar conflicto → worktree vuelve a `base_sha`, rama local eliminada, repo principal intacto.
10. Push a remoto bare → SHA verificado; `origin/qas` sin cambios.
11. `--force-with-lease` con SHA incorrecto → rechazo.
12. Intento de push a `qas` → `REFUSING_ENV_PUSH`.
13. Base drift → `BASE_DRIFT`.
14. Reanudación tras "crash" simulado (estado persistido + worktree) → no duplica commits.
15. Rama existente ajena → propuesta de sufijo.
16. Nombres con acentos/ñ, espacios, longitud > 100.
17. Repo en worktree (no principal) → funciona o error claro.
18. `core.autocrlf` y archivos binarios → no corromper.

Se pueden marcar como `#[ignore]` si requieren Git y correr en CI con Git instalado.

### 15.3 Integración BD (opcional en CI)

- Docker compose con SQL Server y PostgreSQL.
- Ejecutar scripts de prueba: tabla, insert, error, transacción, `GO`.
- Verificar orden, stop-on-error, output, rollback.
- DPAPI solo Windows; test unitario con round-trip en CI Windows.

### 15.4 Frontend

- Vitest + React Testing Library:
  - Filtros de la tabla (developer, ambiente, "mis requerimientos").
  - Wizard: selección de ambiente, agrupación por repo, bloqueo por preflight.
  - Modal de conflicto: botón continuar deshabilitado con unmerged.
  - Panel de scripts: alerta sin conexión.
  - Formateo de estados/ chips.
- Opcional: Playwright contra el frontend web (mock de `invoke`) para flujos visuales.
- No es obligatorio E2E de Tauri en v1; sí un checklist manual.

### 15.5 Criterios de aceptación (MVP)

1. Importar el XLSX entregado y ver ~70+ requerimientos con subitems correctos.
2. Reimportar el mismo archivo → `unchanged`, sin duplicados ni pérdida de notas.
3. Editar un `Status` en el archivo y reimportar → solo ese campo cambia.
4. Registrar un repo, detectar `qas` como `release/1.0.5` y permitir override a `qas`.
5. Crear `BPIM-183` desde `origin/master` y verla en GitHub.
6. Analizar una rama sin commits → alerta y bloqueo.
7. Analizar una rama con 3 commits → lista correcta y ahead/behind.
8. Squash de 2 requerimientos en un repo → rama `BPIM-183-BPIM-184` y un commit.
9. Desplegar a `qas` → rama `BPIM-183-qas` desde `origin/release/1.0.5`, un commit, push exitoso.
10. Verificar que `origin/release/1.0.5` **no cambió**.
11. Provocar conflicto → pausa, VS Code, `git add`, continuar, push.
12. Cerrar la app en conflicto → reabrir → reanudar sin duplicar.
13. Script sin conexión → alerta y opción omitir; con conexión → ejecución ordenada.
14. Mergear el PR en GitHub → refrescar → `QAS` visible con evidencia.
15. Intentar desplegar a un ambiente sin rama resuelta → bloqueo solo en ese repo.
16. Cambiar la rama de ambiente entre preview y start → `BASE_DRIFT`.
17. Crear un requerimiento manual `MAN-0001` sin repo, editarlo, mapearlo y desplegarlo.
18. Crear un manual `BPIM-999`; importar un archivo que lo contiene → aparece en `manual_conflicts`; "Mantener manual" no lo cambia; "Vincular y actualizar" lo adopta y conserva notas/mapeos.
19. Intentar crear un manual con una key existente → `DUPLICATE_KEY` y enlace al existente.
20. Archivar un manual con historial → desaparece de la lista activa, pero el historial de lotes sigue visible.

---

## 16. Roadmap de implementación

El orden está pensado para validar primero el motor Git y luego la UI rica. **Cada fase termina con tests, una demo corta y tu validación explícita; no se avanza a la siguiente sin ese OK.**

### 16.1 Validación por fase

| Fase | Demo que validarás | Criterio de OK |
|---|---|---|
| 0 | La app abre, crea la BD y muestra versión de Git. | Arranca sin errores y la BD queda en `%APPDATA%`. |
| 1 | Registras un repo y ves la matriz de ambientes. | Detecta `qas → release/1.0.5`, muestra evidencia y permite override. |
| 2 | Importas tu Excel real y creas un requerimiento manual. | Filtras por tu usuario, ves subitems, creas `MAN-0001`, editas y mapeas. |
| 3 | Creas una rama y analizas commits. | `BPIM-183` nace de `origin/master`; una rama sin commits bloquea. |
| 4 | Squash de una y varias ramas, con conflicto. | Un solo commit; conflicto pausa, VS Code + `git add` + continuar. |
| 5 | Despliegue a `qas` y push de la rama hija. | `BPIM-183-qas` empujada; `origin/release/1.0.5` intacta. |
| 6 | Scripts BD con y sin conexión. | Sin conexión alerta y permite omitir; con conexión ejecuta en orden. |
| 7 | Merge en GitHub y refresco de estado. | La lista muestra `QAS 3/3` con evidencia. |
| 8 | Instalador y checklist completo. | Se instala y pasan los 20 criterios de aceptación. |

Al final de cada fase: demo, tests verdes, documento actualizado y tu confirmación. Si algo no te cuadra, se ajusta antes de seguir.

### Fase 0 — Scaffold y cimientos (2-3 días)

- `npm create tauri-app` (React + TS + Vite) con identificador `com.leona.flowmanager`.
- Estructura de carpetas, `Cargo.toml`, `tauri.conf.json`, capabilities.
- SQLite + migraciones + `AppState`.
- `tracing`, rutas de app data, manejo de errores tipado.
- CI de build (Windows) y lint/test.
- **Salida:** app vacía que abre, crea la BD y muestra versión de Git.

### Fase 1 — Repositorios y ambientes (3-4 días)

- Alta/validación/clonado de repos.
- Fetch, lista de ramas, rama base.
- Detección de ambientes + override manual + persistencia + UI de matriz.
- Tests de `BranchResolver`.
- **Salida:** se configura un repo y se ve `qas → release/1.0.5` con evidencia.

### Fase 2 — Ingesta, registro manual y listado (5-6 días)

- Parser CSV/XLSX, preview, upsert transaccional, subitems.
- **CRUD de requerimientos manuales**: alta, edición, archivado, key autogenerada, colisión con Monday.
- Tabla de requerimientos, filtros (incluido origen y "mis requerimientos"), detalle.
- Escaneo de ramas y mapeo automático/manual.
- **Salida:** importar el Excel real, crear/editar un manual, filtrar por developer y abrir detalle.

### Fase 3 — Ramas y análisis (4-5 días)

- Crear ramas desde `origin/base`, push opcional.
- `git2` reader: commits, ahead/behind, diff stat, merge-base.
- UI de análisis y alertas.
- **Salida:** botón "Analizar" con commits reales y bloqueo sin commits.

### Fase 4 — Squash y conflictos (5-6 días)

- Worktrees, runner CLI, estrategias MergeSquash/CherryPick.
- Checkpoints, `RunStateMachine`, logs/eventos.
- Modal de conflicto, abrir VS Code, stage, continue/abort.
- Tests de integración Git.
- **Salida:** squash de una y varias ramas, con conflicto resuelto y abortado.

### Fase 5 — Rama de despliegue y push (4-5 días)

- Resolver target, base drift, rama hija desde `origin/env`.
- Apply squash, push own branch, verify SHA, guard de ambiente.
- Enlaces GitHub, estado PR.
- **Salida:** `BPIM-183-qas` empujada sin tocar `release/1.0.5`.

### Fase 6 — Scripts BD y conexiones (4-5 días)

- DPAPI, CRUD de conexiones, test.
- CRUD/orden de scripts, editor SQL.
- Ejecutores SQL Server/PostgreSQL, confirmación, salida en vivo, ejecuciones.
- **Salida:** script ejecutado en dev/qas; sin conexión bloquea con alerta.

### Fase 7 — Estado por ambiente e historial (2-3 días)

- Evaluador de presencia (Git + PR + historial).
- Matriz por repo, chips multi-repo, refresh.
- Pantalla de lotes, reanudación, reintentos.
- **Salida:** merge en GitHub reflejado como `QAS 3/3`.

### Fase 8 — Endurecimiento y entrega (3-4 días)

- Tests E2E manuales, manejo de errores, accesibilidad, rendimiento con 10k requerimientos.
- Empaquetado NSIS/MSI, iconos, workflow de release.
- Documentación de usuario y troubleshooting.
- **Salida:** instalador y checklist de aceptación completo.

**Total orientativo:** 32-41 días de desarrollo de una persona, sin contar imprevistos de infraestructura/credenciales. Se puede solapar Fase 2 con Fase 1 si hay dos personas.

### Fase 9 — Futuro

- Monday API / Jira API.
- Crear PR desde la app (no merge).
- Resolver conflictos 3-way embebido.
- Rollback asistido, tags de respaldo.
- Notificaciones Teams/Slack.
- Multi-repo paralelo real, perfiles de equipo.

---

## 17. Reutilización concreta de `tarugit`

Ruta base: `C:\Users\leona\OneDrive\Documentos\personal\tarugit`.

### 17.1 Backend

| Archivo | Qué reutilizar | Cómo adaptarlo |
|---|---|---|
| `src-tauri/src/commands/git_ops.rs` | `create_git_command()` (CREATE_NO_WINDOW, `GIT_TERMINAL_PROMPT=0`), `get_repo_state`, `get_conflicted_files`, `get_conflict_stages`, `resolve_conflict`, `fetch_remote_branches`, `push_branch`, `compare_branches`, `list_branches`, `create_branch`, `get_commit_history_with_timestamp` | Extraer a `infrastructure/git/*`; reemplazar `Result<_, String>` por errores tipados; agregar worktrees y `--force-with-lease`; nunca operar sobre la copia principal. |
| `src-tauri/src/commands/graph_ops.rs` | Recorrido de grafo/commits | Opcional para visualización de historial. |
| `src-tauri/src/commands/github_ops.rs` | `reqwest` + headers (`Authorization`, `Accept`, `User-Agent`), parseo de owner/repo, consulta de PRs | Mantener solo lectura; token desde `SecretStore` (DPAPI), no desde el frontend; agregar cache. |
| `src-tauri/src/watcher.rs` | Debounce + `emit("repo-changed")` | Opcional; FlowManager puede refrescar manualmente. No vigilar worktrees temporalmente. |
| `src-tauri/src/lib.rs` | Registro de comandos, plugins, logger | Cambiar a `tracing`, `AppState` con pool y coordinador; registrar solo comandos nuevos. |
| `Cargo.toml` | `git2 = 0.18.3`, `reqwest`, `serde`, Tauri 2, plugins | Agregar `sqlx`, `tracing`, `calamine`, `tiberius`, `windows`. |

### 17.2 Frontend

| Archivo | Qué reutilizar | Notas |
|---|---|---|
| `src/App.css` | Variables de color, tipografía, layout oscuro | Base visual; crear `tokens.css`. |
| `src/components/ui/Modal.tsx` | Modal accesible | Extender tamaños. |
| `src/components/Toast.tsx` | Notificaciones | Reutilizar tal cual. |
| `src/components/ui/BranchCombo.tsx` | Selector de ramas con búsqueda | Útil en wizard y config. |
| `src/components/DiffViewer.tsx` | Render de diffs | Para preview y detalle de commit. |
| `src/components/history/FileDiffViewer.tsx` | Diff por archivo | Reutilizar con DTOs propios. |
| `src/components/OperationStatusBar.tsx` | Barra de operación en curso | Adaptar a la máquina de estados y runs múltiples. |
| `src/components/ConflictResolver/*` | Parser de bloques, visor 3-way, hooks | Fase 2; en MVP basta VS Code + git add. |
| `src/components/history/SquashForm.tsx` | Editor de mensaje y lista de commits | No reutilizar la lógica de `reset --soft HEAD~N`. |
| `src/hooks/useRepository.ts` | Patrón `invoke` + `listen` + refresh | Adaptar a eventos `flow://*`. |
| `src/components/RepoManager.tsx` | Persistencia de repos, selector | Cambiar `localStorage` por SQLite. |

### 17.3 Qué no copiar

- `squash_commits` de tarugit: hace `reset --soft HEAD~N` sobre la rama actual; reescribe historia. FlowManager solo colapsa ramas internas.
- `push_branch` con `-f` sin lease.
- `clone_repository`/operaciones que asumen que el repo está limpio.
- Errores como `String` y mensajes en español hardcodeados en el backend (usar códigos + i18n en UI).
- Token de GitHub pasado desde React y guardado en `localStorage`.
- `get_repo_status` como única fuente de estado; FlowManager tiene runs y estados propios.

---

## 18. Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Detección errónea de `qas` (release equivocado) | Se prepara un PR contra la rama incorrecta | Mostrar candidatas + evidencia + override manual + `BaseDrift`; nunca merge automático. |
| GitHub "Squash and merge" rompe ancestría | Estado `QAS` falso negativo | API de PRs + `git cherry` + historial + marcado manual; UI muestra confianza. |
| Rama hija ya existe y no es nuestra | Pisar trabajo ajeno | Ownership por `last_pushed_sha`; si no, sufijo; nunca force sin lease. |
| Conflicto resuelto mal | Código incorrecto en el PR | Worktree aislado, diff visible, revisión humana, PR en GitHub. |
| Script BD destructivo | Pérdida de datos | Confirmación, advertencias, transacción, stop-on-error, PRD tipado, logs. |
| Credenciales en logs | Incidente de seguridad | DPAPI + redacción + tests de no-fuga. |
| Repo en OneDrive | Locks, lentitud, corrupción | Worktrees en `LOCALAPPDATA`; advertencia; recomendación de mover repos. |
| Git hooks fallan | Push/commit bloqueado | Respetar hooks por defecto; mostrar salida; opción avanzada de bypass (off). |
| LFS no instalado | Push rechazado | Detectar y mostrar error accionable. |
| Ramas con nombres largos | `check-ref-format` falla | Truncado + hash + edición manual. |
| App cerrada a mitad | Estado inconsistente | Checkpoints + reconciliación + worktree persistido. |
| Muchos requerimientos | UI lenta | Virtualización + paginación + índices + queries agregadas. |
| SQL Server driver con TLS | Fallo de conexión | Probar conexión, `trust_server_certificate` configurable, integration tests. |
| Rate limit GitHub | Estado desactualizado | Cache, refresh manual, token opcional. |
| Cambios de Monday (columnas) | Import roto | Mapeo por nombre + perfil de columnas + errores por fila sin abortar todo. |
| Doble instancia de la app | Runs duplicados | `tauri-plugin-single-instance` + locks por repo. |

---

## 19. Decisiones abiertas / a confirmar durante implementación

No bloquean el diseño; se proponen defaults.

1. **Ejemplos reales de ramas** de cada repo (para afinar alias/patrones). Default: `dev`, `qas`, `uat`, `prd`, `release/*`.
2. **Convención de mensaje de commit** de la empresa. Default propuesto: `{keys}: {titles}` + trailers.
3. **Push de la rama de requerimiento al crearla**: default sí. Si el equipo prefiere solo local, se configura.
4. **Token GitHub**: ¿se usará para leer PRs? Default: opcional; sin token se usan Git + historial.
5. **Scripts BD**: ¿se guardan también versionados en el repo? Default: en la app + opción de archivo; no se commitean automáticamente.
6. **SQL Server**: ¿autenticación SQL o Windows Integrated? Default v1: SQL auth. Integrated queda futuro.
7. **PRD**: ¿se exige aprobación adicional además de la confirmación tipada? Default: confirmación tipada + registro; sin flujo de aprobación.
8. **"Local"**: se interpreta como rama de requerimiento con commits y sin presencia en dev. Confirmar si "local" debe ser un ambiente configurable con rama propia (no recomendado).
9. **Unificación**: ¿la rama `BPIM-183-BPIM-184` debe existir como rama de desarrollo persistente o solo como rama de despliegue? Default: solo despliegue; las ramas individuales siguen siendo la fuente.
10. **Repositorios**: ¿todos usan `origin`? Default: sí, configurable por repo.
11. **Key manual**: prefijo para autogenerar. Default: `MAN-0001`, `MAN-0002`, configurable (`manual_key_prefix`).
12. **Colisión manual/Monday**: default no sobrescribir; el usuario decide "vincular", "mantener manual" o "bloquear".
13. **Archivado manual**: soft delete con `is_active = 0`; no borra historial. Confirmar si se necesita borrado definitivo (no recomendado).

---

## 20. Apéndice A — Ejemplos de payloads

### 20.1 Preview de despliegue

```json
{
  "previewToken": "sha256:...",
  "environment": "qas",
  "items": [
    {
      "bundleId": "bnd_01",
      "repositoryId": "repo_01",
      "requirementIds": ["req_183", "req_184"],
      "sourceBranches": [
        { "branch": "BPIM-183", "commits": ["abc123", "def456"] },
        { "branch": "BPIM-184", "commits": ["789abc"] }
      ],
      "targetBranch": "release/1.0.5",
      "targetBaseSha": "1111111",
      "deployBranch": "BPIM-183-BPIM-184-qas",
      "squashMessage": "BPIM-183, BPIM-184: ...",
      "strategy": "all_commits"
    }
  ],
  "blockers": [],
  "warnings": [
    "La rama BPIM-183 está 5 commits detrás de master."
  ],
  "scripts": [
    { "id": "scr_1", "name": "create_table.sql", "engine": "sqlserver", "requirementId": "req_183", "hasConnection": true }
  ]
}
```

### 20.2 Run snapshot

```json
{
  "runId": "run_01",
  "batchId": "bat_01",
  "repositoryId": "repo_01",
  "state": "conflict",
  "substate": "merging_branches",
  "version": 7,
  "attempt": 1,
  "progress": 45,
  "deployBranch": "BPIM-183-BPIM-184-qas",
  "targetBranch": "release/1.0.5",
  "worktree": "C:\\Users\\leona\\AppData\\Local\\FlowManager\\worktrees\\run_01\\bplanner",
  "conflictFiles": ["src/Foo.java", "db/schema.sql"],
  "error": null,
  "updatedAt": "2026-10-31T14:05:00Z"
}
```

### 20.3 Error

```json
{
  "code": "BASE_DRIFT",
  "message": "La rama release/1.0.5 cambió desde la vista previa. Recalcula el despliegue.",
  "details": "expected=1111111 actual=2222222",
  "retryable": true,
  "context": { "repositoryId": "repo_01", "targetBranch": "release/1.0.5" }
}
```

---

## 21. Apéndice B — Checklist de implementación

### Backend

- [ ] Scaffold Tauri 2 + React + TS + Vite.
- [ ] SQLite + migraciones + PRAGMAs + backup.
- [ ] `AppState`, `RunCoordinator`, locks por repo.
- [ ] Errores tipados + `ApiError`.
- [ ] `GitCliRunner` seguro (timeouts, no shell, redacción).
- [ ] `GitReader` con git2 (commits, ahead/behind, ancestry).
- [ ] `WorktreeManager`.
- [ ] `BranchResolver` (auto/manual, semver, evidencia).
- [ ] `RequirementSource` CSV/XLSX + parser de subitems.
- [ ] Upsert transaccional + preview + conflictos manuales.
- [ ] CRUD de requerimientos manuales (alta, edición, archivado, key autogenerada).
- [ ] `CreateBranches`.
- [ ] `AnalyzeRequirement`.
- [ ] `MergeSquash` + `CherryPick` + `NoChanges`.
- [ ] `DeployBranch` + `BaseDrift`.
- [ ] `PushOwnBranch` + guard de ambiente + lease.
- [ ] Máquina de estados + checkpoints + reanudación.
- [ ] Logs + eventos.
- [ ] GitHub PR read-only + links.
- [ ] DPAPI + conexiones + scripts + ejecutores.
- [ ] Estado por ambiente + agregación.
- [ ] Tests unitarios/integración.

### Frontend

- [ ] Layout + navegación + tema.
- [ ] Tabla de requerimientos + filtros + "mis requerimientos" + filtro por origen.
- [ ] Detalle con pestañas.
- [ ] Import wizard + preview.
- [ ] Formulario "Nuevo requerimiento" + edición/archivado manual.
- [ ] Config de repos + matriz de ambientes.
- [ ] Wizard de despliegue (5 pasos).
- [ ] Consola en vivo + filtros.
- [ ] Modal de conflicto + VS Code + stage/continue/abort.
- [ ] Panel de scripts + conexiones + test.
- [ ] Historial de lotes + reanudar.
- [ ] Settings.
- [ ] Manejo de errores/empty/loading.
- [ ] Tests de componentes críticos.

### Entrega

- [ ] Instalador NSIS/MSI + iconos.
- [ ] README de usuario + troubleshooting.
- [ ] Checklist de aceptación (sección 15.5) ejecutado.
- [ ] Verificación explícita: `origin/<ambiente>` no cambió tras un despliegue.
- [ ] Verificación explícita: no hay secretos en logs/BD en claro.

---

## 22. Apéndice C — Instrucciones para el siguiente modelo/agente

Si este documento se entrega a otro modelo, debe leer en este orden:

1. **Sección 0** (decisiones cerradas y corrección al push a ambientes).
2. **Sección 4** (reglas de ramas, ambientes, unificación, conflictos, push).
3. **Sección 5** (modelo de datos).
4. **Sección 6** (arquitectura y estructura).
5. **Sección 8** (máquina de estados).
6. **Sección 15** (tests y aceptación).
7. **Sección 16** (orden de implementación).

Reglas para no desviarse:

- No implementar push/merge a `dev/qas/uat/prd`.
- No usar `git push --force` sin lease.
- No operar sobre la copia de trabajo del usuario; usar worktrees.
- No reescribir ramas de requerimiento.
- No guardar secretos en claro.
- No ejecutar scripts BD sin confirmación.
- Permitir registro manual con `source = manual`; no sobrescribir un manual con Monday sin confirmación.
- No cambiar las decisiones D1-D15 sin un ADR y confirmación del usuario.

Prompt corto sugerido:

> Implementa FlowManager siguiendo `FlowManager-Diseno-Tecnico.md`. Respeta las decisiones cerradas: Tauri 2 + React 19 + Rust, git2 para lectura y git CLI para escritura, worktrees aislados, push solo de ramas propias con force-with-lease, nunca push/merge a ambientes, SQLite con sqlx, DPAPI para secretos, máquina de estados persistida. Empieza por la Fase 0 y entrega tests. No avances de fase sin cumplir los criterios de aceptación.

---

## 23. Cierre

Este diseño convierte el requerimiento original en un flujo seguro y auditable:

- **Ingesta** idempotente desde Monday (CSV/XLSX).
- **Visibilidad** de requerimientos por developer y por ambiente.
- **Ramas** creadas de forma consistente desde la base configurada.
- **Squash** sin reescribir historia, con selección de commits.
- **Conflictos** pausables y resolubles en VS Code.
- **Despliegue** mediante una rama hija propia, nunca tocando el ambiente.
- **Push** seguro con lease y guardrails.
- **Scripts BD** ordenados, con conexiones cifradas y confirmación.
- **Estado** verificado con Git + GitHub + historial.
- **Recuperación** ante cierres y fallos.

La app queda preparada para crecer a Jira, PRs automáticos, resolución 3-way embebida y ejecución multi-repo paralela sin rehacer el núcleo.

---

**Fin del documento.**








