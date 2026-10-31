interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  label?: string;
}

const sizeMap = { sm: 13, md: 17, lg: 22 } as const;

export function Spinner({ size = 'sm', label }: SpinnerProps) {
  const px = sizeMap[size];
  return (
    <span className="spinner-wrap">
      <span
        className="spinner"
        style={{ width: px, height: px }}
        role="status"
        aria-label={label ?? 'Cargando'}
      />
      {label ? <span className="spinner-label">{label}</span> : null}
    </span>
  );
}
