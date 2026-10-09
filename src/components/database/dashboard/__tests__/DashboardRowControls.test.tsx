import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useRef, useState } from 'react';

import { getDashboardAddToNewRowState, getDashboardRowControls } from '@/application/database-yjs/dashboard-layout';
import { DashboardRow as DashboardRowData } from '@/application/database-yjs/dashboard.type';
import { UIVariant } from '@/application/types';

import { DashboardRow } from '../DashboardRow';
import { AddToNewRowButton, ROW_CONTROL_REVEAL_CLASS } from '../DashboardRowControls';
import { DashboardHostContext, DashboardHostServices, DashboardUiContext } from '../DashboardUiContext';

import { createDashboardUiValue } from './dashboardTestHarness';

jest.mock('react-i18next', () => {
  const t = (key: string, options?: Record<string, unknown> & { defaultValue?: string }) =>
    (options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name]));

  return { useTranslation: () => ({ t }) };
});

jest.mock('../DashboardWidget', () => ({
  DashboardWidget: ({ widget }: { widget: { id: string } }) => (
    <div data-testid='dashboard-widget' data-widget-id={widget.id} />
  ),
}));

/** Rows of `counts[i]` widgets each, ids `r1…` and `w1…` in reading order. */
function makeRows(...counts: number[]): DashboardRowData[] {
  let next = 0;

  return counts.map((count, rowIndex) => ({
    id: `r${rowIndex + 1}`,
    height: 360,
    widgets: Array.from({ length: count }, () => {
      next += 1;
      return { id: `w${next}`, viewId: `v${next}`, databaseId: 'db', width: 12 / count };
    }),
  }));
}

const mockAnnounce = jest.fn();
const mockStartAddWidget = jest.fn();
const mockUpdateRows = jest.fn();

/** The rows as the grid renders them: each with its `getDashboardRowControls`. */
function Rows({ initialRows }: { initialRows: DashboardRowData[] }) {
  const [rows, setRows] = useState(initialRows);
  const rowsRef = useRef(rows);

  rowsRef.current = rows;
  const [ui] = useState(() =>
    createDashboardUiValue({
      announce: mockAnnounce,
      startAddWidget: mockStartAddWidget,
      getRows: () => rowsRef.current,
      updateRows: (updater) => {
        mockUpdateRows(updater);
        setRows((current) => updater(current));
        return true;
      },
    })
  );
  const host = { workspaceId: 'workspace-id', variant: UIVariant.App } as DashboardHostServices;

  return (
    <DashboardHostContext.Provider value={host}>
      <DashboardUiContext.Provider value={ui}>
        {rows.map((row, rowIndex) => {
          const controls = getDashboardRowControls(rows, row.id);

          return (
            <DashboardRow
              addToRow={controls.addToRow}
              canEdit
              canMoveDown={controls.moveDown}
              canMoveUp={controls.moveUp}
              isEditing
              key={row.id}
              minColumns={1}
              pendingSpec={null}
              pendingWidgetId={null}
              row={row}
              rowIndex={rowIndex}
              showIconsInHeading={false}
              showWidgetTitles
              wrapColumns={row.widgets.length}
            />
          );
        })}
        <output data-testid='order'>{rows.map((row) => row.id).join(',')}</output>
        <output data-testid='add-to-new-row-state'>{getDashboardAddToNewRowState(rows)}</output>
      </DashboardUiContext.Provider>
    </DashboardHostContext.Provider>
  );
}

const rowElement = (rowId: string) =>
  screen.getAllByTestId('dashboard-row').find((element) => element.dataset.rowId === rowId) as HTMLElement;
const movesOf = (rowId: string) =>
  within(rowElement(rowId))
    .queryAllByTestId(/^dashboard-row-move-(up|down)$/)
    .map((button) => button.getAttribute('data-testid')?.replace('dashboard-row-move-', ''));
const moveButton = (rowId: string, control: 'up' | 'down') =>
  within(rowElement(rowId)).getByTestId(`dashboard-row-move-${control}`);

beforeEach(() => {
  mockAnnounce.mockClear();
  mockStartAddWidget.mockClear();
  mockUpdateRows.mockClear();
});

describe('row move control', () => {
  it('offers ↓ on the first row, ↑ over ↓ in the middle and ↑ on the last', () => {
    render(<Rows initialRows={makeRows(1, 1, 1)} />);

    expect(movesOf('r1')).toEqual(['down']);
    expect(movesOf('r2')).toEqual(['up', 'down']);
    expect(movesOf('r3')).toEqual(['up']);
    expect(moveButton('r2', 'up').getAttribute('aria-label')).toBe('Move up');
    expect(moveButton('r2', 'down').getAttribute('aria-label')).toBe('Move down');
  });

  it('gives a single row no move control', () => {
    render(<Rows initialRows={makeRows(2)} />);

    expect(screen.queryByTestId('dashboard-row-move-control')).toBeNull();
    expect(screen.getByTestId('dashboard-add-widget-row-button')).toBeTruthy();
  });

  it('is a 24px pill for two arrows and a 24px circle for one, with the parity ids', () => {
    render(<Rows initialRows={makeRows(1, 1, 1)} />);
    const middle = within(rowElement('r2')).getByTestId('dashboard-row-move-control');

    expect(middle.getAttribute('data-parity-id')).toBe('dash-row-control-move');
    expect(middle.className).toContain('rounded-full');
    expect(middle.className).toContain('bg-dash-row-control-bg');
    expect(middle.style.width).toBe('24px');
    expect(
      within(middle)
        .getAllByRole('button')
        .map((button) => [button.getAttribute('data-parity-id'), button.style.width, button.style.height])
    ).toEqual([
      ['dash-row-control-move-up', '24px', '24px'],
      ['dash-row-control-move-down', '24px', '24px'],
    ]);
    expect(middle.querySelector('[data-parity-id="dash-row-control-move-up__icon"]')).not.toBeNull();
    expect(middle.querySelector('[data-parity-id="dash-row-control-move-down__icon"]')).not.toBeNull();
    // Centred 30px outside the column: 24px from the 42px strip that starts at the 6px box bleed.
    expect(middle.style.right).toBe('24px');
    expect(middle.style.transform).toBe('translate(50%, -50%)');
    const strip = middle.parentElement as HTMLElement;

    expect(strip.getAttribute('data-testid')).toBe('dashboard-row-control-anchor');
    expect(strip.style.width).toBe('42px');
    expect(strip.style.right).toBe('calc(100% + 6px)');
  });

  it('moves the row down in one write and tells assistive technology', () => {
    render(<Rows initialRows={makeRows(2, 1, 1)} />);

    fireEvent.click(moveButton('r1', 'down'));

    expect(mockUpdateRows).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('order').textContent).toBe('r2,r1,r3');
    // The row keeps its widgets and widths.
    expect(within(rowElement('r1')).getAllByTestId('dashboard-widget').map((widget) => widget.dataset.widgetId)).toEqual([
      'w1',
      'w2',
    ]);
    expect(mockAnnounce.mock.calls).toEqual([['Row moved down']]);

    fireEvent.click(moveButton('r1', 'up'));
    expect(screen.getByTestId('order').textContent).toBe('r1,r2,r3');
    expect(mockAnnounce.mock.calls[1]).toEqual(['Row moved up']);
  });

  it('keeps the focus on the moved row: on the remaining arrow when the pressed one disappears', () => {
    render(<Rows initialRows={makeRows(1, 1, 1)} />);
    const down = moveButton('r2', 'down');

    act(() => down.focus());
    fireEvent.click(down);

    expect(screen.getByTestId('order').textContent).toBe('r1,r3,r2');
    expect(movesOf('r2')).toEqual(['up']);
    expect(document.activeElement).toBe(moveButton('r2', 'up'));
  });

  it('keeps the focus on the same arrow when it is still there', () => {
    render(<Rows initialRows={makeRows(1, 1, 1, 1)} />);
    const up = moveButton('r3', 'up');

    act(() => up.focus());
    fireEvent.click(up);

    expect(screen.getByTestId('order').textContent).toBe('r1,r3,r2,r4');
    expect(document.activeElement).toBe(moveButton('r3', 'up'));
  });

  it('writes nothing for a move the row cannot make', () => {
    render(<Rows initialRows={makeRows(1, 1)} />);

    expect(within(rowElement('r1')).queryByTestId('dashboard-row-move-up')).toBeNull();
    expect(mockUpdateRows).not.toHaveBeenCalled();
  });
});

describe('row add control', () => {
  it('is absent for a row of four widgets', () => {
    render(<Rows initialRows={makeRows(4, 1)} />);

    expect(within(rowElement('r1')).queryByTestId('dashboard-add-widget-row-button')).toBeNull();
    expect(within(rowElement('r2')).getByTestId('dashboard-add-widget-row-button')).toBeTruthy();
  });

  it('adds to the end of its row', () => {
    render(<Rows initialRows={makeRows(2, 1)} />);
    const add = within(rowElement('r1')).getByTestId('dashboard-add-widget-row-button');

    expect(add.getAttribute('data-parity-id')).toBe('dash-row-control-add');
    expect(add.querySelector('[data-parity-id="dash-row-control-add__icon"]')).not.toBeNull();
    fireEvent.click(add);
    expect(mockStartAddWidget.mock.calls).toEqual([[{ type: 'existing_row', rowId: 'r1', index: 2 }]]);
  });

  it('is disabled with the two-line full tooltip on a full dashboard, and announces instead of adding', async () => {
    render(<Rows initialRows={makeRows(4, 4, 3, 1)} />);
    const add = within(rowElement('r3')).getByTestId('dashboard-add-widget-row-button');

    expect(within(rowElement('r1')).queryByTestId('dashboard-add-widget-row-button')).toBeNull();
    expect(add.getAttribute('aria-disabled')).toBe('true');
    expect(add.className).toContain('opacity-40');
    expect(add.className).toContain('cursor-default');

    act(() => add.focus());
    const tooltip = await screen.findByTestId('dashboard-full-tooltip');
    const [title, hint] = Array.from(tooltip.children);

    expect(title.textContent).toBe('Dashboard is full');
    expect(title.className).toContain('font-semibold');
    expect(hint.textContent).toBe('Delete a view to add a new one');
    expect(hint.className).toContain('opacity-70');
    expect(tooltip.getAttribute('data-parity-id')).toBe('dash-tooltip');

    fireEvent.click(add);
    expect(mockStartAddWidget).not.toHaveBeenCalled();
    expect(mockAnnounce.mock.calls).toEqual([['Dashboard is full. Delete a view to add a new one.']]);
    expect(screen.getByTestId('add-to-new-row-state').textContent).toBe('disabled');
  });

  it('names the action in a dashboard tooltip', async () => {
    render(<Rows initialRows={makeRows(1, 1)} />);

    act(() => within(rowElement('r1')).getByTestId('dashboard-add-widget-row-button').focus());
    const tooltip = await screen.findByText('Add to row', { selector: '[data-parity-id="dash-tooltip"]' });

    expect(tooltip.className).toContain('bg-dash-toast-bg');
    expect(tooltip.className).toContain('text-xs');
    expect(tooltip.className).toContain('!rounded-300');
  });
});

describe('reveal', () => {
  it('fades the controls in while the row is hovered or holds the focus, over the fast motion', () => {
    render(<Rows initialRows={makeRows(1, 1)} />);
    const move = within(rowElement('r1')).getByTestId('dashboard-row-move-control');
    const add = within(rowElement('r1')).getByTestId('dashboard-add-widget-row-button').parentElement as HTMLElement;

    expect(rowElement('r1').className).toContain('group/row');
    for (const element of [move, add]) {
      const classes = element.className.split(' ');

      expect(classes).toEqual(expect.arrayContaining(ROW_CONTROL_REVEAL_CLASS.split(' ')));
      expect(classes).toEqual(
        expect.arrayContaining([
          'opacity-0',
          'transition-opacity',
          'duration-[var(--dash-motion-fast)]',
          'ease-[var(--dash-motion-ease)]',
          'group-hover/row:opacity-100',
          'group-focus-within/row:opacity-100',
          '[@media(hover:none)]:opacity-100',
          'motion-reduce:transition-none',
        ])
      );
    }
  });
});

describe('drop line', () => {
  it('draws the vertical line of a drag into this row only, 2px wide and centred on the stored x', () => {
    const ui = createDashboardUiValue();
    const host = { workspaceId: 'workspace-id', variant: UIVariant.App } as DashboardHostServices;
    const rows = makeRows(2, 1);

    render(
      <DashboardHostContext.Provider value={host}>
        <DashboardUiContext.Provider value={ui}>
          {rows.map((row, rowIndex) => (
            <DashboardRow
              addToRow='enabled'
              canEdit
              canMoveDown={rowIndex === 0}
              canMoveUp={rowIndex === 1}
              isEditing
              key={row.id}
              minColumns={1}
              pendingSpec={null}
              pendingWidgetId={null}
              row={row}
              rowIndex={rowIndex}
              showIconsInHeading={false}
              showWidgetTitles
              wrapColumns={row.widgets.length}
            />
          ))}
        </DashboardUiContext.Provider>
      </DashboardHostContext.Provider>
    );

    expect(screen.queryByTestId('dashboard-drop-indicator')).toBeNull();
    act(() => ui.dropIndicatorStore.set({ widgetId: 'w2', rowId: 'r1', left: 312, top: 40, height: 314 }));

    const line = screen.getByTestId('dashboard-drop-indicator');

    expect(line.getAttribute('data-orientation')).toBe('vertical');
    expect(rowElement('r1').contains(line)).toBe(true);
    expect([line.style.left, line.style.top, line.style.width, line.style.height]).toEqual([
      '311px',
      '40px',
      '2px',
      '314px',
    ]);
    expect(line.className).toContain('bg-dash-accent');
    act(() => ui.dropIndicatorStore.clear('w1'));
    expect(screen.getByTestId('dashboard-drop-indicator')).toBe(line);
    act(() => ui.dropIndicatorStore.clear('w2'));
    expect(screen.queryByTestId('dashboard-drop-indicator')).toBeNull();
  });
});

describe('AddToNewRowButton', () => {
  function renderButton(props: Partial<Parameters<typeof AddToNewRowButton>[0]> = {}) {
    const handlers = { onAdd: jest.fn(), onRefuse: jest.fn(), onPreload: jest.fn() };

    render(<AddToNewRowButton hidden={false} state='enabled' {...handlers} {...props} />);
    return { ...handlers, button: screen.getByTestId('dashboard-add-widget-button') };
  }

  it('is a 28px tinted circle with the accent "+", named "Add to new row"', () => {
    const { button, onAdd, onPreload } = renderButton();

    expect([button.style.width, button.style.height]).toEqual(['28px', '28px']);
    expect(button.className).toContain('rounded-full');
    expect(button.className).toContain('bg-dash-row-control-bg');
    expect(button.className).toContain('text-dash-accent');
    expect(button.getAttribute('aria-label')).toBe('Add to new row');
    expect(button.getAttribute('data-parity-id')).toBe('dash-grid-add-row');
    expect(button.querySelector('[data-parity-id="dash-grid-add-row__icon"]')).not.toBeNull();
    expect(button.querySelector('[data-parity-id="dash-grid-add-row__label"]')?.textContent).toBe('Add to new row');
    fireEvent.pointerEnter(button);
    fireEvent.click(button);
    expect(onPreload).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('refuses on a full dashboard: aria-disabled, the full tooltip, an announcement', async () => {
    const { button, onAdd, onRefuse } = renderButton({ state: 'disabled' });

    expect(button.getAttribute('aria-disabled')).toBe('true');
    act(() => button.focus());
    const tooltip = await screen.findByTestId('dashboard-full-tooltip');

    expect(tooltip.textContent).toContain('Dashboard is full');
    expect(tooltip.textContent).toContain('Delete a view to add a new one');
    fireEvent.click(button);
    expect(onAdd).not.toHaveBeenCalled();
    expect(onRefuse).toHaveBeenCalledTimes(1);
  });

  it('gives way to the drop zone below the last row while a widget is dragged', () => {
    const { button } = renderButton({ hidden: true });
    const slot = button.closest('[data-testid="dashboard-add-row-slot"]') as HTMLElement;

    expect(slot.getAttribute('data-hidden')).toBe('true');
    expect(slot.className).toContain('opacity-0');
    expect(slot.className).toContain('pointer-events-none');
  });
});
