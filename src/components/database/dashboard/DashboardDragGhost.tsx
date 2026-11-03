import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

import { ViewIcon as LayoutGlyph } from '@/components/_shared/view-icon/ViewIcon';

import { WIDGET_BOX_PADDING, WIDGET_HEADER_HEIGHT, WIDGET_HEADER_PADDING } from './constants';

import type { DragGhostStore } from './arrange-stores';

const BOX_PADDING = `0 ${WIDGET_BOX_PADDING}px ${WIDGET_BOX_PADDING}px`;
const HEADER_STYLE = { height: WIDGET_HEADER_HEIGHT, padding: WIDGET_HEADER_PADDING };

/**
 * The drag ghost of a widget (WP04 §2.4, the same structure as desktop's
 * `DashboardWidgetGhost`): a light replica at the dragged box's size and 50%
 * opacity, grabbed where the pointer went down. The Edit-mode box (tint,
 * radius 16, `0 6 6`), the 40px header with the title pill, and the card with
 * the view's layout glyph. No live snapshot: charts and canvases do not
 * clone, and the replica keeps both clients identical.
 *
 * Renders on a drag start and a drop only; the pointer moves it through the
 * store (`DragGhostStore.move`), a transform write without a render.
 */
export function DashboardDragGhost({ store }: { store: DragGhostStore }) {
  const ghost = useSyncExternalStore(store.subscribe, store.get, store.get);

  if (!ghost) return null;

  return createPortal(
    <div
      aria-hidden='true'
      className='pointer-events-none fixed left-0 top-0 z-[1400] opacity-50'
      data-testid='dashboard-drag-ghost'
      data-widget-id={ghost.widgetId}
      ref={store.attach}
      style={{ width: ghost.width, height: ghost.height }}
    >
      <div className='flex h-full w-full flex-col rounded-500 bg-dash-edit-tint' style={{ padding: BOX_PADDING }}>
        <div className='flex min-w-0 shrink-0 items-center' style={HEADER_STYLE}>
          <span
            className='min-w-0 max-w-full truncate rounded-600 px-2.5 py-1 text-xs font-medium leading-4 text-dash-edit-title'
            data-testid='dashboard-drag-ghost-title'
          >
            {ghost.name}
          </span>
        </div>
        <div
          className='dash-card flex min-h-0 w-full flex-1 items-center justify-center rounded-400 bg-dash-card-bg'
          data-editing='true'
        >
          <LayoutGlyph
            aria-hidden='true'
            className='h-8 w-8 text-icon-tertiary'
            data-testid='dashboard-drag-ghost-icon'
            layout={ghost.layout}
            size='unset'
          />
        </div>
      </div>
    </div>,
    document.body
  );
}

export default DashboardDragGhost;
