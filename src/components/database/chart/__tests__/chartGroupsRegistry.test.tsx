import { act, renderHook } from '@testing-library/react';

import type { ChartGroupSummary } from '@/application/database-yjs/chart-config';
import {
  clearChartGroups,
  getChartGroups,
  setChartGroups,
  useChartGroups,
} from '@/components/database/chart/chartGroupsRegistry';

function groups(...labels: string[]): ChartGroupSummary[] {
  return labels.map((label) => ({ key: `k-${label}`, label, count: 1, isEmpty: false, hidden: false }));
}

describe('chartGroupsRegistry', () => {
  afterEach(() => {
    // Hooks of the test may still be mounted: their re-render belongs in act.
    act(() => {
      clearChartGroups('view-a');
      clearChartGroups('view-b');
    });
  });

  it('publishes groups per view and notifies only that view', () => {
    const a = renderHook(() => useChartGroups('view-a'));
    const b = renderHook(() => useChartGroups('view-b'));
    const published = groups('Todo', 'Done');

    expect(a.result.current).toBeUndefined();
    act(() => setChartGroups('view-a', published));
    expect(a.result.current).toBe(published);
    expect(b.result.current).toBeUndefined();
  });

  it('clears a view when its chart unmounts', () => {
    const hook = renderHook(() => useChartGroups('view-a'));
    const published = groups('Todo');

    act(() => setChartGroups('view-a', published));
    act(() => clearChartGroups('view-a', published));
    expect(hook.result.current).toBeUndefined();
  });

  it('keeps the groups another chart of the same view published since', () => {
    const first = groups('Todo');
    const second = groups('Todo', 'Doing');

    setChartGroups('view-a', first);
    setChartGroups('view-a', second);
    // The first chart unmounts with its own (stale) list: the second chart's groups stay.
    clearChartGroups('view-a', first);
    expect(getChartGroups('view-a')).toBe(second);
  });

  it('reads nothing without a view id', () => {
    const hook = renderHook(() => useChartGroups(null));

    expect(hook.result.current).toBeUndefined();
  });
});
