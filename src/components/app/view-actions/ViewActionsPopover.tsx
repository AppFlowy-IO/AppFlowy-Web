import React, { useCallback, useMemo } from 'react';

import { View } from '@/application/types';
import AddPageActions from '@/components/app/view-actions/AddPageActions';
import MorePageActions from '@/components/app/view-actions/MorePageActions';
import MoreSpaceActions from '@/components/app/view-actions/MoreSpaceActions';
import { useSpaceActionPermissions } from '@/components/app/view-actions/useSpaceActionPermissions';
import { useViewActionPermissions } from '@/components/app/view-actions/useViewActionPermissions';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';

function PermissionLoadingItem({ testId }: { testId: string }) {
  return (
    <DropdownMenuGroup>
      <DropdownMenuItem data-testid={testId} disabled>
        <Progress variant='primary' />
      </DropdownMenuItem>
    </DropdownMenuGroup>
  );
}

function ViewActionsPopover({
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
  };
  children: React.ReactNode;
  // Forwarded to AddPageActions. The dialog itself must live in a persistent
  // ancestor (e.g. Outline) since this popover is unmounted as soon as the
  // dropdown closes.
  onImportClick?: (view: View) => void;
} & React.ComponentProps<typeof DropdownMenu>) {
  const { canCreateViewActions, canManageViewActions, hasLoadedViewActionPermissions, isLoadingViewActionPermissions } =
    useViewActionPermissions(view, Boolean(open && popoverType));
  const shouldLoadSpaceActionPermissions = Boolean(
    open && popoverType?.category === 'space' && popoverType.type === 'more'
  );
  const { canOpenManageSpace, hasLoadedSpaceActionPermissions, isLoadingSpaceActionPermissions } =
    useSpaceActionPermissions(view, shouldLoadSpaceActionPermissions, canManageViewActions);
  const isResolvingViewActionPermissions =
    isLoadingViewActionPermissions ||
    !hasLoadedViewActionPermissions ||
    isLoadingSpaceActionPermissions ||
    !hasLoadedSpaceActionPermissions;

  const onClose = useCallback(() => {
    onOpenChange?.(false);
  }, [onOpenChange]);

  const popoverContent = useMemo(() => {
    if (!popoverType || !view) return null;

    if (popoverType.type === 'add') {
      if (isResolvingViewActionPermissions) {
        return <PermissionLoadingItem testId='add-page-permission-loading' />;
      }

      if (!canCreateViewActions) return null;

      return <AddPageActions view={view} onImportClick={onImportClick} />;
    }

    if (popoverType.category === 'space') {
      return (
        <MoreSpaceActions
          onClose={onClose}
          view={view}
          canDuplicateActions={canCreateViewActions}
          canManageActions={canManageViewActions}
          canOpenManageActions={canOpenManageSpace}
          isLoadingActions={isResolvingViewActionPermissions}
        />
      );
    } else {
      return (
        <MorePageActions
          view={view}
          onClose={onClose}
          canDuplicateActions={canCreateViewActions}
          canEditActions={canCreateViewActions}
          canManageActions={canManageViewActions}
          isLoadingActions={isResolvingViewActionPermissions}
        />
      );
    }
  }, [
    canCreateViewActions,
    canOpenManageSpace,
    canManageViewActions,
    isResolvingViewActionPermissions,
    onClose,
    popoverType,
    view,
    onImportClick,
  ]);

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent
        data-testid='view-actions-popover'
        align={'start'}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
        }}
      >
        {popoverContent}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default ViewActionsPopover;
