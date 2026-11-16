import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { notify } from '@/components/_shared/notify';

import { mcpActionFailedMessage } from './format';

export interface McpResource<T> {
  /** The last loaded value; kept while reloading, undefined until the first load succeeds. */
  data: T | undefined;
  /** A load is in flight. */
  loading: boolean;
  /** The last load failed; `error` holds why. Cleared when a reload starts or an action updates the data. */
  failed: boolean;
  error: unknown;
  reload: () => Promise<void>;
  /**
   * Applies the result of a successful action. It wins over a load already in
   * flight, which may have been answered before the action took effect, and
   * clears an earlier load's failure, which it is newer than.
   */
  update: (updater: (current: T | undefined) => T | undefined) => void;
}

/**
 * Loads one MCP resource the way `connections/useConnections.ts` does: every
 * load aborts the previous one, results of aborted loads are dropped, and
 * unmounting (or disabling) aborts the load in flight.
 */
export function useMcpResource<T>(load: (signal: AbortSignal) => Promise<T>, enabled = true): McpResource<T> {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(enabled);
  const [failure, setFailure] = useState<{ error: unknown }>();
  const request = useRef<AbortController>();

  const reload = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();

    request.current = controller;
    setLoading(true);
    setFailure(undefined);
    try {
      const result = await load(controller.signal);

      if (!controller.signal.aborted) setData(result);
    } catch (error) {
      if (!controller.signal.aborted) setFailure({ error });
    } finally {
      if (request.current === controller) {
        request.current = undefined;
        setLoading(false);
      }
    }
  }, [load]);

  useEffect(() => {
    if (!enabled) return;
    void reload();
    return () => {
      request.current?.abort();
    };
  }, [enabled, reload]);

  const update = useCallback((updater: (current: T | undefined) => T | undefined) => {
    if (request.current) {
      request.current.abort();
      request.current = undefined;
      setLoading(false);
    }

    // A policy change answered after a failed settings reload is not a failed section.
    setFailure(undefined);
    setData(updater);
  }, []);

  return { data, loading, failed: Boolean(failure), error: failure?.error, reload, update };
}

export interface McpAction<K> {
  /** The action in flight; only one runs at a time. */
  pending: K | undefined;
  /**
   * Runs `request` unless another action is in flight. Success calls
   * `onSuccess` and resolves true; failure shows a toast, calls `onError` and
   * resolves false. Unmounting aborts the request without reporting it.
   */
  run: <T>(
    key: K,
    request: (signal: AbortSignal) => Promise<T>,
    onSuccess: (result: T) => void,
    onError?: (error: unknown) => void
  ) => Promise<boolean>;
}

export function useMcpAction<K>(): McpAction<K> {
  const { t } = useTranslation();
  const [pending, setPending] = useState<K>();
  const operation = useRef<AbortController>();

  useEffect(
    () => () => {
      operation.current?.abort();
      operation.current = undefined;
    },
    []
  );

  const run = useCallback(
    async <T>(
      key: K,
      request: (signal: AbortSignal) => Promise<T>,
      onSuccess: (result: T) => void,
      onError?: (error: unknown) => void
    ) => {
      if (operation.current) return false;
      const controller = new AbortController();

      operation.current = controller;
      setPending(() => key);
      try {
        const result = await request(controller.signal);

        if (controller.signal.aborted) return false;
        onSuccess(result);
        return true;
      } catch (error) {
        if (!controller.signal.aborted) {
          notify.error(mcpActionFailedMessage(error, t));
          onError?.(error);
        }

        return false;
      } finally {
        if (operation.current === controller) {
          operation.current = undefined;
          setPending(undefined);
        }
      }
    },
    [t]
  );

  return { pending, run };
}
