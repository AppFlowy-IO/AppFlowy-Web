import { renderHook } from '@testing-library/react';

import { useTimelineRows } from '../hooks/useTimelineRows';

const mockEvents = { events: [] as unknown[], emptyEvents: [] as unknown[], hasEndField: false, loading: true };
const mockSource = { rowOrders: undefined as { id: string }[] | undefined };

jest.mock('@/application/database-yjs', () => ({
  useTimelineEventsSelector: () => mockEvents,
}));
jest.mock('@/application/database-yjs/hooks/TimelineRowValuesProvider', () => ({
  useTimelineRowSource: () => mockSource,
}));

describe('useTimelineRows while the rows load', () => {
  it('says it loads until every row has its document, with no row to draw meanwhile', () => {
    mockSource.rowOrders = [{ id: 'r1' }];
    mockEvents.loading = true;

    const { result, rerender } = renderHook(() => useTimelineRows(false));

    expect(result.current.loading).toBe(true);
    expect(result.current.rows).toEqual([]);

    mockEvents.loading = false;
    rerender();

    expect(result.current.loading).toBe(false);
  });
});
