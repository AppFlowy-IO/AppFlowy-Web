import { ReactNode, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { View, ViewLayout } from '@/application/types';
import { ReactComponent as UploadIcon } from '@/assets/icons/upload.svg';
import { ViewIcon } from '@/components/_shared/view-icon';
import { useAIEnabled, useAppOperations, useOpenPageModal, useToView } from '@/components/app/app.hooks';
import { DropdownMenuGroup, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

function AddPageActions({ view, onImportClick }: { view: View; onImportClick?: (view: View) => void }) {
  const { t } = useTranslation();
  const { addPage } = useAppOperations();
  const openPageModal = useOpenPageModal();
  const toView = useToView();
  const aiEnabled = useAIEnabled();
  const lastChildViewId = view.children?.[view.children.length - 1]?.view_id;

  const handleAddPage = useCallback(
    async (layout: ViewLayout, name?: string) => {
      if (!addPage) return;
      if (layout === ViewLayout.AIChat && !aiEnabled) return;
      toast.loading(t('document.creating'));
      try {
        // Append after the last child so the new page appears at the bottom.
        // When prev_view_id is omitted the backend prepends (inserts at index 0).
        const response = await addPage(view.view_id, { layout, name, prev_view_id: lastChildViewId });

        if (layout === ViewLayout.Document) {
          void openPageModal?.(response.view_id);
        } else {
          void toView(response.view_id);
        }

        toast.dismiss();
        // eslint-disable-next-line
      } catch (e: any) {
        toast.error(e.message);
      }
    },
    [addPage, aiEnabled, openPageModal, t, toView, view.view_id, lastChildViewId]
  );

  const actions: {
    label: string;
    icon: ReactNode;
    testId?: string;
    disabled?: boolean;
    tooltip?: string;
    onSelect: () => void;
  }[] = useMemo(
    () => [
      {
        label: t('document.menuName'),
        icon: <ViewIcon layout={ViewLayout.Document} size={'small'} />,
        onSelect: () => {
          void handleAddPage(ViewLayout.Document, t('menuAppHeader.defaultNewPageName'));
        },
      },
      {
        label: t('grid.menuName'),
        icon: <ViewIcon layout={ViewLayout.Grid} size={'small'} />,
        testId: 'add-grid-button',
        onSelect: () => {
          void handleAddPage(ViewLayout.Grid, t('document.plugins.database.newDatabase'));
        },
      },
      {
        label: t('board.menuName'),
        icon: <ViewIcon layout={ViewLayout.Board} size={'small'} />,
        onSelect: () => {
          void handleAddPage(ViewLayout.Board, t('document.plugins.database.newDatabase'));
        },
      },
      {
        label: t('calendar.menuName'),
        icon: <ViewIcon layout={ViewLayout.Calendar} size={'medium'} />,
        onSelect: () => {
          void handleAddPage(ViewLayout.Calendar, t('document.plugins.database.newDatabase'));
        },
      },
      ...(aiEnabled ? [
        {
          label: t('chat.newChat'),
          icon: <ViewIcon layout={ViewLayout.AIChat} size={'small'} />,
          testId: 'add-ai-chat-button',
          onSelect: () => {
            void handleAddPage(ViewLayout.AIChat, t('menuAppHeader.defaultNewPageName'));
          },
        },
      ] : []),
      {
        label: t('chart.menuName'),
        icon: <ViewIcon layout={ViewLayout.Chart} size={'small'} />,
        testId: 'add-chart-button',
        onSelect: () => {
          void handleAddPage(ViewLayout.Chart, t('document.plugins.database.newDatabase'));
        },
      },
      {
        label: t('list.menuName'),
        icon: <ViewIcon layout={ViewLayout.List} size={'small'} />,
        disabled: true,
        tooltip: t('common.desktopOnly'),
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        onSelect: () => {},
      },
      {
        label: t('gallery.menuName'),
        icon: <ViewIcon layout={ViewLayout.Gallery} size={'small'} />,
        disabled: true,
        tooltip: t('common.desktopOnly'),
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        onSelect: () => {},
      },
      {
        label: t('moreAction.import'),
        icon: <UploadIcon className='h-5 w-5 text-icon-primary' />,
        testId: 'add-import-button',
        onSelect: () => {
          onImportClick?.(view);
        },
      },
    ],
    [aiEnabled, handleAddPage, t, onImportClick, view]
  );

  return (
    <DropdownMenuGroup>
      {actions.map((action) =>
        action.disabled && action.tooltip ? (
          <Tooltip key={action.label}>
            <TooltipTrigger asChild>
              <div>
                <DropdownMenuItem disabled>
                  {action.icon}
                  {action.label}
                </DropdownMenuItem>
              </div>
            </TooltipTrigger>
            <TooltipContent>{action.tooltip}</TooltipContent>
          </Tooltip>
        ) : (
          <DropdownMenuItem
            key={action.label}
            data-testid={action.testId}
            disabled={action.disabled}
            onClick={action.onSelect}
          >
            {action.icon}
            {action.label}
          </DropdownMenuItem>
        )
      )}
    </DropdownMenuGroup>
  );
}

export default AddPageActions;
