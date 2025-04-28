import { View, ViewLayout } from '@/application/types';
import { DropdownMenuGroup, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { ViewIcon } from '@/components/_shared/view-icon';
import { useAppHandlers } from '@/components/app/app.hooks';
import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

function AddPageActions ({ view }: {
  view: View;
}) {
  const { t } = useTranslation();
  const {
    addPage,
    openPageModal,
    toView,
  } = useAppHandlers();

  const handleAddPage = useCallback(async (layout: ViewLayout, name?: string) => {
    if (!addPage) return;
    toast.loading(
      t('document.creating'),
    );
    try {
      const viewId = await addPage(view.view_id, { layout, name });

      if (layout === ViewLayout.Document) {
        void openPageModal?.(viewId);

      } else {
        void toView(viewId);
      }

      toast.dismiss();
      // eslint-disable-next-line
    } catch (e: any) {
      toast.error(e.message);
    }
  }, [addPage, openPageModal, t, toView, view.view_id]);

  const actions: {
    label: string;
    icon: React.ReactNode;
    disabled?: boolean;
    onSelect: () => void;
  }[] = useMemo(() => [
    {
      label: t('document.menuName'),
      icon: <ViewIcon
        layout={ViewLayout.Document}
        size={'small'}
      />,
      onSelect: () => {
        void handleAddPage(ViewLayout.Document);
      },
    },
    {
      label: t('grid.menuName'),
      icon: <ViewIcon
        layout={ViewLayout.Grid}
        size={'small'}
      />,
      onSelect: () => {
        void handleAddPage(ViewLayout.Grid, 'Table');
      },
    },
    {
      label: t('board.menuName'),
      icon: <ViewIcon
        layout={ViewLayout.Board}
        size={'small'}
      />,
      onSelect: () => {
        void handleAddPage(ViewLayout.Board, 'Board');
      },
    },
    // {
    //   label: t('calendar.menuName'),
    //   disabled: true,
    //   icon: <ViewIcon
    //     layout={ViewLayout.Calendar}
    //     size={'medium'}
    //   />,
    //   onClick: () => {
    //     void handleAddPage(ViewLayout.Calendar, 'Calendar');
    //   },
    // },
    {
      label: t('chat.newChat'),
      icon: <ViewIcon
        layout={ViewLayout.AIChat}
        size={'small'}
      />,
      onSelect: () => {
        void handleAddPage(ViewLayout.AIChat);
      },
    },
  ], [handleAddPage, t]);

  return (
    <DropdownMenuGroup>
      {actions.map(action => (
        <DropdownMenuItem
          key={action.label}
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