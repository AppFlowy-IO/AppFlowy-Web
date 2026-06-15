export const SIDEBAR_OUTLINE_REVALIDATION_INTERVAL_MS = 30_000;
export const SIDEBAR_OUTLINE_REVALIDATION_JITTER_MS = 30_000;
export const SIDEBAR_OUTLINE_REVALIDATION_QUIET_AFTER = 3;
export const SIDEBAR_OUTLINE_REVALIDATION_SLOW_AFTER = 6;
export const SIDEBAR_OUTLINE_REVALIDATION_QUIET_INTERVAL_MS = 120_000;
export const SIDEBAR_OUTLINE_REVALIDATION_QUIET_JITTER_MS = 60_000;
export const SIDEBAR_OUTLINE_REVALIDATION_SLOW_INTERVAL_MS = 300_000;
export const SIDEBAR_OUTLINE_REVALIDATION_SLOW_JITTER_MS = 120_000;
export const SIDEBAR_OUTLINE_REVALIDATION_FAILURE_BASE_MS = 30_000;
export const SIDEBAR_OUTLINE_REVALIDATION_FAILURE_MAX_MS = 300_000;
export const MAX_SIDEBAR_OUTLINE_REVALIDATION_EXPANDED_IDS = 20;

export type SidebarOutlineRevalidationResult = 'changed' | 'unchanged';

export interface SidebarOutlineRevalidationScheduleState {
  unchangedCount: number;
  failureCount: number;
}

export function createSidebarOutlineRevalidationScheduleState(): SidebarOutlineRevalidationScheduleState {
  return {
    unchangedCount: 0,
    failureCount: 0,
  };
}

export function nextSidebarOutlineRevalidationStateAfterResult(
  state: SidebarOutlineRevalidationScheduleState,
  result: SidebarOutlineRevalidationResult
): SidebarOutlineRevalidationScheduleState {
  return {
    unchangedCount: result === 'changed' ? 0 : state.unchangedCount + 1,
    failureCount: 0,
  };
}

export function nextSidebarOutlineRevalidationStateAfterFailure(
  state: SidebarOutlineRevalidationScheduleState
): SidebarOutlineRevalidationScheduleState {
  return {
    unchangedCount: state.unchangedCount,
    failureCount: state.failureCount + 1,
  };
}

export function getSidebarOutlineRevalidationDelayMs(
  state: SidebarOutlineRevalidationScheduleState = createSidebarOutlineRevalidationScheduleState(),
  random = Math.random
) {
  const { intervalMs, jitterMs } = getSidebarOutlineRevalidationWindowMs(state);

  return intervalMs + Math.floor(random() * (jitterMs + 1));
}

function getSidebarOutlineRevalidationWindowMs(state: SidebarOutlineRevalidationScheduleState) {
  if (state.failureCount > 0) {
    return {
      intervalMs: Math.min(
        SIDEBAR_OUTLINE_REVALIDATION_FAILURE_BASE_MS * 2 ** Math.min(state.failureCount - 1, 30),
        SIDEBAR_OUTLINE_REVALIDATION_FAILURE_MAX_MS
      ),
      jitterMs: 0,
    };
  }

  if (state.unchangedCount >= SIDEBAR_OUTLINE_REVALIDATION_SLOW_AFTER) {
    return {
      intervalMs: SIDEBAR_OUTLINE_REVALIDATION_SLOW_INTERVAL_MS,
      jitterMs: SIDEBAR_OUTLINE_REVALIDATION_SLOW_JITTER_MS,
    };
  }

  if (state.unchangedCount >= SIDEBAR_OUTLINE_REVALIDATION_QUIET_AFTER) {
    return {
      intervalMs: SIDEBAR_OUTLINE_REVALIDATION_QUIET_INTERVAL_MS,
      jitterMs: SIDEBAR_OUTLINE_REVALIDATION_QUIET_JITTER_MS,
    };
  }

  return {
    intervalMs: SIDEBAR_OUTLINE_REVALIDATION_INTERVAL_MS,
    jitterMs: SIDEBAR_OUTLINE_REVALIDATION_JITTER_MS,
  };
}

export function limitSidebarOutlineExpandedViewIds(
  viewIds: string[],
  maxViewIds = MAX_SIDEBAR_OUTLINE_REVALIDATION_EXPANDED_IDS
) {
  const seen = new Set<string>();
  const limited: string[] = [];

  for (const viewId of viewIds) {
    if (!viewId || seen.has(viewId)) continue;

    seen.add(viewId);
    limited.push(viewId);

    if (limited.length >= maxViewIds) {
      break;
    }
  }

  return limited;
}
