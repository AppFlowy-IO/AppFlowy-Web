import { fireEvent, render, screen } from '@testing-library/react';

import { DatabaseViewLayout, ViewLayout } from '@/application/types';

import { AddWidgetFlowEvent, AddWidgetFlowState } from '../add-widget-flow';
import { NewViewConfigPanel } from '../NewViewConfigPanel';

let mockViewName = 'Board';
const mockDispatch = jest.fn<void, [AddWidgetFlowEvent]>();
const mockOpenSourcePanel = jest.fn();

jest.mock('@/application/database-yjs', () => ({ useDatabase: () => undefined }));
jest.mock('../../DashboardContext', () => ({
  useDashboardContext: () => ({ hostDatabaseId: 'host-db', dashboardViewId: 'dash' }),
}));
jest.mock('../../DashboardUiContext', () => ({
  useDashboardUi: () => ({
    addWidget: {
      flow: { getState: () => ({ kind: 'idle' }), subscribe: () => () => undefined, dispatch: mockDispatch },
      openSourcePanel: mockOpenSourcePanel,
    },
  }),
}));
jest.mock('../../hooks/useHostViews', () => ({
  useHostViews: () => [{ viewId: 'v1', name: mockViewName, layout: ViewLayout.Board, embedded: false }],
}));
jest.mock('../../hooks/useWidgetSourceName', () => ({ useWidgetSourceName: () => 'Projects' }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));
jest.mock('@/components/_shared/view-icon', () => ({ ViewIcon: () => null }));

function state(layout: DatabaseViewLayout): Extract<AddWidgetFlowState, { kind: 'configuring' }> {
  return { kind: 'configuring', widgetId: 'w:new', viewId: 'v1', layout, autoNamed: true };
}

function tiles() {
  return screen.getAllByTestId('dashboard-widget-new-view-panel-tile');
}

beforeEach(() => {
  mockViewName = 'Board';
  mockDispatch.mockClear();
  mockOpenSourcePanel.mockClear();
});

describe('NewViewConfigPanel', () => {
  it('lists the layout tiles in Notion order with the current one selected', () => {
    render(<NewViewConfigPanel state={state(DatabaseViewLayout.Board)} />);

    expect(tiles().map((tile) => tile.textContent)).toEqual([
      'Table',
      'Board',
      'Timeline',
      'Calendar',
      'List',
      'Gallery',
      'Chart',
      'Feed',
    ]);
    expect(
      tiles()
        .filter((tile) => tile.getAttribute('data-selected') === 'true')
        .map((tile) => tile.textContent)
    ).toEqual(['Board']);
  });

  it('offers Timeline by default', () => {
    render(<NewViewConfigPanel state={state(DatabaseViewLayout.Board)} />);

    expect(tiles().map((tile) => tile.textContent)).toContain('Timeline');
  });

  it('switches the view from a tile', () => {
    render(<NewViewConfigPanel state={state(DatabaseViewLayout.Board)} />);

    fireEvent.click(tiles().find((tile) => tile.textContent === 'Calendar') as HTMLElement);
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'pick_tile', layout: DatabaseViewLayout.Calendar });
  });

  it('shows the view name focused, commits on blur and on Enter, and reverts on Escape', () => {
    render(<NewViewConfigPanel state={state(DatabaseViewLayout.Board)} />);
    const name = screen.getByTestId<HTMLInputElement>('dashboard-widget-new-view-panel-name');

    expect(name.value).toBe('Board');
    expect(document.activeElement).toBe(name);
    fireEvent.change(name, { target: { value: 'Pipeline' } });
    fireEvent.blur(name);
    expect(mockDispatch).toHaveBeenLastCalledWith({ type: 'rename', name: 'Pipeline' });

    fireEvent.change(name, { target: { value: 'Roadmap ' } });
    fireEvent.keyDown(name, { key: 'Enter' });
    expect(mockDispatch).toHaveBeenLastCalledWith({ type: 'rename', name: 'Roadmap' });

    mockDispatch.mockClear();
    fireEvent.change(name, { target: { value: 'Typo' } });
    fireEvent.keyDown(name, { key: 'Escape' });
    expect(name.value).toBe('Board');
    fireEvent.change(name, { target: { value: '   ' } });
    fireEvent.blur(name);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('offers Edit chart and the Source row only for a chart', () => {
    const { rerender } = render(<NewViewConfigPanel state={state(DatabaseViewLayout.Board)} />);

    expect(screen.queryByTestId('dashboard-widget-edit-chart')).toBeNull();
    rerender(<NewViewConfigPanel state={state(DatabaseViewLayout.Chart)} />);
    fireEvent.click(screen.getByTestId('dashboard-widget-edit-chart'));
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'edit_chart' });
    expect(screen.getByTestId('dashboard-widget-new-view-panel-source').textContent).toContain('Projects');
    fireEvent.click(screen.getByTestId('dashboard-widget-new-view-panel-source'));
    expect(mockOpenSourcePanel).toHaveBeenCalledWith('w:new');
  });

  it('goes back to the list and closes from its header', () => {
    render(<NewViewConfigPanel state={state(DatabaseViewLayout.Board)} />);

    fireEvent.click(screen.getByTestId('dashboard-widget-new-view-panel-back'));
    fireEvent.click(screen.getByTestId('dashboard-widget-new-view-panel-close'));
    expect(mockDispatch.mock.calls).toEqual([[{ type: 'back' }], [{ type: 'dismiss' }]]);
  });

  it('renames once when Enter is followed by a blur before the rename lands', () => {
    render(<NewViewConfigPanel state={state(DatabaseViewLayout.Board)} />);
    const name = screen.getByTestId<HTMLInputElement>('dashboard-widget-new-view-panel-name');

    fireEvent.change(name, { target: { value: 'Pipeline' } });
    fireEvent.keyDown(name, { key: 'Enter' });
    // Enter keeps the focus; a tile or Back blurs the field before the async rename landed.
    fireEvent.blur(name);
    expect(mockDispatch.mock.calls).toEqual([[{ type: 'rename', name: 'Pipeline' }]]);

    // An edited name is a new rename.
    fireEvent.change(name, { target: { value: 'Roadmap' } });
    fireEvent.blur(name);
    expect(mockDispatch).toHaveBeenLastCalledWith({ type: 'rename', name: 'Roadmap' });
    expect(mockDispatch).toHaveBeenCalledTimes(2);
  });

  it('follows the view name once the rename lands, and renames nothing more on blur', () => {
    const { rerender } = render(<NewViewConfigPanel state={state(DatabaseViewLayout.Board)} />);
    const name = screen.getByTestId<HTMLInputElement>('dashboard-widget-new-view-panel-name');

    fireEvent.change(name, { target: { value: 'Pipeline' } });
    fireEvent.keyDown(name, { key: 'Enter' });
    mockViewName = 'Pipeline';
    rerender(<NewViewConfigPanel state={state(DatabaseViewLayout.Board)} />);
    expect(name.value).toBe('Pipeline');
    fireEvent.blur(name);
    expect(mockDispatch).toHaveBeenCalledTimes(1);

    // A type pick renames an untouched name: the field shows it at once.
    mockViewName = 'Calendar';
    rerender(<NewViewConfigPanel state={state(DatabaseViewLayout.Calendar)} />);
    expect(name.value).toBe('Calendar');

    // The view gets its first name back (a collaborator): the old draft stays gone.
    mockViewName = 'Board';
    rerender(<NewViewConfigPanel state={state(DatabaseViewLayout.Calendar)} />);
    expect(name.value).toBe('Board');
  });
});
