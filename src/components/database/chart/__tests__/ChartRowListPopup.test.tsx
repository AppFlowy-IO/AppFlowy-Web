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
  useFieldSelector: jest.fn(),
  usePrimaryFieldId: () => 'title',
  useRowMap: jest.fn(),
}));
jest.mock('@/components/database/chart/useChartContext', () => ({
  useChartContext: () => ({ xAxisField: null, chartType: 4 }),
}));
jest.mock('@/components/database/DatabaseRowModal', () => ({ __esModule: true, default: () => null }));

import { useDatabaseContext, useFieldSelector, useRowMap } from '@/application/database-yjs';
import { createCell, createField, createRowDoc } from '@/application/database-yjs/__tests__/test-helpers';
import { ChartDataItem } from '@/application/database-yjs/chart.type';
import { FieldType } from '@/application/database-yjs/database.type';
import * as decode from '@/application/database-yjs/decode';

import { ChartRowListPopup } from '../ChartRowListPopup';

const ROW_IDS = Array.from({ length: 250 }, (_, index) => `row-${index}`);
const ITEM = { label: 'Count', value: ROW_IDS.length, color: '#000', rowIds: ROW_IDS } as unknown as ChartDataItem;

describe('ChartRowListPopup', () => {
  beforeEach(() => {
    (useFieldSelector as jest.Mock).mockReturnValue({ field: null, clock: 0 });
    (useRowMap as jest.Mock).mockReturnValue({});
  });

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

  it.each([true, false])('refreshes replaced row documents with a loader available: %s', async (hasLoader) => {
    const primaryField = createField('title', FieldType.RichText);
    const originalRow = createRowDoc('row-0', 'database', { title: createCell(FieldType.RichText, 'Original title') });
    const replacementRow = createRowDoc('row-0', 'database', { title: createCell(FieldType.RichText, 'Restored title') });
    const ensureRow = jest.fn();
    const item = { ...ITEM, rowIds: ['row-0'] };

    (useDatabaseContext as jest.Mock).mockReturnValue({ ensureRow: hasLoader ? ensureRow : undefined });
    (useFieldSelector as jest.Mock).mockReturnValue({ field: primaryField, clock: 0 });
    (useRowMap as jest.Mock).mockReturnValue({ 'row-0': originalRow });
    const { rerender, unmount } = render(<ChartRowListPopup item={item} onClose={jest.fn()} open />);

    expect(screen.getByText('Original title')).toBeTruthy();
    (useRowMap as jest.Mock).mockReturnValue({ 'row-0': replacementRow });
    rerender(<ChartRowListPopup item={item} onClose={jest.fn()} open />);

    await waitFor(() => expect(screen.getByText('Restored title')).toBeTruthy());
    expect(screen.queryByText('Original title')).toBeNull();
    expect(ensureRow).not.toHaveBeenCalled();
    unmount();
    originalRow.destroy();
    replacementRow.destroy();
    primaryField.doc?.destroy();
  });

  it('batches row arrivals before decoding the visible titles', () => {
    jest.useFakeTimers();
    const primaryField = createField('title', FieldType.RichText);
    const rowIds = ROW_IDS.slice(0, 100);
    const rowDocs = rowIds.map((rowId) =>
      createRowDoc(rowId, 'database', { title: createCell(FieldType.RichText, `Title ${rowId}`) })
    );
    const item = { ...ITEM, rowIds };
    const decodeSpy = jest.spyOn(decode, 'decodeCellToText');

    (useDatabaseContext as jest.Mock).mockReturnValue({});
    (useFieldSelector as jest.Mock).mockReturnValue({ field: primaryField, clock: 0 });
    const { rerender, unmount } = render(<ChartRowListPopup item={item} onClose={jest.fn()} open />);

    try {
      for (let index = 0; index < rowIds.length; index += 1) {
        (useRowMap as jest.Mock).mockReturnValue(
          Object.fromEntries(rowIds.slice(0, index + 1).map((rowId, rowIndex) => [rowId, rowDocs[rowIndex]]))
        );
        rerender(<ChartRowListPopup item={item} onClose={jest.fn()} open />);
      }

      expect(decodeSpy).not.toHaveBeenCalled();
      act(() => {
        jest.advanceTimersByTime(200);
      });
      expect(screen.getByText('Title row-99')).toBeTruthy();
      expect(decodeSpy).toHaveBeenCalledTimes(100);
    } finally {
      unmount();
      decodeSpy.mockRestore();
      rowDocs.forEach((doc) => doc.destroy());
      primaryField.doc?.destroy();
      jest.useRealTimers();
    }
  });
});
