import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon, type IconName } from './Icon';
import './Tabs.css';

export type TabsTone = 'accent' | 'info' | 'warning' | 'danger';

export interface TabItem {
  id: string;
  label: string;
  icon?: IconName;
  /** Contador opcional que se muestra junto al label. */
  count?: number;
  /** Color del glider y del contador cuando la pestaña está activa. */
  tone?: TabsTone;
  /** Muestra un punto de estado a la derecha del label. */
  dot?: boolean;
  dotLabel?: string;
}

interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  /** Prefijo para `id` de tabs y paneles: `${idPrefix}-tab-*` / `${idPrefix}-panel-*`. */
  idPrefix: string;
  ariaLabel: string;
  className?: string;
}

interface GliderBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

const EMPTY_GLIDER: GliderBox = { left: 0, top: 0, width: 0, height: 0 };

export function Tabs({
  items,
  value,
  onChange,
  idPrefix,
  ariaLabel,
  className = '',
}: TabsProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const [glider, setGlider] = useState<GliderBox>(EMPTY_GLIDER);

  const activeIndex = Math.max(
    0,
    items.findIndex((item) => item.id === value),
  );
  const activeItem = items[activeIndex];

  const measure = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const active = track.querySelector<HTMLElement>('[data-active="true"]');
    if (!active) return;
    const next: GliderBox = {
      left: active.offsetLeft,
      top: active.offsetTop,
      width: active.offsetWidth,
      height: active.offsetHeight,
    };
    setGlider((previous) =>
      previous.left === next.left &&
      previous.top === next.top &&
      previous.width === next.width &&
      previous.height === next.height
        ? previous
        : next,
    );
  }, []);

  // Se re-mide tras cada render para cubrir cambios de ancho (contadores,
  // etiquetas o tipografías) sin provocar renders en bucle.
  useLayoutEffect(() => {
    measure();
  });

  useEffect(() => {
    const handleResize = () => measure();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [measure]);

  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const active = track.querySelector<HTMLElement>('[data-active="true"]');
    if (!active) return;
    const padding = 8;
    const start = active.offsetLeft - padding;
    const end = active.offsetLeft + active.offsetWidth + padding;
    if (start < track.scrollLeft) {
      track.scrollTo({ left: Math.max(0, start), behavior: 'smooth' });
    } else if (end > track.scrollLeft + track.clientWidth) {
      track.scrollTo({ left: end - track.clientWidth, behavior: 'smooth' });
    }
  }, [value]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    let nextIndex: number | null = null;
    switch (event.key) {
      case 'ArrowRight':
        nextIndex = (activeIndex + 1) % items.length;
        break;
      case 'ArrowLeft':
        nextIndex = (activeIndex - 1 + items.length) % items.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = items.length - 1;
        break;
      default:
        return;
    }

    const next = items[nextIndex];
    if (!next) return;
    event.preventDefault();
    onChange(next.id);
    buttonsRef.current[nextIndex]?.focus();
  }

  return (
    <div className={`tabs ${className}`.trim()}>
      <div
        ref={trackRef}
        className="tabs-track"
        role="tablist"
        aria-label={ariaLabel}
        data-tone={activeItem?.tone ?? 'accent'}
        onKeyDown={handleKeyDown}
      >
        <span
          className="tabs-glider"
          aria-hidden="true"
          style={{
            width: glider.width,
            height: glider.height,
            transform: `translate3d(${glider.left}px, ${glider.top}px, 0)`,
            opacity: glider.width > 0 ? 1 : 0,
          }}
        />
        {items.map((item, index) => {
          const active = item.id === value;
          return (
            <button
              key={item.id}
              ref={(node) => {
                buttonsRef.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`${idPrefix}-tab-${item.id}`}
              aria-selected={active}
              aria-controls={`${idPrefix}-panel-${item.id}`}
              tabIndex={active ? 0 : -1}
              data-active={active ? 'true' : undefined}
              data-tone={item.tone ?? 'accent'}
              className={`tabs-tab ${active ? 'is-active' : ''}`.trim()}
              onClick={() => onChange(item.id)}
            >
              {item.icon ? <Icon name={item.icon} size={13} /> : null}
              <span className="tabs-label">{item.label}</span>
              {typeof item.count === 'number' ? (
                <span className="tabs-count">{item.count}</span>
              ) : null}
              {item.dot ? (
                <span
                  className="tabs-dot"
                  title={item.dotLabel}
                  aria-hidden="true"
                />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
