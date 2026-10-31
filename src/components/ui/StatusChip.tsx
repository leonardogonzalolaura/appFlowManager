import type { Tone } from '../../types';

interface StatusChipProps {
  tone: Tone;
  children: React.ReactNode;
  dot?: boolean;
  className?: string;
}

export function StatusChip({ tone, children, dot = false, className }: StatusChipProps) {
  return (
    <span className={`chip chip-${tone} ${className ?? ''}`.trim()}>
      {dot ? <span className="chip-dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
