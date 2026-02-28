import { Button, CircularProgress } from '@mui/material';
import React, { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import { SubscriptionInterval, SubscriptionPlan } from '@/application/types';
import { NormalModal } from '@/components/_shared/modal';
import { notify } from '@/components/_shared/notify';
import { BillingService } from '@/application/services/domains';
import { useAppHandlers, useCurrentWorkspaceId } from '@/components/app/app.hooks';

function UpgradeAIMax({ open, onClose, onOpen }: { open: boolean; onClose: () => void; onOpen: () => void }) {
  const { t } = useTranslation();
  const [isActive, setIsActive] = React.useState(false);
  const currentWorkspaceId = useCurrentWorkspaceId();
  const [cancelLoading, setCancelLoading] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const { getSubscriptions } = useAppHandlers();

  const [search, setSearch] = useSearchParams();
  const action = search.get('action');

  useEffect(() => {
    if (!open && action === 'upgrade_ai_max') {
      onOpen();
    }

    if (open) {
      setSearch((prev) => {
        prev.set('action', 'upgrade_ai_max');
        return prev;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, open, setSearch]);

  const loadSubscription = useCallback(async () => {
    try {
      const subscriptions = await getSubscriptions?.();

      if (!subscriptions || subscriptions.length === 0) {
        setIsActive(false);
        return;
      }

      const subscription = subscriptions.find((item) => item.plan === SubscriptionPlan.AIMax);

      setIsActive(!!subscription);
    } catch (e) {
      console.error(e);
    }
  }, [getSubscriptions]);

  const handleClose = useCallback(() => {
    onClose();
    setSearch((prev) => {
      prev.delete('action');
      return prev;
    });
  }, [onClose, setSearch]);

  const handleUpgrade = useCallback(async () => {
    if (!currentWorkspaceId) return;
    const plan = SubscriptionPlan.AIMax;

    try {
      const link = await BillingService.getSubscriptionLink(currentWorkspaceId, plan, SubscriptionInterval.Year);

      window.open(link, '_current');
      // eslint-disable-next-line
    } catch (e: any) {
      notify.error(e.message);
    }
  }, [currentWorkspaceId]);

  const handleCancel = useCallback(async () => {
    if (!currentWorkspaceId) return;
    setCancelLoading(true);
    const plan = SubscriptionPlan.AIMax;

    try {
      await BillingService.cancelSubscription(currentWorkspaceId, plan, '');
      notify.success(t('subscribe.cancelPlan.success'));
      setCancelOpen(false);
      handleClose();
      // eslint-disable-next-line
    } catch (e: any) {
      notify.error(e.message);
    } finally {
      setCancelLoading(false);
    }
  }, [currentWorkspaceId, t, handleClose]);

  useEffect(() => {
    if (open) {
      void loadSubscription();
    }
  }, [open, loadSubscription]);

  return (
    <NormalModal
      open={open}
      onClose={handleClose}
      title={t('subscribe.upgradeAIMax')}
      disableRestoreFocus={true}
      cancelButtonProps={{
        className: 'hidden',
      }}
      okButtonProps={{
        className: 'hidden',
      }}
      slotProps={{
        root: {
          className: 'min-w-[500px] max-w-full max-h-full',
        },
      }}
    >
      <div className={'relative flex w-full flex-col gap-4 rounded-[16px] border border-billing-primary p-4'}>
        <div className='flex flex-col gap-[14px]'>
          <div className='text-billing-primary'>{t('subscribe.AIMax.description')}</div>
        </div>
        <div className='flex flex-col gap-[10px]'>
          <div className='text-xl font-semibold'>$8</div>
          <div className='whitespace-pre-wrap text-text-secondary'>{t('subscribe.AIMax.pricing')}</div>
        </div>
        {!isActive ? (
          <div className={'flex flex-col gap-2'}>
            <Button color={'secondary'} onClick={handleUpgrade} variant={'contained'}>
              {t('subscribe.unlock')}
            </Button>
          </div>
        ) : (
          <Button
            onClick={() => {
              setCancelOpen(true);
            }}
            variant={'outlined'}
            color={'inherit'}
            startIcon={cancelLoading ? <CircularProgress size={14} /> : null}
          >
            {t('subscribe.cancel')}
          </Button>
        )}
        <div className='flex flex-col gap-2'>
          <div className='flex items-center gap-2'>
            <div className={'flex h-6 items-center'}>
              <div className={'h-2 w-2 rounded-full bg-billing-primary'} />
            </div>
            <div className='flex-1 whitespace-pre-wrap break-words'>{t('subscribe.AIMax.points.first')}</div>
          </div>
          <div className='flex items-center gap-2'>
            <div className={'flex h-6 items-center'}>
              <div className={'h-2 w-2 rounded-full bg-billing-primary'} />
            </div>
            <div className='flex-1 whitespace-pre-wrap break-words'>{t('subscribe.AIMax.points.second')}</div>
          </div>

          <div className='flex items-center gap-2'>
            <div className={'flex h-6 items-center'}>
              <div className={'h-2 w-2 rounded-full bg-billing-primary'} />
            </div>
            <div className='flex-1 whitespace-pre-wrap break-words'>{t('subscribe.AIMax.points.third')}</div>
          </div>
        </div>
      </div>
      <NormalModal
        title={<div className={'w-full text-left'}>{t('subscribe.AIMax.removeTitle')}</div>}
        classes={{ paper: 'w-[420px]' }}
        open={cancelOpen}
        onOk={handleCancel}
        danger
        onClose={() => {
          setCancelOpen(false);
        }}
        okLoading={cancelLoading}
        onCancel={() => {
          setCancelOpen(false);
        }}
        okText={t('button.confirm')}
      >
        <div className={'opacity-80'}>{t('subscribe.AIMax.removeDescription')}</div>
      </NormalModal>
    </NormalModal>
  );
}

export default UpgradeAIMax;
