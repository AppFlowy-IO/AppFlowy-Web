import { useTranslation } from 'react-i18next';

import { DASHBOARD_MAX_WIDGETS, DASHBOARD_MAX_WIDGETS_PER_ROW } from '@/application/database-yjs/dashboard.type';
import { ReactComponent as WarningIcon } from '@/assets/icons/warning.svg';
import { cn } from '@/lib/utils';

import { DashboardLimitReason } from './DashboardUiContext';

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
  const { t } = useTranslation();
  const text =
    reason === 'row'
      ? t('dashboard.rowLimit', {
          count: DASHBOARD_MAX_WIDGETS_PER_ROW,
          defaultValue: 'A row holds up to {{count}} widgets.',
        })
      : t('dashboard.widgetLimit', {
          count: DASHBOARD_MAX_WIDGETS,
          defaultValue: 'Dashboards support up to {{count}} widgets.',
        });

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

export default DashboardLimitMessage;
