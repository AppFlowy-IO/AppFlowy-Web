import { DASHBOARD_WIDGET_GRID_OPTIONS, DEFAULT_GRID_OPTIONS } from '@/components/database/grid/useGridContext';

describe('Grid rendering options', () => {
  it('gives dashboard widget grids a small overscan and leaves other grids as they were', () => {
    expect(DASHBOARD_WIDGET_GRID_OPTIONS.rowOverscan).toBe(3);
    expect(DASHBOARD_WIDGET_GRID_OPTIONS.columnOverscan).toBe(2);
    // Unset: the virtualizer keeps its former 10 rows and 5 columns.
    expect(DEFAULT_GRID_OPTIONS.rowOverscan).toBeUndefined();
    expect(DEFAULT_GRID_OPTIONS.columnOverscan).toBeUndefined();
  });
});
