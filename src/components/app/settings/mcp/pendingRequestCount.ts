import { useCallback, useEffect, useSyncExternalStore } from 'react';

import * as McpService from '@/application/services/domains/mcp';

/**
 * Pending AI app approval requests per workspace, for the owner's badge on
 * Settings > MCP. The menu loads the count when Settings opens; the panel
 * publishes every list it loads or changes, so approving or dismissing a
 * request updates the badge at once.
 */
const counts = new Map<string, number>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Records the workspace's pending request count; undefined forgets it (no badge). */
export function publishMcpPendingRequestCount(workspaceId: string, count: number | undefined) {
  if (count === undefined ? !counts.has(workspaceId) : counts.get(workspaceId) === count) return;
  if (count === undefined) counts.delete(workspaceId);
  else counts.set(workspaceId, count);
  listeners.forEach((listener) => listener());
}

/** Forgets every count; tests only. */
export function resetMcpPendingRequestCountsForTests() {
  counts.clear();
}

/**
 * The workspace's pending approval request count while `enabled` (an owner,
 * with the MCP service known); loads it once per enable. Undefined until
 * known, and when the list cannot be loaded: no badge rather than a wrong one.
 */
export function useMcpPendingRequestCount(workspaceId: string | undefined, enabled: boolean): number | undefined {
  const getSnapshot = useCallback(() => (workspaceId ? counts.get(workspaceId) : undefined), [workspaceId]);
  const count = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!enabled || !workspaceId) return;

    const controller = new AbortController();

    McpService.listMcpAccessRequests(workspaceId, { signal: controller.signal }).then(
      (requests) => {
        if (!controller.signal.aborted) publishMcpPendingRequestCount(workspaceId, requests.length);
      },
      () => {
        // Not an owner (any more), or the service is down. The list still answers an owner the
        // email gate excludes; the MCP panel clears that badge.
        if (!controller.signal.aborted) publishMcpPendingRequestCount(workspaceId, undefined);
      }
    );
    return () => controller.abort();
  }, [enabled, workspaceId]);

  return enabled ? count : undefined;
}
