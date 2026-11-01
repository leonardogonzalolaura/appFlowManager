import { useEffect, useState } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ContentFooter } from './components/layout/ContentFooter';
import { Sidebar } from './components/layout/Sidebar';
import { TitleBar } from './components/layout/TitleBar';
import { TopBar } from './components/layout/TopBar';
import { GuideModal } from './components/onboarding/GuideModal';
import { PhaseModal } from './components/onboarding/PhaseModal';
import { Icon } from './components/ui/Icon';
import { Spinner } from './components/ui/Spinner';
import { toast, ToastViewport } from './components/ui/Toast';
import { useSystemInfo } from './hooks/useSystemInfo';
import { normalizeError, openAppDir } from './lib/api';
import { copyText } from './lib/format';
import type { ViewId } from './types';
import { HomeView } from './views/HomeView';
import { DatabaseView } from './views/DatabaseView';
import { LotesView } from './views/LotesView';
import { RepositoriesView } from './views/RepositoriesView';
import { RequirementsView } from './views/RequirementsView';
import { SettingsView } from './views/SettingsView';
import './App.css';

function App() {
  const { data: info, error, loading, refresh } = useSystemInfo();
  const [view, setView] = useState<ViewId>('inicio');
  const [showGuide, setShowGuide] = useState(false);
  const [phaseModal, setPhaseModal] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('flowmanager.sidebarCollapsed') === '1',
  );

  useEffect(() => {
    localStorage.setItem(
      'flowmanager.sidebarCollapsed',
      sidebarCollapsed ? '1' : '0',
    );
  }, [sidebarCollapsed]);

  const ready = Boolean(info?.git.available && info?.dbReady);

  async function handleRefresh() {
    setRefreshing(true);
    const ok = await refresh(true);
    setRefreshing(false);
    if (ok) {
      toast.success('Diagnóstico actualizado', {
        description: 'El estado actual está reflejado en pantalla.',
      });
    } else {
      toast.error('No se pudo actualizar el diagnóstico', {
        description: 'Revisa la configuración o los logs de la app.',
      });
    }
  }

  function handleLocked(label: string, phase: string) {
    toast.info(`${label} se habilita en la ${phase}`, {
      title: 'Todavía no está disponible',
      description:
        'Estamos avanzando por fases validadas. Mientras tanto, puedes revisar la guía de configuración.',
    });
  }

  async function handleCopy(value: string, label: string) {
    try {
      await copyText(value);
      toast.success('Ruta copiada', { description: label });
    } catch (caught) {
      const apiError = normalizeError(caught);
      toast.error('No se pudo copiar la ruta', { description: apiError.message });
    }
  }

  async function handleOpenDir(
    kind: 'data' | 'logs' | 'backups' | 'worktrees',
    label: string,
  ) {
    if (info?.demo) {
      toast.info('Esta acción requiere la app de escritorio', {
        description: `Abre la ${label} desde FlowManager instalado.`,
      });
      return;
    }
    try {
      await openAppDir(kind);
      toast.info('Abriendo carpeta', { description: label });
    } catch (caught) {
      const apiError = normalizeError(caught);
      toast.error('No se pudo abrir la carpeta', {
        description: apiError.message,
      });
    }
  }

  const title =
    view === 'inicio'
      ? 'Inicio'
      : view === 'requerimientos'
        ? 'Requerimientos'
        : view === 'lotes'
          ? 'Lotes'
          : view === 'repositorios'
            ? 'Repositorios'
            : view === 'bases'
              ? 'Bases de datos'
              : 'Configuración';
  const subtitle =
    view === 'inicio'
      ? 'Revisa el estado del sistema y sigue la configuración inicial.'
      : view === 'requerimientos'
        ? 'Importa Monday, registra requerimientos manuales y filtra lo que necesitas.'
        : view === 'lotes'
          ? 'Sigue el avance de cada despliegue, reanuda conflictos y empuja sus ramas.'
          : view === 'repositorios'
            ? 'Conecta tus repos y define la rama de cada ambiente.'
            : view === 'bases'
              ? 'Configura conexiones por ambiente y prueba el acceso a tus bases de datos.'
              : 'Diagnóstico, rutas y preferencias de FlowManager.';

  function handleNavigate(next: ViewId) {
    setView(next);
    if (next === 'inicio') {
      void refresh(true);
    }
  }

  return (
    <div className="app-shell">
      <TitleBar version={info?.appVersion ?? '0.1.0'} />

      <div className="app-body">
        <Sidebar
          view={view}
          onNavigate={handleNavigate}
          onLocked={handleLocked}
          onOpenGuide={() => setShowGuide(true)}
          ready={ready}
          loading={loading && !info}
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((value) => !value)}
        />

        <main className="main">
          <TopBar
            title={title}
            subtitle={subtitle}
            ready={ready}
            loading={loading && !info}
            refreshing={refreshing}
            demo={Boolean(info?.demo)}
            onRefresh={() => void handleRefresh()}
          />

          <div className="content">
            {view === 'inicio' ? (
              <HomeView
                info={info}
                error={error}
                loading={loading}
                refreshing={refreshing}
                onRefresh={() => void handleRefresh()}
                onOpenGuide={() => setShowGuide(true)}
                onOpenSettings={() => setView('configuracion')}
                onOpenRepositories={() => setView('repositorios')}
                onOpenRequirements={() => setView('requerimientos')}
                onOpenDatabase={() => setView('bases')}
                onOpenPhase={setPhaseModal}
                onCopy={(value, label) => void handleCopy(value, label)}
                onOpenDir={(kind, label) => void handleOpenDir(kind, label)}
              />
            ) : view === 'requerimientos' ? (
              <RequirementsView />
            ) : view === 'lotes' ? (
              <LotesView />
            ) : view === 'repositorios' ? (
              <RepositoriesView />
            ) : view === 'bases' ? (
              <DatabaseView />
            ) : info ? (
              <SettingsView
                info={info}
                refreshing={refreshing}
                onRefresh={() => void handleRefresh()}
                onCopy={(value, label) => void handleCopy(value, label)}
                onOpenDir={(kind, label) => void handleOpenDir(kind, label)}
              />
            ) : (
              <div className="surface loading-panel">
                {loading ? (
                  <Spinner size="lg" label="Leyendo la configuración…" />
                ) : (
                  <>
                    <span className="loading-error-icon">
                      <Icon name="alert" size={24} />
                    </span>
                    <p className="loading-hint">
                      {error?.message ?? 'No se pudo leer la configuración.'}
                    </p>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => void handleRefresh()}
                    >
                      <Icon name="refresh" size={14} />
                      Reintentar
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          <ContentFooter info={info} />
        </main>
      </div>

      <ToastViewport />

      {showGuide && info ? (
        <GuideModal
          info={info}
          onClose={() => setShowGuide(false)}
          onGoSettings={() => {
            setShowGuide(false);
            setView('configuracion');
          }}
        />
      ) : null}

      {phaseModal ? (
        <PhaseModal phase={phaseModal} onClose={() => setPhaseModal(null)} />
      ) : null}
    </div>
  );
}

export default function AppRoot() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
