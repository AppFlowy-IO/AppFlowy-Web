import {
  ComponentProps,
  RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { useUpdateDatabaseLayout } from '@/application/database-yjs/dispatch';
import { DatabaseViewLayout } from '@/application/types';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';

import { DASHBOARD_POPOVER_RADIUS } from '../constants';
import { useDashboardUi } from '../DashboardUiContext';

import { useAddWidgetFlowState } from './add-widget-api';
import { AddWidgetFlowState, isAddWidgetPopoverOpen } from './add-widget-flow';
import { DOCK_WIDTH, dockMaxHeight, dockPopperProps, dockedPopoverSide, DockSide } from './docked-popover';
import { NewViewConfigPanel } from './NewViewConfigPanel';
import { AddFlowViewApi } from './useAddWidgetFlow';
import { WidgetAddPicker } from './WidgetAddPicker';
import { WidgetSourcePanel } from './WidgetSourcePanel';

const identity = (state: AddWidgetFlowState) => state;

/**
 * Binds the flow's own view to `useUpdateDatabaseLayout`, so a type pick
 * switches it in place (board groups, calendar and timeline date fields, list
 * and gallery set-up) without an undo step.
 */
function AddFlowViewBinding({ viewId, bind }: { viewId: string; bind: (api: AddFlowViewApi | null) => void }) {
  const updateLayout = useUpdateDatabaseLayout(viewId);

  useEffect(() => {
    bind({ viewId, switchLayout: (layout: DatabaseViewLayout) => updateLayout(layout, { history: 'skip' }) });
    return () => bind(null);
  }, [bind, updateLayout, viewId]);
  return null;
}

/** The registered dock anchor of a widget (re-read when the pending slot hands over to the widget). */
function useDockAnchor(widgetId: string | null) {
  const { addWidget } = useDashboardUi();
  const { dockAnchors } = addWidget;
  const getSnapshot = useCallback(() => (widgetId ? dockAnchors.get(widgetId) : null), [dockAnchors, widgetId]);

  return useSyncExternalStore(dockAnchors.subscribe, getSnapshot, getSnapshot);
}

interface WidgetDockHostProps {
  /** The widget whose Settings › Source panel is open, if any. */
  sourceWidgetId: string | null;
  closeSourcePanel: () => void;
  bindFlowView: (api: AddFlowViewApi | null) => void;
  /** The dashboard's scroll container: the dock's side is decided against its right edge. */
  scrollRef: RefObject<HTMLElement>;
}

/**
 * The dock beside a widget box (WP06 §1.6, §1.8): the "New view" picker and
 * the New view panel of the add flow, or the Source panel. One Radix popover
 * anchored to the widget's zero-size dock anchor at its top-right corner,
 * opening right when there is room and left otherwise (`dockedPopoverSide`),
 * top-aligned and clamped to the viewport; it follows the box while the page
 * scrolls and closes when the widget unmounts. An outside click or Escape
 * dismisses it (the widget stays).
 */
export function WidgetDockHost({ sourceWidgetId, closeSourcePanel, bindFlowView, scrollRef }: WidgetDockHostProps) {
  const { addWidget } = useDashboardUi();
  const { flow } = addWidget;
  const state = useAddWidgetFlowState(flow, identity);
  const flowOpen = isAddWidgetPopoverOpen(state);
  const widgetId = flowOpen && state.kind !== 'idle' ? state.widgetId : sourceWidgetId;
  const anchor = useDockAnchor(widgetId);
  const anchorRef = useRef<HTMLElement | null>(null);
  const [placement, setPlacement] = useState<{ side: DockSide; maxHeight: number }>({ side: 'right', maxHeight: 560 });

  anchorRef.current = anchor;

  // The side follows the anchor's place in the dashboard: decided when the dock opens and on resize.
  useLayoutEffect(() => {
    if (!anchor) return;
    const update = () => {
      const rect = anchor.getBoundingClientRect();
      const viewportRight = scrollRef.current?.getBoundingClientRect().right ?? window.innerWidth;
      const next = {
        side: dockedPopoverSide(rect.right, Math.min(viewportRight, window.innerWidth)),
        maxHeight: dockMaxHeight(rect.top, window.innerHeight),
      };

      setPlacement((current) => (current.side === next.side && current.maxHeight === next.maxHeight ? current : next));
    };

    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [anchor, scrollRef]);

  const open = Boolean(anchor) && (flowOpen || sourceWidgetId !== null);
  const dismiss = () => {
    if (flowOpen) flow.dispatch({ type: 'dismiss' });
    else closeSourcePanel();
  };

  const panel =
    state.kind === 'configuring'
      ? 'config'
      : flowOpen && (state.kind === 'creating' || state.kind === 'choosing_existing' || state.kind === 'open')
      ? 'picker'
      : sourceWidgetId
      ? 'source'
      : null;
  const flowViewId =
    state.kind === 'open' || state.kind === 'configuring' || state.kind === 'settings' ? state.viewId : null;

  return (
    <>
      {flowViewId ? <AddFlowViewBinding bind={bindFlowView} viewId={flowViewId} /> : null}
      <Popover
        modal={false}
        onOpenChange={(next) => {
          if (!next) dismiss();
        }}
        open={open && panel !== null}
      >
        <PopoverAnchor virtualRef={anchorRef as ComponentProps<typeof PopoverAnchor>['virtualRef']} />
        {open && panel ? (
          <PopoverContent
            {...dockPopperProps(placement.side)}
            className='flex flex-col overflow-hidden border border-border-primary bg-surface-primary p-2 shadow-menu'
            data-mode={panel === 'source' ? 'replace' : 'add'}
            data-parity-id={panel === 'picker' || panel === 'source' ? 'dash-widget-picker' : undefined}
            data-side={placement.side}
            data-state={state.kind === 'creating' ? 'creating' : 'ready'}
            data-testid={panel === 'config' ? 'dashboard-widget-new-view-panel' : 'dashboard-widget-picker'}
            data-widget-id={widgetId ?? undefined}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              (event.currentTarget as HTMLElement | null)
                ?.querySelector<HTMLElement>('[data-dock-autofocus="true"]')
                ?.focus();
            }}
            style={{
              width: DOCK_WIDTH,
              minWidth: DOCK_WIDTH,
              borderRadius: DASHBOARD_POPOVER_RADIUS,
              maxHeight: placement.maxHeight,
            }}
          >
            {panel === 'picker' && (state.kind === 'creating' || state.kind === 'choosing_existing' || state.kind === 'open') ? (
              <WidgetAddPicker state={state} />
            ) : panel === 'config' && state.kind === 'configuring' ? (
              <NewViewConfigPanel state={state} />
            ) : panel === 'source' && sourceWidgetId ? (
              <WidgetSourcePanel onClose={closeSourcePanel} widgetId={sourceWidgetId} />
            ) : null}
          </PopoverContent>
        ) : null}
      </Popover>
    </>
  );
}

export default WidgetDockHost;
