import { Icon, type IconName } from '../ui/Icon';
import type { ViewId } from '../../types';

interface SidebarProps {
  view: ViewId;
  onNavigate: (view: ViewId) => void;
  onLocked: (label: string, phase: string) => void;
  onOpenGuide: () => void;
  ready: boolean;
  loading: boolean;
  collapsed: boolean;
  onToggle: () => void;
}

interface NavItem {
  id: ViewId | 'requerimientos' | 'lotes' | 'repositorios' | 'bases';
  label: string;
  icon: IconName;
  phase?: string;
  available?: boolean;
}

const workspace: NavItem[] = [
  { id: 'inicio', label: 'Inicio', icon: 'home', available: true },
  { id: 'requerimientos', label: 'Requerimientos', icon: 'list', available: true },
  { id: 'lotes', label: 'Lotes', icon: 'package', available: true },
  { id: 'repositorios', label: 'Repositorios', icon: 'branch', available: true },
];

const system: NavItem[] = [
  { id: 'bases', label: 'Bases de datos', icon: 'database', available: true },
  { id: 'configuracion', label: 'Configuración', icon: 'settings', available: true },
];

export function Sidebar({
  view,
  onNavigate,
  onLocked,
  onOpenGuide,
  ready,
  loading,
  collapsed,
  onToggle,
}: SidebarProps) {
  function renderItem(item: NavItem) {
    const active = item.id === view;
    const available = item.available === true;

    return (
      <button
        key={item.id}
        type="button"
        title={collapsed ? item.label : undefined}
        className={`nav-item ${active ? 'is-active' : ''} ${available ? '' : 'is-locked'}`.trim()}
        aria-current={active ? 'page' : undefined}
        aria-disabled={!available}
        onClick={() => {
          if (available) {
            onNavigate(item.id as ViewId);
          } else {
            onLocked(item.label, item.phase ?? 'una próxima fase');
          }
        }}
      >
        <span className="nav-icon">
          <Icon name={item.icon} size={16} />
        </span>
        <span className="nav-label">{item.label}</span>
        {!available && item.phase ? <span className="nav-phase">{item.phase.replace('Fase ', 'F')}</span> : null}
      </button>
    );
  }

  return (
    <aside className={`sidebar ${collapsed ? 'is-collapsed' : ''}`.trim()}>
      <button
        type="button"
        className="sidebar-collapse"
        onClick={onToggle}
        title={collapsed ? 'Expandir menú' : 'Colapsar menú'}
        aria-label={collapsed ? 'Expandir menú' : 'Colapsar menú'}
        aria-expanded={!collapsed}
      >
        <Icon name="chevron-right" size={14} />
      </button>
      <div className="sidebar-section">
        <p className="sidebar-heading">Espacio de trabajo</p>
        <nav className="nav-list" aria-label="Espacio de trabajo">
          {workspace.map(renderItem)}
        </nav>
      </div>

      <div className="sidebar-section">
        <p className="sidebar-heading">Sistema</p>
        <nav className="nav-list" aria-label="Sistema">
          {system.map(renderItem)}
        </nav>
      </div>

      <div className="sidebar-spacer" />

      <button type="button" className="sidebar-status" onClick={onOpenGuide}>
        <span className={`status-dot ${loading ? 'is-loading' : ready ? 'is-ok' : 'is-warn'}`} />
        <span className="sidebar-status-text">
          <strong>{loading ? 'Verificando…' : ready ? 'Sistema listo' : 'Requiere atención'}</strong>
          <span>{loading ? 'Revisando Git y la base local' : ready ? 'Git y base local disponibles' : 'Hay algo pendiente de configurar'}</span>
        </span>
        <Icon name="chevron-right" size={13} />
      </button>

      <button type="button" className="sidebar-guide" onClick={onOpenGuide}>
        <Icon name="book" size={14} />
        <span>Guía de configuración</span>
      </button>

      <div className="sidebar-footer">
        <span className="sidebar-footer-badge">MVP</span>
        <span>Fase 6 · Scripts BD</span>
      </div>
    </aside>
  );
}
