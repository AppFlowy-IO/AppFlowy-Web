import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('@/utils/runtime-config', () => ({ getConfigValue: (_key: string, fallback: string) => fallback }));
jest.mock('react-i18next', () => {
  const t = (key: string, options?: { defaultValue?: string; count?: number }) =>
    options?.defaultValue?.replace('{{count}}', String(options.count)) ?? key;

  return { useTranslation: () => ({ t }) };
});
jest.mock('@/application/database-yjs', () => ({
  ...jest.requireActual('@/application/database-yjs'),
  useDatabaseContext: jest.fn(),
  useFieldSelector: () => ({ field: null, clock: 0 }),
  usePrimaryFieldId: () => 'title',
  useRowMap: () => ({}),
}));
jest.mock('@/components/database/chart/useChartContext', () => ({
  useChartContext: () => ({ xAxisField: null, chartType: 4 }),
}));
jest.mock('@/components/database/DatabaseRowModal', () => ({ __esModule: true, default: () => null }));

import { useDatabaseContext } from '@/application/database-yjs';
import { ChartDataItem } from '@/application/database-yjs/chart.type';

import { ChartRowListPopup } from '../ChartRowListPopup';

const ROW_IDS = Array.from({ length: 250 }, (_, index) => `row-${index}`);
const ITEM = { label: 'Count', value: ROW_IDS.length, color: '#000', rowIds: ROW_IDS } as unknown as ChartDataItem;

describe('ChartRowListPopup', () => {
  it('lists and loads a large category a page at a time', async () => {
    const ensureRow = jest.fn().mockResolvedValue(undefined);

    (useDatabaseContext as jest.Mock).mockReturnValue({ ensureRow });
    render(<ChartRowListPopup item={ITEM} onClose={jest.fn()} open />);

    expect(screen.getAllByText('grid.title.placeholder')).toHaveLength(100);
    await waitFor(() => expect(ensureRow).toHaveBeenCalledTimes(100));
    expect(ensureRow).not.toHaveBeenCalledWith('row-100');

    act(() => {
      fireEvent.click(screen.getByText('Show 100 more'));
    });
    expect(screen.getAllByText('grid.title.placeholder')).toHaveLength(200);
    await waitFor(() => expect(ensureRow).toHaveBeenCalledWith('row-199'));

    act(() => {
      fireEvent.click(screen.getByText('Show 50 more'));
    });
    expect(screen.getAllByText('grid.title.placeholder')).toHaveLength(250);
    expect(screen.queryByTestId('chart-row-list-show-more')).toBeNull();
  });
});
