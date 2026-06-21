import React, { useCallback, useMemo } from 'react';

import { View } from '@/application/types';
import AddPageActions from '@/components/app/view-actions/AddPageActions';
import MorePageActions from '@/components/app/view-actions/MorePageActions';
import MoreSpaceActions from '@/components/app/view-actions/MoreSpaceActions';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

function ViewActionsPopover ({
  popoverType,
  view,
  children,
  open,
  onOpenChange,
  onImportClick,
}: {
  view?: View;
  popoverType?: {
    category: 'space' | 'page';
    type: 'more' | 'add';
  },
  children: React.ReactNode;
  // Forwarded to AddPageActions. The dialog itself must live in a persistent
  // ancestor (e.g. Outline) since this popover is unmounted as soon as the
  // dropdown closes.
  onImportClick?: (view: View) => void;
} & React.ComponentProps<typeof DropdownMenu>) {

  const onClose = useCallback(() => {
    onOpenChange?.(false);
  }, [onOpenChange]);

  const popoverContent = useMemo(() => {
    if (!popoverType || !view) return null;

    if (popoverType.type === 'add') {
      return <AddPageActions
        view={view}
        onImportClick={onImportClick}
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
  }, [onClose, popoverType, view, onImportClick]);

  return (
    <DropdownMenu
      open={open}
      onOpenChange={onOpenChange}
    >
      <DropdownMenuTrigger asChild>
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        data-testid="view-actions-popover"
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