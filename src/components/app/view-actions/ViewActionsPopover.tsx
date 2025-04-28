import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import React, { useCallback, useMemo } from 'react';
import AddPageActions from '@/components/app/view-actions/AddPageActions';
import MoreSpaceActions from '@/components/app/view-actions/MoreSpaceActions';
import MorePageActions from '@/components/app/view-actions/MorePageActions';
import { View } from '@/application/types';

function ViewActionsPopover ({
  popoverType,
  view,
  children,
  open,
  onOpenChange,
}: {
  view?: View;
  popoverType?: {
    category: 'space' | 'page';
    type: 'more' | 'add';
  },
  children: React.ReactNode;
} & React.ComponentProps<typeof DropdownMenu>) {

  const onClose = useCallback(() => {
    onOpenChange?.(false);
  }, [onOpenChange]);

  const popoverContent = useMemo(() => {
    if (!popoverType || !view) return null;

    if (popoverType.type === 'add') {
      return <AddPageActions
        view={view}
      />;
    }

    if (popoverType.category === 'space') {
      return <MoreSpaceActions
        onClose={onClose}
        view={view}
      />;
    } else {
      return <MorePageActions
        view={view}
        onClose={onClose}
      />;
    }
  }, [onClose, popoverType, view]);

  return (
    <DropdownMenu
      open={open}
      onOpenChange={onOpenChange}
    >
      <DropdownMenuTrigger asChild>
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={'start'}
        onCloseAutoFocus={e => {
          e.preventDefault();
        }}
      >
        {popoverContent}
      </DropdownMenuContent>

    </DropdownMenu>
  );
}

export default ViewActionsPopover;