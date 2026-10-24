import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { PRIVATE_RESET_CLASS, PRIVATE_SAVE_CLASS } from './DashboardSaveControls';
import { useWidgetPrivateHandle, useWidgetPrivateSnapshot } from './WidgetPrivateContext';

/**
 * The footer of a widget's Filters and Sorts popovers while the widget's
 * filters or sorts are private (WP07): Reset, and "Save for everyone" when the
 * viewer can save this widget for everyone (dashboard write access and a
 * writable source). Not shown in Edit mode or outside a dashboard.
 */
export function WidgetPrivateFooter() {
  const { t } = useTranslation();
  const handle = useWidgetPrivateHandle();
  const snapshot = useWidgetPrivateSnapshot();

  if (!handle || !snapshot || snapshot.suspended || (!snapshot.filters && !snapshot.sorts)) return null;

  return (
    <div
      className='-mx-2 -mb-2 mt-2 flex h-9 items-center justify-end gap-2 border-t border-border-primary px-2 py-1.5'
      data-testid='dashboard-widget-private-footer'
    >
      <Button
        className={PRIVATE_RESET_CLASS}
        data-testid='dashboard-widget-private-reset'
        onClick={() => handle.reset()}
        size='sm'
        variant='ghost'
      >
        {t('dashboard.private.reset', { defaultValue: 'Reset' })}
      </Button>
      {snapshot.canSave ? (
        <Button
          className={cn(PRIVATE_SAVE_CLASS, '!rounded-200 px-2 py-0')}
          data-testid='dashboard-widget-save-for-everyone'
          onClick={() => handle.save()}
          size='sm'
          variant='ghost'
        >
          {t('dashboard.private.saveForEveryone', { defaultValue: 'Save for everyone' })}
        </Button>
      ) : null}
    </div>
  );
}

export default WidgetPrivateFooter;
