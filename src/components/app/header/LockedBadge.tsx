import { useTranslation } from 'react-i18next';

import { ReactComponent as LockIcon } from '@/assets/icons/lock.svg';
import { useAppView, useAppViewId } from '@/components/app/app.hooks';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * Orange "Locked" status pill shown in the header when the current page is
 * locked. Read-only indicator for everyone viewing the page; unlocking is done
 * via the "Lock page" toggle in the more-actions menu.
 */
function LockedBadge() {
  const { t } = useTranslation();
  const viewId = useAppViewId();
  const view = useAppView(viewId);

  if (!view?.is_locked) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          data-testid={'page-locked-badge'}
          className={
            'flex shrink-0 select-none items-center gap-1 rounded-300 border border-border-warning-thick ' +
            'bg-fill-warning-light px-2 py-0.5 text-xs font-medium text-text-warning'
          }
        >
          <LockIcon className={'h-3.5 w-3.5 text-icon-warning-thick'} />
          {t('lockPage.lockPage')}
        </div>
      </TooltipTrigger>
      <TooltipContent>{t('lockPage.lockTooltip')}</TooltipContent>
    </Tooltip>
  );
}

export default LockedBadge;
