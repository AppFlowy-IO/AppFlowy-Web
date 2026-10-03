import { ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ViewLayout } from '@/application/types';

import { useDashboardUi } from './DashboardUiContext';
import { useDraggableWidget } from './hooks/useDashboardDnd';
import { WidgetViewSnapshot } from './hooks/useWidgetViewSnapshot';
import { databaseLayoutToViewLayout, getLayoutLabel } from './utils';
import { WidgetBody } from './WidgetBody';
import { useWidgetContext, WidgetContext, WidgetContextValue, WidgetFrame } from './WidgetContext';
import { WidgetHeaderFrame } from './WidgetHeader';
import { WidgetPlaceholder, WidgetPlaceholderReason } from './WidgetPlaceholder';

interface WidgetContextProviderProps {
  /** The frame's state, from `WidgetSource`. */
  frame: WidgetFrame;
  /** The view as its source database stores it; `null` while that database is not open. */
  sourceView: Pick<WidgetViewSnapshot, 'name' | 'layout'> | null;
  children: ReactNode;
}

/**
 * Provides the `WidgetContext` of one widget: the frame's state, completed
 * with the view's name and layout. The name is the folder's, else the one in
 * the source database, else the layout's; the layout is the source
 * database's, else the folder's. In Edit mode the header rendered inside it
 * (`setDragHandle`) drags the widget.
 */
export function WidgetContextProvider({ frame, sourceView, children }: WidgetContextProviderProps) {
  const { t } = useTranslation();
  const { dndInstanceId } = useDashboardUi();
  const [dragHandle, setDragHandle] = useState<HTMLElement | null>(null);
  const layout: ViewLayout =
    sourceView && sourceView.layout !== null
      ? databaseLayoutToViewLayout(sourceView.layout)
      : frame.folderLayout ?? ViewLayout.Grid;
  const layoutLabel = getLayoutLabel(layout);
  const name =
    (frame.folderName || sourceView?.name || '').trim() ||
    t(layoutLabel.key, { defaultValue: layoutLabel.defaultValue });

  useDraggableWidget({
    handle: dragHandle,
    widgetId: frame.widgetId,
    instanceId: dndInstanceId,
    enabled: frame.editing,
    label: name,
    getCardElement: frame.getBoxElement,
  });

  const value = useMemo<WidgetContextValue>(() => {
    const { folderName: _folderName, folderLayout: _folderLayout, ...shared } = frame;

    return { ...shared, name, layout, setDragHandle };
  }, [frame, layout, name]);

  return <WidgetContext.Provider value={value}>{children}</WidgetContext.Provider>;
}

/**
 * A widget without a database to show: its header (the title and the menu
 * work without the source), and a card that says why. Edit mode offers to
 * remove a widget whose source is gone.
 */
export function WidgetPlaceholderFrame({ reason }: { reason: WidgetPlaceholderReason }) {
  const { editing, actions } = useWidgetContext();

  return (
    <>
      <WidgetHeaderFrame />
      <WidgetBody>
        <WidgetPlaceholder onRemove={editing && reason !== 'loading' ? actions.remove : undefined} reason={reason} />
      </WidgetBody>
    </>
  );
}
