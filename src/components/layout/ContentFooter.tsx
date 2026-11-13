import { openUrl } from '@tauri-apps/plugin-opener';
import type { SystemInfo } from '../../types';
import { isTauri, normalizeError } from '../../lib/api';
import { Icon } from '../ui/Icon';
import { toast } from '../ui/Toast';

interface ContentFooterProps {
  info: SystemInfo | null;
}

const APPS_URL = 'https://www.atechlo-app.site/';

async function openAppsSite() {
  try {
    if (isTauri()) {
      await openUrl(APPS_URL);
    } else {
      window.open(APPS_URL, '_blank', 'noopener,noreferrer');
    }
  } catch (caught) {
    toast.error('No se pudo abrir el enlace', {
      description: normalizeError(caught).message,
    });
  }
}

export function ContentFooter({ info }: ContentFooterProps) {
  return (
    <footer className="content-footer">
      <div className="content-footer-inner">
        <span>FlowManager v{info?.appVersion ?? '0.1.0'}</span>
        {info ? (
          <>
            <span className="content-footer-sep">·</span>
            <span>
              {info.os} {info.arch}
            </span>
          </>
        ) : null}
        <span className="content-footer-sep">·</span>
        <a
          className="content-footer-link"
          href={APPS_URL}
          target="_blank"
          rel="noreferrer"
          title="Otras apps útiles e información de Atechlo"
          onClick={(event) => {
            event.preventDefault();
            void openAppsSite();
          }}
        >
          Más apps en atechlo-app.site
          <Icon name="external" size={11} />
        </a>
        <span className="content-footer-sep">·</span>
        <span>© {new Date().getFullYear()} Atechlo</span>
      </div>
    </footer>
  );
}
