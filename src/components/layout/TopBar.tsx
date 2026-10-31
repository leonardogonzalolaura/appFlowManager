import { Icon } from '../ui/Icon';
import { Spinner } from '../ui/Spinner';
import { StatusChip } from '../ui/StatusChip';

interface TopBarProps {
  title: string;
  subtitle: string;
  ready: boolean;
  loading: boolean;
  refreshing: boolean;
  demo: boolean;
  onRefresh: () => void;
}

export function TopBar({
  title,
  subtitle,
  ready,
  loading,
  refreshing,
  demo,
  onRefresh,
}: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar-heading">
        <p className="topbar-eyebrow">FlowManager</p>
        <div className="topbar-title-row">
          <h1 className="topbar-title">{title}</h1>
          {demo ? <StatusChip tone="info">Vista previa web</StatusChip> : null}
        </div>
        <p className="topbar-subtitle">{subtitle}</p>
      </div>

      <div className="topbar-actions">
        <StatusChip tone={loading ? 'neutral' : ready ? 'success' : 'warning'} dot>
          {loading ? 'Verificando' : ready ? 'Sistema listo' : 'Requiere atención'}
        </StatusChip>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onRefresh}
          disabled={refreshing}
        >
          {refreshing ? (
            <Spinner size="sm" />
          ) : (
            <Icon name="refresh" size={14} />
          )}
          {refreshing ? 'Actualizando…' : 'Actualizar'}
        </button>
      </div>
    </header>
  );
}
