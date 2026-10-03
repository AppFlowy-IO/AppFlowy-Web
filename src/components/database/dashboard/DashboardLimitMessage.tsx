import { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { DASHBOARD_MAX_WIDGETS, DASHBOARD_MAX_WIDGETS_PER_ROW } from '@/application/database-yjs/dashboard.type';
import { ReactComponent as WarningIcon } from '@/assets/icons/warning.svg';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { DashboardLimitReason, useDashboardUi } from './DashboardUiContext';

/** Why a widget cannot be added: the dashboard holds 12 widgets, a row 4. */
export function useDashboardLimitText(reason: DashboardLimitReason) {
  const { t } = useTranslation();

  return reason === 'row'
    ? t('dashboard.rowLimit', {
        count: DASHBOARD_MAX_WIDGETS_PER_ROW,
        defaultValue: 'A row holds up to {{count}} widgets.',
      })
    : t('dashboard.widgetLimit', {
        count: DASHBOARD_MAX_WIDGETS,
        defaultValue: 'Dashboards support up to {{count}} widgets.',
      });
}

interface DashboardLimitMessageProps {
  reason: DashboardLimitReason;
  /**
   * `banner`: the warning shown after an add was refused.
   * `inline`: a quiet, persistent hint next to a disabled add control.
   */
  variant?: 'banner' | 'inline';
  className?: string;
}

/** Explains why a widget cannot be added (dashboard or row limit). */
export function DashboardLimitMessage({ reason, variant = 'banner', className }: DashboardLimitMessageProps) {
  const text = useDashboardLimitText(reason);

  if (variant === 'inline') {
    return (
      <div
        className={cn('flex items-center justify-center gap-1.5 text-xs text-text-tertiary', className)}
        data-reason={reason}
        data-testid='dashboard-limit-message'
        data-variant='inline'
      >
        <WarningIcon aria-hidden='true' className='h-4 w-4 shrink-0 text-icon-tertiary' />
        <span>{text}</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-300 border border-border-warning-thick bg-fill-warning-light px-3 py-2 text-sm text-text-primary shadow-card',
        className
      )}
      data-reason={reason}
      data-testid='dashboard-limit-message'
      data-variant='banner'
      role='status'
    >
      <WarningIcon aria-hidden='true' className='h-5 w-5 shrink-0 text-icon-warning-thick' />
      <span>{text}</span>
    </div>
  );
}

interface LimitedActionProps {
  /** The limit that disables the control, or `null` while it can be used. */
  limit: DashboardLimitReason | null;
  /** Tooltip of the usable control; none when omitted. */
  tooltip?: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** Class of the wrapper that takes the click for the disabled control. */
  wrapperClassName?: string;
  /** The add control; the caller disables it while `limit` is set. */
  children: ReactElement;
}

/**
 * An add control that a limit may disable. A disabled button ignores the
 * pointer, so a wrapper takes the click and shows the limit message, and the
 * tooltip names the limit instead of the action.
 */
export function LimitedAction({ limit, tooltip, side, wrapperClassName = 'inline-flex', children }: LimitedActionProps) {
  const { showLimitMessage } = useDashboardUi();
  const limitText = useDashboardLimitText(limit ?? 'dashboard');

  if (limit === null && tooltip === undefined) return children;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {limit === null ? (
          children
        ) : (
          <span className={wrapperClassName} onClick={() => showLimitMessage(limit)}>
            {children}
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent side={side}>{limit === null ? tooltip : limitText}</TooltipContent>
    </Tooltip>
  );
}

export default DashboardLimitMessage;
