import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { SubscriptionInterval, SubscriptionPlan } from '@/application/types';
import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { ReactComponent as InfoIcon } from '@/assets/icons/vector.svg';
import { BillingService } from '@/application/services/domains';
import { useUserWorkspaceInfo } from '@/components/app/app.hooks';
import { useCurrentUser } from '@/components/main/app.hooks';
import { Button } from '@/components/ui/button';
import { isAppFlowyHosted } from '@/utils/subscription';

const CLOSE_UPGRADE_LOCAL_STORAGE_KEY = 'close_upgrade_banner';

export function UpgradeBanner({ activeSubscriptionPlan }: { activeSubscriptionPlan: SubscriptionPlan | null }) {
  const { t } = useTranslation();

  const userWorkspaceInfo = useUserWorkspaceInfo();
  const currentUser = useCurrentUser();
  const currentWorkspaceId = userWorkspaceInfo?.selectedWorkspace.id;
  const isOwner = userWorkspaceInfo?.selectedWorkspace.owner?.uid.toString() === currentUser?.uid.toString();
  const storageKey = CLOSE_UPGRADE_LOCAL_STORAGE_KEY + currentWorkspaceId;
  const [isClosed, setClosed] = useState(() => localStorage.getItem(storageKey) === 'true');

  const needUpgrade = useMemo(() => {
    return activeSubscriptionPlan === SubscriptionPlan.Free;
  }, [activeSubscriptionPlan]);

  const isOfficial = useMemo(() => {
    return isAppFlowyHosted();
  }, []);

  const handleUpgrade = useCallback(async () => {
    if (!currentWorkspaceId) return;

    const plan = SubscriptionPlan.Pro;

    try {
      const link = await BillingService.getSubscriptionLink(currentWorkspaceId, plan, SubscriptionInterval.Month);

      window.open(link, '_blank');

      // eslint-disable-next-line
    } catch (e: any) {
      toast.error(e.message);
    }
  }, [currentWorkspaceId]);

  if (isClosed || !isOwner || !needUpgrade || !isOfficial) {
    return null;
  }

  return (
    <div className='w-full px-2 pt-3'>
      <div className='flex w-full items-center justify-start gap-2 rounded-300 bg-fill-featured-light px-3 py-1 text-xs text-text-featured'>
        <InfoIcon />
        <div className='flex flex-1 items-center gap-1'>
          <span className='cursor-pointer underline' onClick={handleUpgrade}>
            {t('shareAction.upgrade')}
          </span>
          <span>{t('shareAction.upgradeText')}</span>
        </div>
        <Button
          variant='ghost'
          size='icon-sm'
          onClick={() => {
            localStorage.setItem(storageKey, 'true');
            setClosed(true);
          }}
        >
          <CloseIcon className='h-4 w-4' />
        </Button>
      </div>
    </div>
  );
}
