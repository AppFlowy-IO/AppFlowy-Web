import { useCallback, useMemo } from 'react';

import { View } from '@/application/types';
import AddPageActions from '@/components/app/view-actions/AddPageActions';
import MorePageActions from '@/components/app/view-actions/MorePageActions';
import MoreSpaceActions from '@/components/app/view-actions/MoreSpaceActions';
import {
  allowsPageDestination,
  useDuplicateDestinationAccess,
} from '@/components/app/view-actions/usePageDestinationAccess';
import { useViewActionPermissions } from '@/components/app/view-actions/useViewActionPermissions';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';

import type { ComponentProps, ReactNode } from 'react';

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
  viewActionPermissions,
}: {
  view?: View;
  popoverType?: {
    category: 'space' | 'page';
    type: 'more' | 'add';
  };
  children: ReactNode;
  // Forwarded to AddPageActions. The dialog itself must live in a persistent
  // ancestor (e.g. Outline) since this popover is unmounted as soon as the
  // dropdown closes.
  onImportClick?: (view: View) => void;
  // A row that already resolves canonical permissions can share that result.
  viewActionPermissions?: Pick<
    ReturnType<typeof useViewActionPermissions>,
    'canCreateViewActions' | 'canManageViewActions' | 'hasLoadedViewActionPermissions' | 'isLoadingViewActionPermissions'
  >;
} & ComponentProps<typeof DropdownMenu>) {
  // A row that already resolves canonical permissions can share that result. For a space the
  // hook also reads the space permission (management + sidebar) in the same request.
  const ownViewActionPermissions = useViewActionPermissions(
    view,
    Boolean(open && popoverType && !viewActionPermissions)
  );
  const { canCreateViewActions, canManageViewActions, hasLoadedViewActionPermissions, isLoadingViewActionPermissions } =
    viewActionPermissions ?? ownViewActionPermissions;
  // Shared rows pass their page permissions; Manage space needs the space's own permission read.
  const canOpenManageSpace = !viewActionPermissions && ownViewActionPermissions.canOpenManageSpace;
  const isResolvingViewActionPermissions = isLoadingViewActionPermissions || !hasLoadedViewActionPermissions;
  // Duplicate places the copy beside the page, so the parent must accept a new child (P).
  const duplicateDestination = useDuplicateDestinationAccess(
    view,
    Boolean(open && popoverType?.category === 'page' && popoverType.type === 'more')
  );
  const canDuplicateActions = canCreateViewActions && allowsPageDestination(duplicateDestination);
  const isResolvingDuplicate = duplicateDestination.state === 'checking';

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

      return <AddPageActions view={view} onImportClick={onImportClick} onClose={onClose} />;
    }

    if (popoverType.category === 'space') {
      return (
        <MoreSpaceActions
          onClose={onClose}
          view={view}
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
          canDuplicateActions={canDuplicateActions}
          canEditActions={canCreateViewActions}
          canManageActions={canManageViewActions}
          isLoadingActions={isResolvingViewActionPermissions || isResolvingDuplicate}
        />
      );
    }
  }, [
    canCreateViewActions,
    canDuplicateActions,
    canOpenManageSpace,
    canManageViewActions,
    isResolvingDuplicate,
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
