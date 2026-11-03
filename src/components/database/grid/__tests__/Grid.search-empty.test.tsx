import { render, screen } from '@testing-library/react';

import type { GridGrouping } from '@/application/database-yjs';
import { Grid } from '@/components/database/grid/Grid';

let mockQuery = '';
let mockGrouping: Partial<GridGrouping> = {};

jest.mock('@/application/database-yjs', () => ({
  useDatabaseContext: () => ({ isDashboardWidget: true }),
  useDatabaseSearchQuery: () => mockQuery,
  useDatabaseViewId: () => 'grid-view',
}));
jest.mock('@/components/database/components/grid/grid-column', () => ({ useRenderFields: () => ({ fields: [] }) }));
jest.mock('@/components/database/components/grid/grid-table/GridVirtualizer', () => ({
  __esModule: true,
  default: () => <div data-testid='grid-virtualizer' />,
}));
jest.mock('@/components/database/grid/GridGroupingContext', () => ({ useGridGrouping: () => mockGrouping }));
jest.mock('@/components/database/grid/GridProvider', () => ({
  GridProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('Grid with a row search (WP09 §1.2)', () => {
  afterEach(() => {
    mockQuery = '';
    mockGrouping = {};
  });

  it('replaces the header, rows, footer and new row with "No results" once a search settles on no row', () => {
    mockQuery = 'zzqx';
    mockGrouping = { rowOrders: [] };
    render(<Grid />);

    expect(screen.getByTestId('database-search-empty-state').getAttribute('role')).toBe('status');
    expect(screen.queryByTestId('grid-virtualizer')).toBeNull();
    expect(screen.getByTestId('database-grid').getAttribute('data-row-count')).toBe('0');
  });

  it('keeps the grid while the search is still reading rows, or while it matches rows', () => {
    mockQuery = 'zzqx';
    mockGrouping = { rowOrders: [], hydrating: { ready: 10, total: 100 } };
    const { rerender } = render(<Grid />);

    expect(screen.getByTestId('grid-virtualizer')).toBeTruthy();
    mockGrouping = { rowOrders: [{ id: 'row', height: 36 }] };
    rerender(<Grid />);
    expect(screen.getByTestId('grid-virtualizer')).toBeTruthy();
    expect(screen.queryByTestId('database-search-empty-state')).toBeNull();
  });

  it('keeps an empty grid without a search as it is', () => {
    mockGrouping = { rowOrders: [] };
    render(<Grid />);

    expect(screen.getByTestId('grid-virtualizer')).toBeTruthy();
    expect(screen.queryByTestId('database-search-empty-state')).toBeNull();
  });
});
