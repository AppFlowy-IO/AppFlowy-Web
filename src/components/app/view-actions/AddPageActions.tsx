import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { View, ViewLayout } from '@/application/types';
import { ViewIcon } from '@/components/_shared/view-icon';
import { useAppHandlers } from '@/components/app/app.hooks';
import { DropdownMenuGroup, DropdownMenuItem } from '@/components/ui/dropdown-menu';

function AddPageActions({ view }: { view: View }) {
  const { t } = useTranslation();
  const { addPage, openPageModal, toView } = useAppHandlers();

  const handleAddPage = useCallback(
    async (layout: ViewLayout, name?: string) => {
      if (!addPage) return;
      toast.loading(t('document.creating'));
      try {
        const response = await addPage(view.view_id, { layout, name });

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
    [addPage, openPageModal, t, toView, view.view_id]
  );

  const actions: {
    label: string;
    icon: React.ReactNode;
    testId?: string;
    disabled?: boolean;
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
      {
        label: t('chat.newChat'),
        icon: <ViewIcon layout={ViewLayout.AIChat} size={'small'} />,
        testId: 'add-ai-chat-button',
        onSelect: () => {
          void handleAddPage(ViewLayout.AIChat, t('menuAppHeader.defaultNewPageName'));
        },
      },
    ],
    [handleAddPage, t]
  );

  return (
    <DropdownMenuGroup>
      {actions.map((action) => (
        <DropdownMenuItem
          key={action.label}
          data-testid={action.testId}
          disabled={action.disabled}
          onSelect={() => {
            action.onSelect();
          }}
        >
          {action.icon}
          {action.label}
        </DropdownMenuItem>
      ))}
    </DropdownMenuGroup>
  );
}

export default AddPageActions;
