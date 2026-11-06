import { useCallback, useEffect, useSyncExternalStore } from 'react';

import * as McpService from '@/application/services/domains/mcp';
import type { McpMemberStatus } from '@/application/services/domains/mcp';

/**
 * Pending AI app approval requests per workspace, for the owner's badge on
 * Settings > MCP. The menu refreshes the count when Settings opens; the panel
 * publishes every list it loads or changes, so approving or dismissing a
 * request updates the badge at once.
 *
 * The latest write wins: a publish, or a newer refresh, drops the answer of a
 * refresh still in flight for the workspace. AppFlowy Desktop's
 * `McpPendingRequestCounts` follows the same rules.
 */
const counts = new Map<string, number>();
/** Per workspace, advanced by every publish and every refresh started. */
const writes = new Map<string, number>();
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
  return status !== undefined && status.enabled && status.eligible && status.role === 'owner';
}

function nextWrite(workspaceId: string): number {
  const write = (writes.get(workspaceId) ?? 0) + 1;

  writes.set(workspaceId, write);
  return write;
}

function store(workspaceId: string, count: number | undefined) {
  if (count === undefined ? !counts.has(workspaceId) : counts.get(workspaceId) === count) return;
  if (count === undefined) counts.delete(workspaceId);
  else counts.set(workspaceId, count);
  listeners.forEach((listener) => listener());
}

/** Records the workspace's pending request count; undefined forgets it (no badge). */
export function publishMcpPendingRequestCount(workspaceId: string, count: number | undefined) {
  nextWrite(workspaceId);
  store(workspaceId, count);
}

/**
 * Loads the workspace's count with the member status, which decides whether
 * the panel would show the requests: only a caller who manages AI apps there
 * (`mcpManagesApprovals`) gets a count, and a failed load forgets it. An
 * aborted refresh writes nothing.
 */
async function refreshMcpPendingRequestCount(workspaceId: string, signal: AbortSignal): Promise<void> {
  const write = nextWrite(workspaceId);
  let count: number | undefined;

  try {
    // The access-request list answers owners while AI apps are off and owners the email gate
    // excludes, so the member status decides.
    const [status, requests] = await Promise.all([
      McpService.getMcpMemberStatus(workspaceId, undefined, { signal }),
      McpService.listMcpAccessRequests(workspaceId, { signal }),
    ]);

    count = mcpManagesApprovals(status) ? requests.length : undefined;
  } catch {
    // Not an owner (any more), AI apps turned off (503 mcp_disabled), or the service is down.
    count = undefined;
  }

  if (!signal.aborted && writes.get(workspaceId) === write) store(workspaceId, count);
}

/** Forgets every count; tests only. */
export function resetMcpPendingRequestCountsForTests() {
  counts.clear();
  writes.clear();
}

/**
 * The workspace's pending approval request count while `enabled` (a Cloud
 * owner, with the MCP service known); refreshes it once per enable
 * (`refreshMcpPendingRequestCount`). Undefined until known, when the panel
 * would show none (AI apps turned off, an owner the email gate excludes, a
 * member), and when either cannot be loaded: no badge rather than a wrong one.
 */
export function useMcpPendingRequestCount(workspaceId: string | undefined, enabled: boolean): number | undefined {
  const getSnapshot = useCallback(() => (workspaceId ? counts.get(workspaceId) : undefined), [workspaceId]);
  const count = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!enabled || !workspaceId) return;

    const controller = new AbortController();

    void refreshMcpPendingRequestCount(workspaceId, controller.signal);
    return () => controller.abort();
  }, [enabled, workspaceId]);

  return enabled ? count : undefined;
}
