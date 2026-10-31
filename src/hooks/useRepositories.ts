import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizeError } from '../lib/api';
import {
  getRepository,
  listRepositories,
} from '../lib/repositories';
import type {
  ApiError,
  RepositoryDetail,
  RepositorySummary,
} from '../types';

export function useRepositories() {
  const [items, setItems] = useState<RepositorySummary[]>([]);
  const [detail, setDetail] = useState<RepositoryDetail | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [detailError, setDetailError] = useState<ApiError | null>(null);
  const selectedRef = useRef<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const loaded = await getRepository(id);
      if (!mounted.current) return;
      setDetail(loaded);
    } catch (caught) {
      if (!mounted.current) return;
      setDetail(null);
      setDetailError(normalizeError(caught));
    } finally {
      if (mounted.current) setDetailLoading(false);
    }
  }, []);

  const refresh = useCallback(async (): Promise<RepositorySummary[]> => {
    setLoading(true);
    try {
      const loaded = await listRepositories();
      if (!mounted.current) return loaded;
      setItems(loaded);
      setError(null);

      const current = selectedRef.current;
      const target =
        current && loaded.some((item) => item.id === current)
          ? current
          : (loaded[0]?.id ?? null);
      setSelectedId(target);
      if (target) {
        await loadDetail(target);
      } else {
        setDetail(null);
      }

      return loaded;
    } catch (caught) {
      if (mounted.current) {
        setError(normalizeError(caught));
      }
      return [];
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [loadDetail]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const select = useCallback(
    (id: string) => {
      setSelectedId(id);
      void loadDetail(id);
    },
    [loadDetail],
  );

  const applyDetail = useCallback((updated: RepositoryDetail) => {
    setDetail(updated);
    setSelectedId(updated.id);
    setItems((current) => {
      const exists = current.some((item) => item.id === updated.id);
      if (!exists) return [...current, updated];
      return current.map((item) =>
        item.id === updated.id ? updated : item,
      );
    });
  }, []);

  const removeLocal = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
    setDetail((current) => (current?.id === id ? null : current));
    setSelectedId((current) => (current === id ? null : current));
  }, []);

  return {
    items,
    detail,
    selectedId,
    loading,
    detailLoading,
    error,
    detailError,
    refresh,
    select,
    applyDetail,
    removeLocal,
    setDetail,
  };
}
