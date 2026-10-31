import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauri } from '../../lib/api';
import { Icon } from '../ui/Icon';

interface TitleBarProps {
  version: string;
}

export function TitleBar({ version }: TitleBarProps) {
  async function minimize() {
    if (!isTauri()) return;
    await getCurrentWindow().minimize();
  }

  async function toggleMaximize() {
    if (!isTauri()) return;
    await getCurrentWindow().toggleMaximize();
  }

  async function close() {
    if (!isTauri()) return;
    await getCurrentWindow().close();
  }

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar-brand" data-tauri-drag-region>
        <span className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none">
            <path
              d="M6.5 7.5h4.2a3 3 0 0 1 3 3v3a3 3 0 0 0 3 3h1"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
            <circle cx="5" cy="7.5" r="2" fill="currentColor" />
            <circle cx="19" cy="16.5" r="2" fill="currentColor" />
            <circle cx="12.5" cy="12" r="1.5" fill="currentColor" opacity=".55" />
          </svg>
        </span>
        <span className="titlebar-name">FlowManager</span>
        <span className="titlebar-version">v{version}</span>
      </div>

      <div className="titlebar-drag" data-tauri-drag-region />

      <div className="titlebar-controls">
        <button
          type="button"
          className="titlebar-btn"
          aria-label="Minimizar"
          onClick={() => void minimize()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2 5h6" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
        <button
          type="button"
          className="titlebar-btn"
          aria-label="Maximizar o restaurar"
          onClick={() => void toggleMaximize()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect
              x="2"
              y="2"
              width="6"
              height="6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
            />
          </svg>
        </button>
        <button
          type="button"
          className="titlebar-btn titlebar-close"
          aria-label="Cerrar"
          onClick={() => void close()}
        >
          <Icon name="x" size={11} />
        </button>
      </div>
    </header>
  );
}
