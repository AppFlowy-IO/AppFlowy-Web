import { render, screen } from '@testing-library/react';
import { useState } from 'react';

import { DatabaseContext } from '@/application/database-yjs';
import { loadParityFixture } from '@/application/database-yjs/__tests__/dashboard-parity-helpers';
import { DatabaseViewLayout } from '@/application/types';
import {
  COMPACT_HOVER_CONTROLS_WIDTH,
  HOVER_CONTROLS_WIDTH,
  HoverControls,
} from '@/components/database/components/grid/controls/HoverControls';
import { GridDragState } from '@/components/database/components/grid/drag-and-drop/GridDragContext';

import { WIDGET_GRID_ROW_GUTTER, WIDGET_INLINE_PADDING } from '../constants';
import { DashboardWidget } from '../DashboardWidget';

import { createWidgetHost, DashboardWidgetProviders, widgetBoxProps } from './dashboardTestHarness';

const mockPaddings: { start?: number; end?: number }[] = [];

jest.mock('react-i18next', () => {
  const t = (key: string) => key;

  return { useTranslation: () => ({ t }) };
});
jest.mock('@atlaskit/pragmatic-drag-and-drop-react-drop-indicator/box', () => ({ DropIndicator: () => null }));
jest.mock('@/application/publish-snapshot/database-yjs-render-bridge', () => ({
  getPublishedDatabaseRenderRowMap: () => undefined,
}));
jest.mock('@/components/database', () => ({
  Database: ({ paddingStart, paddingEnd }: { paddingStart?: number; paddingEnd?: number }) => {
    mockPaddings.push({ start: paddingStart, end: paddingEnd });
    return <div data-testid='widget-surface' />;
  },
}));
jest.mock('@/components/editor/components/blocks/database/hooks/useViewMeta', () => ({
  useViewMeta: () => ({ viewMeta: null }),
}));
jest.mock('../hooks/useDashboardDnd', () => ({
  useDraggableWidget: () => undefined,
  useWidgetDropTarget: () => null,
  useRowGapDropTarget: () => false,
}));
jest.mock('../WidgetHeader', () => ({ WidgetHeaderFrame: () => null }));

// For the row controls of a grid widget.
jest.mock('@/components/database/components/grid/controls/HoverControls.hooks', () => ({
  useHoverControlsActions: () => ({
    addAboveLoading: false,
    addBelowLoading: false,
    onAddRowAbove: jest.fn(),
    onAddRowBelow: jest.fn(),
  }),
  useHoverControlsDisplay: () => ({ ref: jest.fn() }),
}));
jest.mock('@/components/database/components/grid/controls/RowMenu', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/database/components/sorts/ClearSortingConfirm', () => ({
  __esModule: true,
  default: () => null,
}));

/** `dashboard-parity/widget-content.json` (addendum A5), shared with desktop. */
interface WidgetContentFixture {
  geometry: {
    grid_start_inset_editable: number;
    start_inset: number;
    end_inset: number;
    top_inset: number;
    row_handle: number;
    row_min_height: number;
    row_divider: number;
  };
}

const { geometry } = loadParityFixture<WidgetContentFixture>('widget-content.json');

function WidgetOf({ layout, readOnly }: { layout: DatabaseViewLayout; readOnly: boolean }) {
  const [host] = useState(() => createWidgetHost({ layout, name: 'Projects', readOnly }));

  return (
    <DashboardWidgetProviders host={host}>
      <DashboardWidget {...widgetBoxProps({ canEdit: !readOnly })} />
    </DashboardWidgetProviders>
  );
}

function paddingsOf(layout: DatabaseViewLayout, readOnly = false) {
  mockPaddings.length = 0;
  const { unmount } = render(<WidgetOf layout={layout} readOnly={readOnly} />);

  expect(screen.getByTestId('widget-surface')).toBeTruthy();
  const last = mockPaddings[mockPaddings.length - 1];

  unmount();
  return last;
}

describe('widget content geometry (addendum A5)', () => {
  it('keeps the content constants equal to widget-content.json', () => {
    expect(WIDGET_GRID_ROW_GUTTER).toBe(geometry.grid_start_inset_editable);
    expect(WIDGET_INLINE_PADDING).toBe(geometry.start_inset);
    expect(WIDGET_INLINE_PADDING).toBe(geometry.end_inset);
    expect(geometry.top_inset).toBe(0);
  });

  it('starts an editable grid widget 32px inside the card, and ends it 12px inside', () => {
    expect(paddingsOf(DatabaseViewLayout.Grid)).toEqual({
      start: geometry.grid_start_inset_editable,
      end: geometry.end_inset,
    });
  });

  it('starts a read-only grid widget 12px inside the card (no row handle)', () => {
    expect(paddingsOf(DatabaseViewLayout.Grid, true)).toEqual({ start: geometry.start_inset, end: geometry.end_inset });
  });

  it.each([
    ['Board', DatabaseViewLayout.Board],
    ['Calendar', DatabaseViewLayout.Calendar],
    ['Chart', DatabaseViewLayout.Chart],
    ['List', DatabaseViewLayout.List],
    ['Gallery', DatabaseViewLayout.Gallery],
    ['Feed', DatabaseViewLayout.Feed],
    ['Timeline', DatabaseViewLayout.Timeline],
  ])('starts and ends a %s widget 12px inside the card', (_name, layout) => {
    expect(paddingsOf(layout)).toEqual({ start: geometry.start_inset, end: geometry.end_inset });
  });

  it('fits the compact row controls, and only them, in the editable grid gutter', () => {
    // GridVirtualRow switches to the compact controls below the full gutter.
    expect(WIDGET_GRID_ROW_GUTTER).toBeGreaterThanOrEqual(COMPACT_HOVER_CONTROLS_WIDTH);
    expect(WIDGET_GRID_ROW_GUTTER).toBeLessThan(HOVER_CONTROLS_WIDTH);
    expect(COMPACT_HOVER_CONTROLS_WIDTH - 2).toBe(geometry.row_handle);
  });

  it('renders one row handle and no selection checkbox in the compact controls', () => {
    render(
      <DatabaseContext.Provider value={{ ...createWidgetHost(), activeViewId: 'v1' }}>
        <HoverControls compact rowId='row-a' rowKey='row:row-a' state={{ type: GridDragState.IDLE }} />
      </DatabaseContext.Provider>
    );

    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByTestId('row-add-button')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByTestId('row-accessory-button').closest('[data-parity-id]')?.getAttribute('data-parity-id')).toBe(
      'dash-widget-grid-row-controls'
    );
  });

  it('keeps the compact controls inside a one-line row (36px plus the divider)', () => {
    const { container, rerender } = render(
      <DatabaseContext.Provider value={{ ...createWidgetHost(), activeViewId: 'v1' }}>
        <HoverControls compact rowId='row-a' rowKey='row:row-a' state={{ type: GridDragState.IDLE }} />
      </DatabaseContext.Provider>
    );
    const controls = container.firstElementChild as HTMLElement;

    // 1px border + 6px top padding + the 24px handle + 1px border, and no bottom padding:
    // with py-1.5 the controls are 38px tall and stretch the row past 36 + 1.
    expect(controls.className).toContain('pt-1.5');
    expect(controls.className).not.toContain('py-1.5');
    expect(1 + 6 + geometry.row_handle + 1).toBeLessThanOrEqual(geometry.row_min_height + geometry.row_divider);

    // Standalone grids keep their controls unchanged.
    rerender(
      <DatabaseContext.Provider value={{ ...createWidgetHost(), activeViewId: 'v1' }}>
        <HoverControls rowId='row-a' rowKey='row:row-a' state={{ type: GridDragState.IDLE }} />
      </DatabaseContext.Provider>
    );
    expect((container.firstElementChild as HTMLElement).className).toContain('py-1.5');
  });
});
