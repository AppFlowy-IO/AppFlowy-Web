import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import * as Y from 'yjs';

import { DatabaseContext } from '@/application/database-yjs';
import type { DatabaseContextState, GridGrouping } from '@/application/database-yjs';
import type { YDoc } from '@/application/types';
import { useIsDatabaseHistoryScopeActive } from '@/components/database/databaseHistoryScopeCoordinator';
import { GridProvider } from '@/components/database/grid/GridProvider';
import {
  createGridInteractionStore,
  GridInteractionContext,
  useGridContext,
  useGridHistoryScopeId,
  useGridInteractionActions,
  useIsGridCellActive,
  useIsGridRowHovered,
  useRestoreGridHistoryFocus,
} from '@/components/database/grid/useGridContext';
import { useDatabaseRowHistoryHotkeys } from '@/components/database/hooks/useDatabaseRowHistoryHotkeys';

jest.mock('@/components/database/hooks/useDatabaseRowHistoryHotkeys', () => ({
  useDatabaseRowHistoryHotkeys: jest.fn(),
}));

const mockUseDatabaseRowHistoryHotkeys = jest.mocked(useDatabaseRowHistoryHotkeys);

const grouping: GridGrouping = {
  activeGroupIds: [],
  groups: [],
  hideEmptyGroups: true,
  isGrouped: false,
  ready: true,
  rowOrders: [],
  visibleGroups: [],
};

function createContextValue(): DatabaseContextState {
  return {
    activeViewId: 'view-id',
    databaseDoc: new Y.Doc({ guid: 'database-id' }) as YDoc,
    databasePageId: 'database-id',
    readOnly: false,
    rowMap: {},
    workspaceId: 'workspace-id',
  };
}

describe('GridProvider interaction isolation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('notifies only the interaction channel that changed', () => {
    const store = createGridInteractionStore();
    const activeCellListener = jest.fn();
    const hoverRowListener = jest.fn();

    store.subscribeActiveCell(activeCellListener);
    store.subscribeHoverRowKey(hoverRowListener);

    store.setHoverRowKey('row-a');
    expect(hoverRowListener).toHaveBeenCalledTimes(1);
    expect(activeCellListener).not.toHaveBeenCalled();

    store.setActiveCell({ fieldId: 'status', rowId: 'row-a', rowKey: 'row-a' });
    expect(activeCellListener).toHaveBeenCalledTimes(1);
    expect(hoverRowListener).toHaveBeenCalledTimes(1);
  });

  it('does not subscribe disabled hover selectors', () => {
    const store = createGridInteractionStore();
    const subscribeHoverRowKey = jest.spyOn(store, 'subscribeHoverRowKey');
    let renderCount = 0;

    function DisabledHoverProbe() {
      const hovered = useIsGridRowHovered('row-a', false);

      renderCount += 1;
      return <output>{String(hovered)}</output>;
    }

    render(
      <GridInteractionContext.Provider
        value={{
          historyScopeId: 'test-history-scope',
          restoreHistoryFocus: jest.fn(),
          setActiveCell: store.setActiveCell,
          setHoverRowKey: store.setHoverRowKey,
          store,
        }}
      >
        <DisabledHoverProbe />
      </GridInteractionContext.Provider>
    );

    expect(subscribeHoverRowKey).not.toHaveBeenCalled();

    act(() => store.setHoverRowKey('row-a'));
    expect(renderCount).toBe(1);
  });

  it('rerenders only keyed hover and active-cell subscribers', () => {
    const renders = {
      activeA: 0,
      activeB: 0,
      base: 0,
      hoverA: 0,
      hoverB: 0,
    };

    function BaseProbe() {
      useGridContext();
      renders.base += 1;
      return null;
    }

    function HoverProbe({ rowKey, counter }: { rowKey: string; counter: 'hoverA' | 'hoverB' }) {
      const hovered = useIsGridRowHovered(rowKey);

      renders[counter] += 1;
      return <output data-testid={counter}>{String(hovered)}</output>;
    }

    function ActiveProbe({ rowKey, counter }: { rowKey: string; counter: 'activeA' | 'activeB' }) {
      const active = useIsGridCellActive(rowKey, 'status');

      renders[counter] += 1;
      return <output data-testid={counter}>{String(active)}</output>;
    }

    function Controls() {
      const { setActiveCell, setHoverRowKey } = useGridInteractionActions();

      return (
        <>
          <button onClick={() => setHoverRowKey('row-a')} type='button'>
            Hover A
          </button>
          <button onClick={() => setActiveCell({ fieldId: 'status', rowId: 'row-a', rowKey: 'row-a' })} type='button'>
            Activate A
          </button>
          <button onClick={() => setActiveCell({ fieldId: 'status', rowId: 'row-b', rowKey: 'row-b' })} type='button'>
            Activate B
          </button>
        </>
      );
    }

    render(
      <DatabaseContext.Provider value={createContextValue()}>
        <GridProvider grouping={grouping}>
          <BaseProbe />
          <HoverProbe counter='hoverA' rowKey='row-a' />
          <HoverProbe counter='hoverB' rowKey='row-b' />
          <ActiveProbe counter='activeA' rowKey='row-a' />
          <ActiveProbe counter='activeB' rowKey='row-b' />
          <Controls />
        </GridProvider>
      </DatabaseContext.Provider>
    );

    expect(renders).toEqual({ activeA: 1, activeB: 1, base: 1, hoverA: 1, hoverB: 1 });

    fireEvent.click(screen.getByRole('button', { name: 'Hover A' }));
    expect(screen.getByTestId('hoverA').textContent).toBe('true');
    expect(renders).toEqual({ activeA: 1, activeB: 1, base: 1, hoverA: 2, hoverB: 1 });

    fireEvent.click(screen.getByRole('button', { name: 'Activate A' }));
    expect(screen.getByTestId('activeA').textContent).toBe('true');
    expect(renders).toEqual({ activeA: 2, activeB: 1, base: 1, hoverA: 2, hoverB: 1 });

    fireEvent.click(screen.getByRole('button', { name: 'Activate B' }));
    expect(screen.getByTestId('activeA').textContent).toBe('false');
    expect(screen.getByTestId('activeB').textContent).toBe('true');
    expect(renders).toEqual({ activeA: 3, activeB: 2, base: 1, hoverA: 2, hoverB: 1 });
  });

  it('scopes wheel suppression to the Grid and reports row heights without provider rerenders', () => {
    const resizeListener = jest.fn();
    let baseRenderCount = 0;

    function Probe() {
      const hovered = useIsGridRowHovered('row-a');

      return <output data-testid='hover-state'>{String(hovered)}</output>;
    }

    function Controls() {
      const { rowResizeStore } = useGridContext();
      const { setHoverRowKey } = useGridInteractionActions();

      baseRenderCount += 1;
      useEffect(() => rowResizeStore.subscribe(resizeListener), [rowResizeStore]);

      return (
        <>
          <button onClick={() => setHoverRowKey('row-a')} type='button'>
            Hover row
          </button>
          <button onClick={() => rowResizeStore.report('row-a', 48)} type='button'>
            Report height
          </button>
        </>
      );
    }

    const { container } = render(
      <DatabaseContext.Provider value={createContextValue()}>
        <GridProvider grouping={grouping}>
          <Probe />
          <Controls />
        </GridProvider>
      </DatabaseContext.Provider>
    );
    const gridRoot = container.firstElementChild as HTMLElement;

    fireEvent.click(screen.getByRole('button', { name: 'Hover row' }));
    expect(screen.getByTestId('hover-state').textContent).toBe('true');

    fireEvent.wheel(document.body);
    expect(screen.getByTestId('hover-state').textContent).toBe('true');

    fireEvent.wheel(gridRoot);
    expect(screen.getByTestId('hover-state').textContent).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'Report height' }));
    expect(resizeListener).toHaveBeenCalledWith('row-a', 48);
    expect(baseRenderCount).toBe(1);
  });

  it('restores history focus after a grid-owned modal editor closes', () => {
    function Controls() {
      const { setActiveCell } = useGridInteractionActions();
      const historyScopeId = useGridHistoryScopeId();
      const restoreHistoryFocus = useRestoreGridHistoryFocus();

      return (
        <>
          <button
            onClick={() => setActiveCell({ fieldId: 'status', rowId: 'row-a', rowKey: 'row-a' })}
            type='button'
          >
            Activate cell
          </button>
          <button
            onClick={() => {
              restoreHistoryFocus?.();
              setActiveCell(undefined);
            }}
            type='button'
          >
            Close editor
          </button>
          {createPortal(
            <button data-database-history-scope={historyScopeId} type='button'>
              Portaled editor
            </button>,
            document.body
          )}
        </>
      );
    }

    const { container } = render(
      <DatabaseContext.Provider value={createContextValue()}>
        <GridProvider grouping={grouping}>
          <Controls />
        </GridProvider>
      </DatabaseContext.Provider>
    );
    const gridRoot = container.firstElementChild as HTMLElement;

    fireEvent.pointerDown(gridRoot);
    fireEvent.click(screen.getByRole('button', { name: 'Activate cell' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Portaled editor' }));

    expect(mockUseDatabaseRowHistoryHotkeys).toHaveBeenLastCalledWith(undefined, {
      enabled: true,
      ignoreInput: true,
      useLatest: true,
    });

    fireEvent.pointerDown(document.documentElement);

    expect(mockUseDatabaseRowHistoryHotkeys).toHaveBeenLastCalledWith(undefined, {
      enabled: false,
      ignoreInput: true,
      useLatest: true,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }));

    expect(mockUseDatabaseRowHistoryHotkeys).toHaveBeenLastCalledWith(undefined, {
      enabled: true,
      ignoreInput: true,
      useLatest: true,
    });

    fireEvent.pointerDown(document.documentElement);

    expect(mockUseDatabaseRowHistoryHotkeys).toHaveBeenLastCalledWith(undefined, {
      enabled: false,
      ignoreInput: true,
      useLatest: true,
    });
  });

  it('assigns a distinct history scope to each grid instance', () => {
    const { container } = render(
      <DatabaseContext.Provider value={createContextValue()}>
        <GridProvider grouping={grouping}>
          <span>Grid A</span>
        </GridProvider>
        <GridProvider grouping={grouping}>
          <span>Grid B</span>
        </GridProvider>
      </DatabaseContext.Provider>
    );
    const scopeElements = container.querySelectorAll('[data-database-history-scope]');

    expect(scopeElements).toHaveLength(2);
    expect(scopeElements[0].getAttribute('data-database-history-scope')).not.toBe(
      scopeElements[1].getAttribute('data-database-history-scope')
    );
    expect(screen.getByText('Grid A').closest('[data-database-history-scope]')).toBe(scopeElements[0]);
    expect(screen.getByText('Grid B').closest('[data-database-history-scope]')).toBe(scopeElements[1]);
  });

  it('keeps history ownership exclusive when focus moves or a grid restores it', () => {
    function RestoreHistoryButton({ name }: { name: string }) {
      const historyScopeId = useGridHistoryScopeId();
      const restoreHistoryFocus = useRestoreGridHistoryFocus();
      const isHistoryScopeActive = useIsDatabaseHistoryScopeActive(historyScopeId ?? '');

      return (
        <>
          <output data-testid={`history-scope-${name}`}>{String(isHistoryScopeActive)}</output>
          <button onClick={() => restoreHistoryFocus?.()} type='button'>
            Restore {name}
          </button>
        </>
      );
    }

    render(
      <DatabaseContext.Provider value={createContextValue()}>
        <GridProvider grouping={grouping}>
          <span>Grid A</span>
          <RestoreHistoryButton name='A' />
        </GridProvider>
        <GridProvider grouping={grouping}>
          <span>Grid B</span>
          <RestoreHistoryButton name='B' />
        </GridProvider>
      </DatabaseContext.Provider>
    );
    const gridA = screen.getByText('Grid A').closest('[data-database-history-scope]') as HTMLElement;
    const gridB = screen.getByText('Grid B').closest('[data-database-history-scope]') as HTMLElement;

    fireEvent.pointerDown(gridA);

    expect(screen.getByTestId('history-scope-A').textContent).toBe('true');
    expect(screen.getByTestId('history-scope-B').textContent).toBe('false');

    fireEvent.pointerDown(gridB);

    expect(screen.getByTestId('history-scope-A').textContent).toBe('false');
    expect(screen.getByTestId('history-scope-B').textContent).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Restore A' }));

    expect(screen.getByTestId('history-scope-A').textContent).toBe('true');
    expect(screen.getByTestId('history-scope-B').textContent).toBe('false');

    fireEvent.pointerDown(document.documentElement);

    expect(screen.getByTestId('history-scope-A').textContent).toBe('false');
    expect(screen.getByTestId('history-scope-B').textContent).toBe('false');
  });

  it('shares one document pointer listener across grid instances', () => {
    const addEventListener = jest.spyOn(document, 'addEventListener');
    const removeEventListener = jest.spyOn(document, 'removeEventListener');
    const { unmount } = render(
      <DatabaseContext.Provider value={createContextValue()}>
        <GridProvider grouping={grouping}>
          <span>Grid A</span>
        </GridProvider>
        <GridProvider grouping={grouping}>
          <span>Grid B</span>
        </GridProvider>
      </DatabaseContext.Provider>
    );

    expect(addEventListener.mock.calls.filter(([type]) => type === 'pointerdown')).toHaveLength(1);

    unmount();

    expect(removeEventListener.mock.calls.filter(([type]) => type === 'pointerdown')).toHaveLength(1);
  });
});
