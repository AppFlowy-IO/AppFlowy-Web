import { useTranslation } from 'react-i18next';

import { ReactComponent as DashboardIcon } from '@/assets/icons/dashboard.svg';

/**
 * Shown in place of a dashboard inside a database version history preview.
 * Widgets mount their own live databases, so they are not rendered against an
 * immutable snapshot.
 */
export function HistoricalDashboardPlaceholder() {
  const { t } = useTranslation();

  return (
    <div
      className='flex w-full flex-col items-center justify-center gap-3 rounded-400 border border-dashed border-border-primary px-6 py-12 text-center'
      data-testid='dashboard-history-placeholder'
    >
      <DashboardIcon aria-hidden='true' className='h-10 w-10 text-icon-tertiary' />
      <div className='text-sm text-text-secondary'>
        {t('dashboard.historyPreviewUnavailable', {
          defaultValue: 'Dashboards are not previewed in version history.',
        })}
      </div>
    </div>
  );
}

export default HistoricalDashboardPlaceholder;
