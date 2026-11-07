import { useCallback, useState } from 'react';

const SESSION_KEY = 'flowmanager.reqFilters';

interface RequirementsFilters {
  searchInput: string;
  source: string;
  developer: string;
  statuses: string[];
  priority: string;
  feature: string;
  includeArchived: boolean;
  onlyMine: boolean;
  page: number;
}

const DEFAULTS: RequirementsFilters = {
  searchInput: '',
  source: '',
  developer: '',
  statuses: [],
  priority: '',
  feature: '',
  includeArchived: false,
  onlyMine: false,
  page: 1,
};

function readFromSession(): RequirementsFilters {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<RequirementsFilters>;
    return {
      searchInput: typeof parsed.searchInput === 'string' ? parsed.searchInput : DEFAULTS.searchInput,
      source: typeof parsed.source === 'string' ? parsed.source : DEFAULTS.source,
      developer: typeof parsed.developer === 'string' ? parsed.developer : DEFAULTS.developer,
      statuses: Array.isArray(parsed.statuses) ? parsed.statuses : DEFAULTS.statuses,
      priority: typeof parsed.priority === 'string' ? parsed.priority : DEFAULTS.priority,
      feature: typeof parsed.feature === 'string' ? parsed.feature : DEFAULTS.feature,
      includeArchived: typeof parsed.includeArchived === 'boolean' ? parsed.includeArchived : DEFAULTS.includeArchived,
      onlyMine: typeof parsed.onlyMine === 'boolean' ? parsed.onlyMine : DEFAULTS.onlyMine,
      page: typeof parsed.page === 'number' && parsed.page >= 1 ? parsed.page : DEFAULTS.page,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function writeToSession(filters: RequirementsFilters) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(filters));
  } catch {
    // sessionStorage puede fallar en modo privado con cuota llena — no es crítico
  }
}

export function useRequirementsFilters() {
  const [filters, setFilters] = useState<RequirementsFilters>(() => readFromSession());

  const update = useCallback(<K extends keyof RequirementsFilters>(
    key: K,
    value: RequirementsFilters[K],
  ) => {
    setFilters((prev) => {
      const next = { ...prev, [key]: value };
      writeToSession(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    const next = { ...DEFAULTS };
    writeToSession(next);
    setFilters(next);
  }, []);

  return { filters, update, reset };
}
