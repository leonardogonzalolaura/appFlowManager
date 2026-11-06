import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { KeyboardEvent } from 'react';
import { Icon } from './Icon';
import './SearchableSelect.css';

interface SearchableSelectProps {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  allLabel: string;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
}

interface Option {
  value: string;
  label: string;
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function SearchableSelect({
  value,
  options,
  onChange,
  allLabel,
  ariaLabel,
  className,
  disabled = false,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const filtered = useMemo(() => {
    const term = normalizeText(query.trim());
    if (!term) return options;
    return options.filter((option) => normalizeText(option).includes(term));
  }, [options, query]);

  const visible = useMemo<Option[]>(() => {
    const matches = filtered.map((option) => ({
      value: option,
      label: option,
    }));
    return query.trim()
      ? matches
      : [{ value: '', label: allLabel }, ...matches];
  }, [filtered, query, allLabel]);

  const safeActive = Math.min(
    activeIndex,
    Math.max(0, visible.length - 1),
  );

  function closeMenu(restoreFocus = true) {
    setOpen(false);
    setQuery('');
    if (restoreFocus) triggerRef.current?.focus();
  }

  function openMenu() {
    if (disabled) return;
    setOpen(true);
    setQuery('');
    const selectedIndex = options.indexOf(value);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex + 1 : 0);
  }

  function selectOption(optionValue: string) {
    onChange(optionValue);
    closeMenu();
  }

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const active = listRef.current?.querySelector<HTMLElement>(
      `[data-option-index="${safeActive}"]`,
    );
    active?.scrollIntoView({ block: 'nearest' });
  }, [open, safeActive]);

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
      if (option) selectOption(option.value);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
      return;
    }

    if (event.key === 'Tab') {
      setOpen(false);
      setQuery('');
    }
  }

  const activeId =
    open && visible.length > 0 ? `${listId}-option-${safeActive}` : undefined;

  return (
    <div
      className={`searchable-select ${className ?? ''}`.trim()}
      ref={containerRef}
    >
      <button
        type="button"
        ref={triggerRef}
        className={`searchable-select-trigger ${open ? 'is-open' : ''}`.trim()}
        onClick={() => (open ? closeMenu() : openMenu())}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
      >
        <span
          className={`searchable-select-value ${value ? '' : 'is-placeholder'}`.trim()}
          title={value || allLabel}
        >
          {value || allLabel}
        </span>
        <Icon name="chevron-down" size={13} />
      </button>

      {open ? (
        <div className="searchable-select-popover">
          <div className="searchable-select-search">
            <Icon name="search" size={13} />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Buscar…"
              role="combobox"
              aria-label={`Buscar ${ariaLabel.toLowerCase()}`}
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={activeId}
              autoComplete="off"
            />
            {query ? (
              <button
                type="button"
                className="searchable-select-clear"
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
            ref={listRef}
            id={listId}
            className="searchable-select-list"
            role="listbox"
            aria-label={ariaLabel}
          >
            {visible.length === 0 ? (
              <li className="searchable-select-empty" role="presentation">
                Sin resultados
              </li>
            ) : (
              visible.map((option, index) => {
                const isSelected = option.value === value;
                const classes = [
                  'searchable-select-option',
                  index === safeActive ? 'is-active' : '',
                  isSelected ? 'is-selected' : '',
                ]
                  .filter(Boolean)
                  .join(' ');

                return (
                  <li
                    key={option.value || '__all__'}
                    id={`${listId}-option-${index}`}
                    data-option-index={index}
                    role="option"
                    aria-selected={isSelected}
                    className={classes}
                    onMouseEnter={() => setActiveIndex(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectOption(option.value)}
                  >
                    <span className="searchable-select-option-label">
                      {option.label}
                    </span>
                    {isSelected ? <Icon name="check" size={12} /> : null}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
