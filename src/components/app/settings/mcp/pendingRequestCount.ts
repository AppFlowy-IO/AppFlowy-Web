import { useCallback, useEffect, useSyncExternalStore } from 'react';

import * as McpService from '@/application/services/domains/mcp';
import type { McpMemberStatus } from '@/application/services/domains/mcp';

/**
 * Pending AI app approval requests per workspace, for the owner's badge on
 * Settings > MCP. The menu loads the count when Settings opens; the panel
 * publishes every list it loads or changes, so approving or dismissing a
 * request updates the badge at once.
 */
const counts = new Map<string, number>();
/**
 * Bumped by every publish. The menu's load publishes only when nothing was
 * published since it started, so a late answer (or failure) cannot overwrite
 * the count of the list the panel shows.
 */
const generations = new Map<string, number>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Whether the member status lets the caller manage AI apps here, approval
 * requests included: connections are on and the caller is an owner the email
 * gate admits. The panel shows its owner section, and the menu its badge, only then.
 */
export function mcpManagesApprovals(status: McpMemberStatus | undefined): boolean {
  return status !== undefined && status.enabled !== false && status.eligible && status.role === 'owner';
}

/** Records the workspace's pending request count; undefined forgets it (no badge). */
export function publishMcpPendingRequestCount(workspaceId: string, count: number | undefined) {
  generations.set(workspaceId, (generations.get(workspaceId) ?? 0) + 1);
  if (count === undefined ? !counts.has(workspaceId) : counts.get(workspaceId) === count) return;
  if (count === undefined) counts.delete(workspaceId);
  else counts.set(workspaceId, count);
  listeners.forEach((listener) => listener());
}

/** Forgets every count; tests only. */
export function resetMcpPendingRequestCountsForTests() {
  counts.clear();
  generations.clear();
}

/**
 * The workspace's pending approval request count while `enabled` (a Cloud
 * owner, with the MCP service known); loads it once per enable, with the
 * member status that decides whether the panel would show the requests.
 * Undefined until known, when the panel would show none (AI apps turned off,
 * an owner the email gate excludes), and when either cannot be loaded: no
 * badge rather than a wrong one.
 */
export function useMcpPendingRequestCount(workspaceId: string | undefined, enabled: boolean): number | undefined {
  const getSnapshot = useCallback(() => (workspaceId ? counts.get(workspaceId) : undefined), [workspaceId]);
  const count = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!enabled || !workspaceId) return;

    const controller = new AbortController();
    const { signal } = controller;
    const generation = generations.get(workspaceId) ?? 0;
    const publish = (value: number | undefined) => {
      // The panel published since: its list is newer than this answer.
      if (!signal.aborted && (generations.get(workspaceId) ?? 0) === generation) {
        publishMcpPendingRequestCount(workspaceId, value);
      }
    };

    // The access-request list answers owners while AI apps are off and owners the email gate
    // excludes, so the member status decides.
    Promise.all([
      McpService.getMcpMemberStatus(workspaceId, undefined, { signal }),
      McpService.listMcpAccessRequests(workspaceId, { signal }),
    ]).then(
      ([status, requests]) => publish(mcpManagesApprovals(status) ? requests.length : undefined),
      // Not an owner (any more), AI apps turned off (503 mcp_disabled), or the service is down.
      () => publish(undefined)
    );
    return () => controller.abort();
  }, [enabled, workspaceId]);

  return enabled ? count : undefined;
}
