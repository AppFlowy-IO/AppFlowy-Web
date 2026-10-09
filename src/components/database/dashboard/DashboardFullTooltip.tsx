import { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';

import { DASHBOARD_MAX_WIDGETS_PER_ROW } from '@/application/database-yjs/dashboard.type';
import { TooltipContent } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import type { TFunction } from 'i18next';

/**
 * The dashboard chrome tooltip (`dash-tooltip`): radius 8, the inverse
 * surface, 12/16 text on fill. Pass it with `data-parity-id='dash-tooltip'`.
 */
export const DASHBOARD_TOOLTIP_CLASS =
  '!rounded-300 bg-dash-toast-bg px-2.5 py-1.5 text-xs leading-4 text-text-on-fill break-normal';

function fullTexts(t: TFunction) {
  return {
    title: String(t('dashboard.limit.fullTitle', { defaultValue: 'Dashboard is full' })),
    hint: String(t('dashboard.limit.fullHint', { defaultValue: 'Delete a view to add a new one' })),
  };
}

/** "Dashboard is full. Delete a view to add a new one." for assistive technology. */
export function dashboardFullAnnouncement(t: TFunction) {
  const { title, hint } = fullTexts(t);

  return `${title}. ${hint}.`;
}

/** "A row holds up to 4 widgets." for assistive technology. */
export function dashboardRowLimitAnnouncement(t: TFunction) {
  return String(
    t('dashboard.rowLimit', {
      count: DASHBOARD_MAX_WIDGETS_PER_ROW,
      defaultValue: 'A row holds up to {{count}} widgets.',
    })
  );
}

/**
 * The tooltip of a control the full dashboard refuses (Notion's two lines: a
 * bold "Dashboard is full" over a grey "Delete a view to add a new one").
 * Render it inside a `Tooltip` whose trigger is the refused control.
 */
export function DashboardFullTooltipContent({
  side = 'top',
  className,
}: {
  side?: ComponentProps<typeof TooltipContent>['side'];
  className?: string;
}) {
  const { t } = useTranslation();
  const { title, hint } = fullTexts(t);

  return (
    <TooltipContent
      className={cn(DASHBOARD_TOOLTIP_CLASS, className)}
      data-parity-id='dash-tooltip'
      data-testid='dashboard-full-tooltip'
      side={side}
      sideOffset={4}
    >
      <span className='font-semibold'>{title}</span>
      <span className='opacity-70'>{hint}</span>
    </TooltipContent>
  );
}

export default DashboardFullTooltipContent;
