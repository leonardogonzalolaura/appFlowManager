import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../ui/Icon';

interface FeaturePickerModalProps {
  features: string[];
  currentFeature: string;
  onSelect: (feature: string) => void;
  onClose: () => void;
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function FeaturePickerModal({
  features,
  currentFeature,
  onSelect,
  onClose,
}: FeaturePickerModalProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const filtered = useMemo(() => {
    const term = normalizeText(query.trim());
    if (!term) return features;
    return features.filter((f) => normalizeText(f).includes(term));
  }, [features, query]);

  // "Todas" siempre está al tope cuando no hay búsqueda activa
  const visible = useMemo(() => {
    const matches = filtered.map((f) => ({ value: f, label: f }));
    return query.trim()
      ? matches
      : [{ value: '', label: 'Todas las features' }, ...matches];
  }, [filtered, query]);

  const safeActive = Math.min(activeIndex, Math.max(0, visible.length - 1));

  // Foco automático al abrir
  useEffect(() => {
    inputRef.current?.focus();

    // Posicionar en la feature actual
    const idx = visible.findIndex((o) => o.value === currentFeature);
    setActiveIndex(idx >= 0 ? idx : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scroll al ítem activo
  useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>(
      `[data-idx="${safeActive}"]`,
    );
    active?.scrollIntoView({ block: 'nearest' });
  }, [safeActive]);

  // Cerrar con clic fuera
  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const dialog = document.getElementById('feature-picker-dialog');
      if (dialog && !dialog.contains(event.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [onClose]);

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (visible.length === 0) return;
      setActiveIndex((safeActive + 1) % visible.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (visible.length === 0) return;
      setActiveIndex((safeActive - 1 + visible.length) % visible.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const option = visible[safeActive];
      if (option) {
        onSelect(option.value);
        onClose();
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  }

  return createPortal(
    <div className="feature-picker-backdrop" role="presentation">
      <div
        id="feature-picker-dialog"
        className="feature-picker-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Seleccionar feature"
      >
        <div className="feature-picker-header">
          <Icon name="layers" size={15} />
          <span className="feature-picker-title">Filtrar por feature</span>
          <span className="feature-picker-hint">
            <kbd>↑↓</kbd> navegar · <kbd>Enter</kbd> seleccionar · <kbd>Esc</kbd> cerrar
          </span>
          <button
            type="button"
            className="btn btn-icon btn-ghost btn-xs feature-picker-close"
            aria-label="Cerrar"
            onClick={onClose}
          >
            <Icon name="x" size={14} />
          </button>
        </div>

        <div className="feature-picker-search">
          <Icon name="search" size={14} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Buscar feature…"
            role="combobox"
            aria-label="Buscar feature"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={
              visible.length > 0 ? `${listId}-opt-${safeActive}` : undefined
            }
            autoComplete="off"
          />
          {query ? (
            <button
              type="button"
              className="feature-picker-search-clear"
              onClick={() => {
                setQuery('');
                setActiveIndex(0);
                inputRef.current?.focus();
              }}
              aria-label="Limpiar búsqueda"
            >
              <Icon name="x" size={11} />
            </button>
          ) : null}
        </div>

        <ul
          id={listId}
          ref={listRef}
          className="feature-picker-list"
          role="listbox"
          aria-label="Features disponibles"
        >
          {visible.length === 0 ? (
            <li className="feature-picker-empty" role="presentation">
              Sin resultados para "{query}"
            </li>
          ) : (
            visible.map((option, index) => {
              const isSelected = option.value === currentFeature;
              const isActive = index === safeActive;
              return (
                <li
                  key={option.value || '__all__'}
                  id={`${listId}-opt-${index}`}
                  data-idx={index}
                  role="option"
                  aria-selected={isSelected}
                  className={[
                    'feature-picker-option',
                    isActive ? 'is-active' : '',
                    isSelected ? 'is-selected' : '',
                    option.value === '' ? 'is-all' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onSelect(option.value);
                    onClose();
                  }}
                >
                  <span className="feature-picker-option-label">{option.label}</span>
                  {isSelected ? <Icon name="check" size={12} /> : null}
                </li>
              );
            })
          )}
        </ul>

        <div className="feature-picker-footer">
          {visible.length > 0 ? (
            <span>{visible.length === 1 && visible[0].value === '' ? features.length : visible.filter(o => o.value !== '').length} feature(s)</span>
          ) : (
            <span>0 features</span>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
