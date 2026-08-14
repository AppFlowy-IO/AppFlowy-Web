import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import * as Y from 'yjs';

import { DatabaseContext } from '@/application/database-yjs';
import type { DatabaseContextState, GridGrouping } from '@/application/database-yjs';
import type { YDoc } from '@/application/types';
import { GridProvider } from '@/components/database/grid/GridProvider';
import {
  createGridInteractionStore,
  GridInteractionContext,
  useGridContext,
  useGridInteractionActions,
  useIsGridCellActive,
  useIsGridRowHovered,
} from '@/components/database/grid/useGridContext';

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
});
