import { useCallback, useEffect, useRef, useState } from 'react';
import { getSystemInfo, normalizeError } from '../lib/api';
import type { ApiError, SystemInfo } from '../types';

export function useSystemInfo() {
  const [data, setData] = useState<SystemInfo | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async (silent = false): Promise<boolean> => {
    if (!silent) setLoading(true);
    try {
      const info = await getSystemInfo();
      if (!mounted.current) return true;
      setData(info);
      setError(null);
      return true;
    } catch (caught) {
      if (!mounted.current) return false;
      setError(normalizeError(caught));
      return false;
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, error, loading, refresh };
}
