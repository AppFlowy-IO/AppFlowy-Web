import { ComponentProps, ReactNode } from 'react';

import { ViewLayout } from '@/application/types';
import { ReactComponent as CrownIcon } from '@/assets/icons/crown.svg';
import { DatabaseViewCreationAction } from '@/components/app/hooks/useDatabaseViewCreation';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { isLimitedDatabaseViewLayout } from '@/utils/subscription';

export function DatabaseViewCreationHint({
  reason,
  enabled = true,
  children,
}: {
  reason?: string;
  enabled?: boolean;
  children: ReactNode;
}) {
  // Eligibility is fixed for an option; loading a reason never remounts its item.
  if (!enabled) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div>{children}</div>
      </TooltipTrigger>
      {reason && <TooltipContent>{reason}</TooltipContent>}
    </Tooltip>
  );
}

export function DatabaseViewProBadge() {
  return <CrownIcon aria-label='Pro' className='ml-auto h-4 w-4 shrink-0 text-text-featured' />;
}

export function DatabaseViewCreationItem({
  action,
  layout,
  children,
  ...props
}: ComponentProps<typeof DropdownMenuItem> & {
  action: DatabaseViewCreationAction;
  layout?: ViewLayout;
}) {
  return (
    <DatabaseViewCreationHint enabled={isLimitedDatabaseViewLayout(layout)} reason={action.reason}>
      <DropdownMenuItem {...props} disabled={action.type === 'disabled'}>
        {children}
        {action.requiresPro && <DatabaseViewProBadge />}
      </DropdownMenuItem>
    </DatabaseViewCreationHint>
  );
}
