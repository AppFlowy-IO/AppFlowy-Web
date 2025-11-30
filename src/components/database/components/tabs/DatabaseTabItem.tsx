import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
    DatabaseViewLayout,
    View,
    ViewLayout,
    YDatabaseView,
    YjsDatabaseKey,
} from '@/application/types';
import PageIcon from '@/components/_shared/view-icon/PageIcon';
import { DatabaseViewActions } from '@/components/database/components/tabs/ViewActions';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TabLabel, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export interface DatabaseTabItemProps {
    viewId: string;
    view: YDatabaseView;
    /**
     * The database's page ID in the folder/outline structure.
     * This is the main entry point for the database and remains constant.
     */
    databasePageId: string;
    menuViewId: string | null;
    readOnly: boolean;
    visibleViewIds: string[];
    onSetMenuViewId: (id: string | null) => void;
    onOpenDeleteModal: (id: string) => void;
    onOpenRenameModal: (id: string) => void;
    setTabRef: (id: string, el: HTMLElement | null) => void;
}

export const DatabaseTabItem = memo(
    ({
        viewId,
        view,
        databasePageId,
        menuViewId,
        readOnly,
        visibleViewIds,
        onSetMenuViewId,
        onOpenDeleteModal,
        onOpenRenameModal,
        setTabRef,
    }: DatabaseTabItemProps) => {
        const { t } = useTranslation();
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
                default:
                    return t('untitled');
            }
        };

        // Get name from YDatabaseView (real-time, always correct)
        const name = view.get(YjsDatabaseKey.name) || getDefaultNameByLayout();

        // Compute the layout for PageIcon (icon is based on layout type)
        const computedLayout =
            databaseLayout === DatabaseViewLayout.Board
                ? ViewLayout.Board
                : databaseLayout === DatabaseViewLayout.Calendar
                    ? ViewLayout.Calendar
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
                className={'min-w-[80px] max-w-[200px]'}
                ref={(el) => {
                    setTabRef(viewId, el);
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
                    <PageIcon
                        iconSize={16}
                        view={{ layout: computedLayout }}
                        className={'!h-5 !w-5 text-base leading-[1.3rem]'}
                    />

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
                    <DropdownMenuContent
                        side={'bottom'}
                        align={'start'}
                        onCloseAutoFocus={(e) => e.preventDefault()}
                    >
                        {menuViewId === viewId && (
                            <DatabaseViewActions
                                onOpenDeleteModal={onOpenDeleteModal}
                                onOpenRenameModal={onOpenRenameModal}
                                deleteDisabled={viewId === databasePageId && visibleViewIds.length > 1}
                                view={viewForActions}
                            />
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
            </TabsTrigger>
        );
    }
);

DatabaseTabItem.displayName = 'DatabaseTabItem';
