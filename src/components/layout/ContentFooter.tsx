import type { SystemInfo } from '../../types';

interface ContentFooterProps {
  info: SystemInfo | null;
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
      </div>
    </footer>
  );
}
