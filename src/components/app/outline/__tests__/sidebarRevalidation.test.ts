import {
  createSidebarOutlineRevalidationScheduleState,
  floorSidebarOutlineRevalidationStateForOpenWebSocket,
  getSidebarOutlineRevalidationDelayMs,
  nextSidebarOutlineRevalidationStateAfterFailure,
  nextSidebarOutlineRevalidationStateAfterResult,
  SIDEBAR_OUTLINE_REVALIDATION_FAILURE_BASE_MS,
  SIDEBAR_OUTLINE_REVALIDATION_FAILURE_MAX_MS,
  SIDEBAR_OUTLINE_REVALIDATION_INTERVAL_MS,
  SIDEBAR_OUTLINE_REVALIDATION_QUIET_INTERVAL_MS,
  SIDEBAR_OUTLINE_REVALIDATION_SLOW_INTERVAL_MS,
} from '@/components/app/outline/sidebarRevalidation';

describe('sidebar outline revalidation schedule', () => {
  it('slows down after repeated unchanged checks and resets after changes', () => {
    let state = createSidebarOutlineRevalidationScheduleState();

    expect(getSidebarOutlineRevalidationDelayMs(state, () => 0)).toBe(SIDEBAR_OUTLINE_REVALIDATION_INTERVAL_MS);

    state = nextSidebarOutlineRevalidationStateAfterResult(state, 'unchanged');
    state = nextSidebarOutlineRevalidationStateAfterResult(state, 'unchanged');
    expect(getSidebarOutlineRevalidationDelayMs(state, () => 0)).toBe(SIDEBAR_OUTLINE_REVALIDATION_INTERVAL_MS);

    state = nextSidebarOutlineRevalidationStateAfterResult(state, 'unchanged');
    expect(getSidebarOutlineRevalidationDelayMs(state, () => 0)).toBe(SIDEBAR_OUTLINE_REVALIDATION_QUIET_INTERVAL_MS);

    state = nextSidebarOutlineRevalidationStateAfterResult(state, 'unchanged');
    state = nextSidebarOutlineRevalidationStateAfterResult(state, 'unchanged');
    state = nextSidebarOutlineRevalidationStateAfterResult(state, 'unchanged');
    expect(getSidebarOutlineRevalidationDelayMs(state, () => 0)).toBe(SIDEBAR_OUTLINE_REVALIDATION_SLOW_INTERVAL_MS);

    state = nextSidebarOutlineRevalidationStateAfterResult(state, 'changed');
    expect(getSidebarOutlineRevalidationDelayMs(state, () => 0)).toBe(SIDEBAR_OUTLINE_REVALIDATION_INTERVAL_MS);
  });

  it('uses capped failure backoff separately from unchanged checks', () => {
    let state = createSidebarOutlineRevalidationScheduleState();

    state = nextSidebarOutlineRevalidationStateAfterResult(state, 'unchanged');
    state = nextSidebarOutlineRevalidationStateAfterResult(state, 'unchanged');
    state = nextSidebarOutlineRevalidationStateAfterResult(state, 'unchanged');
    state = nextSidebarOutlineRevalidationStateAfterFailure(state);
    expect(getSidebarOutlineRevalidationDelayMs(state, () => 0)).toBe(SIDEBAR_OUTLINE_REVALIDATION_FAILURE_BASE_MS);

    state = nextSidebarOutlineRevalidationStateAfterFailure(state);
    expect(getSidebarOutlineRevalidationDelayMs(state, () => 0)).toBe(SIDEBAR_OUTLINE_REVALIDATION_FAILURE_BASE_MS * 2);

    for (let index = 0; index < 8; index += 1) {
      state = nextSidebarOutlineRevalidationStateAfterFailure(state);
    }

    expect(getSidebarOutlineRevalidationDelayMs(state, () => 0)).toBe(SIDEBAR_OUTLINE_REVALIDATION_FAILURE_MAX_MS);

    state = nextSidebarOutlineRevalidationStateAfterResult(state, 'changed');
    expect(getSidebarOutlineRevalidationDelayMs(state, () => 0)).toBe(SIDEBAR_OUTLINE_REVALIDATION_INTERVAL_MS);
  });

  it('floors the schedule to the slow cadence while the WebSocket is open', () => {
    const fresh = createSidebarOutlineRevalidationScheduleState();
    const floored = floorSidebarOutlineRevalidationStateForOpenWebSocket(fresh);

    expect(getSidebarOutlineRevalidationDelayMs(floored, () => 0)).toBe(SIDEBAR_OUTLINE_REVALIDATION_SLOW_INTERVAL_MS);

    let slow = fresh;

    for (let index = 0; index < 7; index += 1) {
      slow = nextSidebarOutlineRevalidationStateAfterResult(slow, 'unchanged');
    }

    expect(floorSidebarOutlineRevalidationStateForOpenWebSocket(slow)).toBe(slow);

    const failing = nextSidebarOutlineRevalidationStateAfterFailure(fresh);

    expect(floorSidebarOutlineRevalidationStateForOpenWebSocket(failing)).toBe(failing);
    expect(getSidebarOutlineRevalidationDelayMs(failing, () => 0)).toBe(SIDEBAR_OUTLINE_REVALIDATION_FAILURE_BASE_MS);
  });
});
