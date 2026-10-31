# FlowManager

Aplicación de escritorio (Tauri 2 + React + Rust + SQLite) para orquestar
requerimientos, ramas, despliegues y scripts de base de datos entre varios
repositorios Git.

> Estado actual: **Fase 1 — Repositorios y ambientes**. La app abre maximizada,
> crea su base local, detecta Git, permite registrar o clonar repositorios y
> resuelve la rama de DEV, QAS, UAT y PRD con evidencia y override manual.
> Las fases 2–8 se implementan y validan por separado.

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
