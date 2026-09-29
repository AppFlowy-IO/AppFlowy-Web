import { ComponentProps, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ViewLayout } from '@/application/types';
import { ReactComponent as CrownIcon } from '@/assets/icons/crown.svg';
import { DatabaseViewCreationAction } from '@/components/app/hooks/useDatabaseViewCreation';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
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
  loading = false,
  disabled = false,
  children,
  ...props
}: ComponentProps<typeof DropdownMenuItem> & {
  action: DatabaseViewCreationAction;
  layout?: ViewLayout;
  /** Checkout is opening from this item; its progress replaces the crown. */
  loading?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <DatabaseViewCreationHint enabled={isLimitedDatabaseViewLayout(layout)} reason={action.reason}>
      <DropdownMenuItem
        {...props}
        aria-busy={loading || undefined}
        disabled={disabled || loading || action.type === 'disabled'}
      >
        {children}
        {loading ? (
          <Progress
            role='progressbar'
            aria-label={t('databaseViewCreation.openingCheckout')}
            variant='primary'
            className='ml-auto'
          />
        ) : (
          action.requiresPro && <DatabaseViewProBadge />
        )}
      </DropdownMenuItem>
    </DatabaseViewCreationHint>
  );
}
