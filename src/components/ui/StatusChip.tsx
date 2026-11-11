import type { Tone } from '../../types';

interface StatusChipProps {
  tone: Tone;
  children: React.ReactNode;
  dot?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function StatusChip({ tone, children, dot = false, className, style }: StatusChipProps) {
  return (
    <span className={`chip chip-${tone} ${className ?? ''}`.trim()} style={style}>
      {dot ? <span className="chip-dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
