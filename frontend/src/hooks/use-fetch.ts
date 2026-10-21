'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export function errorMessage(e: unknown): string {
  const err = e as { response?: { data?: { error?: string; message?: string; details?: { message: string; path?: (string | number)[] }[] } }; message?: string };
  const d = err?.response?.data;
  if (d?.details?.length) return d.details.map((x) => `${x.path?.join('.') ? x.path.join('.') + ': ' : ''}${x.message}`).join('; ');
  return d?.error || d?.message || err?.message || 'Something went wrong';
}

/** Fetch + optional polling. Keeps showing the last data while refreshing; surfaces errors; cancels stale responses. */
export function useFetch<T>(fn: () => Promise<T>, deps: unknown[], opts: { pollMs?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const seq = useRef(0);

  const run = useCallback(async (background = false) => {
    const mine = ++seq.current;
    background ? setRefreshing(true) : setLoading(true);
    try {
      const result = await fn();
      if (mine === seq.current) { setData(result); setError(null); }
    } catch (e) {
      if (mine === seq.current) setError(errorMessage(e));
    } finally {
      if (mine === seq.current) { setLoading(false); setRefreshing(false); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { void run(false); }, [run]);
  useEffect(() => {
    if (!opts.pollMs) return;
    const id = setInterval(() => { if (document.visibilityState === 'visible') void run(true); }, opts.pollMs);
    return () => clearInterval(id);
  }, [run, opts.pollMs]);

  return { data, error, loading, refreshing, reload: () => run(true) };
}
