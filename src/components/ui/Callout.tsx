import type { Tone } from '../../types';
import { Icon, type IconName } from './Icon';

interface CalloutProps {
  tone?: Tone;
  title: string;
  icon?: IconName;
  children?: React.ReactNode;
  action?: React.ReactNode;
}

export function Callout({
  tone = 'info',
  title,
  icon,
  children,
  action,
}: CalloutProps) {
  const iconName: IconName =
    icon ?? (tone === 'danger' || tone === 'warning' ? 'alert' : 'info');

  return (
    <div className={`callout callout-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <span className="callout-icon">
        <Icon name={iconName} size={17} />
      </span>
      <div className="callout-content">
        <p className="callout-title">{title}</p>
        {children ? <div className="callout-text">{children}</div> : null}
      </div>
      {action ? <div className="callout-action">{action}</div> : null}
    </div>
  );
}
