import { type Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { memo, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { DatabaseViewLayout, View, ViewLayout, YDatabaseView, YjsDatabaseKey } from '@/application/types';
import { useReorderableItem } from '@/components/_shared/reorder/useReorderableItem';
import PageIcon from '@/components/_shared/view-icon/PageIcon';
import DropColumnIndicator from '@/components/database/components/drag-and-drop/DropColumnIndicator';
import { DatabaseViewActions } from '@/components/database/components/tabs/ViewActions';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { TabLabel, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const TAB_DRAG_TYPE = 'database-view-tab';
const TAB_DRAG_EDGES: Edge[] = ['left', 'right'];

export interface DatabaseTabItemProps {
  viewId: string;
  view: YDatabaseView;
  /**
   * The database's page ID in the folder/outline structure.
   * This is the main entry point for the database and remains constant.
   */
  databasePageId: string;
  /** Optional name coming from outline/meta when Yjs name is empty. */
  nameOverride?: string;
  menuViewId: string | null;
  readOnly: boolean;
  visibleViewIds: string[];
  onSetMenuViewId: (id: string | null) => void;
  onOpenDeleteModal: (id: string) => void;
  onOpenRenameModal: (id: string) => void;
  setTabRef: (id: string, el: HTMLElement | null) => void;
  /** Drag instance of the tab bar group; undefined disables reordering for this tab. */
  reorderInstanceId?: symbol;
}

export const DatabaseTabItem = memo(
  ({
    viewId,
    view,
    databasePageId,
    nameOverride,
    menuViewId,
    readOnly,
    visibleViewIds,
    onSetMenuViewId,
    onOpenDeleteModal,
    onOpenRenameModal,
    setTabRef,
    reorderInstanceId,
  }: DatabaseTabItemProps) => {
    const { t } = useTranslation();
    const tabRef = useRef<HTMLElement | null>(null);

    const { dragState, shouldSuppressClick } = useReorderableItem({
      elementRef: tabRef,
      id: viewId,
      dragType: TAB_DRAG_TYPE,
      instanceId: reorderInstanceId,
      canDrag: Boolean(reorderInstanceId),
      allowedEdges: TAB_DRAG_EDGES,
    });

    const setRefs = useCallback(
      (el: HTMLElement | null) => {
        tabRef.current = el;
        setTabRef(viewId, el);
      },
      [setTabRef, viewId]
    );

    const rawLayoutValue = view.get(YjsDatabaseKey.layout);
    const databaseLayout = Number(rawLayoutValue) as DatabaseViewLayout;

    // Get the default name based on layout if no name is available
    const getDefaultNameByLayout = () => {
      switch (databaseLayout) {
        case DatabaseViewLayout.Grid:
          return 'Grid';
        case DatabaseViewLayout.Board:
          return 'Board';
        case DatabaseViewLayout.Calendar:
          return 'Calendar';
        case DatabaseViewLayout.Chart:
          return 'Chart';
        default:
          return t('untitled');
      }
    };

    const rawName = view.get(YjsDatabaseKey.name);
    const defaultName = getDefaultNameByLayout();
    const yjsName = rawName?.trim();
    const override = nameOverride?.trim();
    // Prefer folder/outline name when available (fixes published page tab names)
    const name = override || yjsName || defaultName;

    // Compute the layout for PageIcon (icon is based on layout type)
    const computedLayout =
      databaseLayout === DatabaseViewLayout.Board
        ? ViewLayout.Board
        : databaseLayout === DatabaseViewLayout.Calendar
        ? ViewLayout.Calendar
        : databaseLayout === DatabaseViewLayout.Chart
        ? ViewLayout.Chart
        : ViewLayout.Grid;

    // Build minimal View object from YDatabaseView for actions menu
    // This avoids dependency on meta/folderView for display
    const viewForActions: View = useMemo(
      () => ({
        view_id: viewId,
        name: name,
        layout: computedLayout,
        parent_view_id: databasePageId,
        children: [],
        icon: null,
        extra: null,
        is_published: false,
        is_private: false,
      }),
      [viewId, name, computedLayout, databasePageId]
    );

    return (
      <TabsTrigger
        key={viewId}
        value={viewId}
        id={`view-tab-${viewId}`}
        data-testid={`view-tab-${viewId}`}
        className={cn('min-w-[80px] max-w-[200px]', dragState.type === 'dragging' && 'opacity-40')}
        ref={setRefs}
        onClickCapture={(e) => {
          // Swallow the click that fires right after a drag so the dragged tab
          // isn't (re-)selected on drop.
          if (shouldSuppressClick()) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        <TabLabel
          onPointerDown={(e) => {
            // For left-click, let Radix UI tabs handle it via onValueChange
            if (e.button === 0) {
              return;
            }

            // For right-click and other buttons, prevent default and handle menu
            e.preventDefault();
            e.stopPropagation();

            if (readOnly) return;

            if (viewId !== menuViewId) {
              onSetMenuViewId(viewId);
            } else {
              onSetMenuViewId(null);
            }
          }}
          className={'flex items-center gap-1.5 overflow-hidden'}
        >
          <PageIcon iconSize={16} view={{ layout: computedLayout }} className={'!h-5 !w-5 text-base leading-[1.3rem]'} />

          <Tooltip delayDuration={500}>
            <TooltipTrigger asChild>
              <span
                onContextMenu={(e) => {
                  e.preventDefault();
                }}
                className={'flex-1 truncate'}
              >
                {name || t('grid.title.placeholder')}
              </span>
            </TooltipTrigger>
            <TooltipContent sideOffset={10} side={'right'}>
              {name}
            </TooltipContent>
          </Tooltip>
        </TabLabel>
        <DropdownMenu
          modal
          onOpenChange={(open) => {
            if (!open) {
              onSetMenuViewId(null);
            }
          }}
          open={menuViewId === viewId}
        >
          <DropdownMenuTrigger asChild>
            <div className={'pointer-events-none absolute bottom-0 left-0 opacity-0'} />
          </DropdownMenuTrigger>
          <DropdownMenuContent side={'bottom'} align={'start'} onCloseAutoFocus={(e) => e.preventDefault()}>
            {menuViewId === viewId && (
              <DatabaseViewActions
                onOpenDeleteModal={onOpenDeleteModal}
                onOpenRenameModal={onOpenRenameModal}
                deleteDisabled={visibleViewIds.length <= 1}
                view={viewForActions}
              />
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        {dragState.type === 'over' ? <DropColumnIndicator edge={dragState.closestEdge} /> : null}
      </TabsTrigger>
    );
  }
);

DatabaseTabItem.displayName = 'DatabaseTabItem';
