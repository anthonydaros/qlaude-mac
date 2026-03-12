import { useState, useEffect, useCallback, useRef } from 'react';

export interface UseIpcResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Generic hook for IPC invoke calls.
 * Automatically fetches on mount and when args change.
 */
export function useIpc<T>(
  invoker: () => Promise<T>,
  deps: unknown[] = []
): UseIpcResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoker();
      if (mountedRef.current) {
        setData(result);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    mountedRef.current = true;
    fetch();
    return () => {
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetch]);

  return { data, loading, error, refetch: fetch };
}

/**
 * Hook for subscribing to IPC events. Cleans up on unmount.
 */
export function useIpcSubscription<T>(
  subscribe: (callback: (data: T) => void) => () => void,
  callback: (data: T) => void
): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const unsubscribe = subscribe((data: T) => {
      callbackRef.current(data);
    });
    return unsubscribe;
  }, [subscribe]);
}
