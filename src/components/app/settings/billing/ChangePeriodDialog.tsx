import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SubscriptionInterval, SubscriptionPlan } from '@/application/types';
import { NormalModal } from '@/components/_shared/modal';
import { usePricingCatalog } from '@/components/app/hooks/usePricingCatalog';
import { cn } from '@/lib/utils';
import { findPlan, formatPriceCents, getPlanPrice } from '@/utils/pricing';

import { intervalLabel } from './labels';

interface ChangePeriodDialogProps {
  open: boolean;
  plan: SubscriptionPlan;
  currentInterval: SubscriptionInterval;
  onClose: () => void;
  onConfirm: (interval: SubscriptionInterval) => void;
}

const INTERVALS = [SubscriptionInterval.Month, SubscriptionInterval.Year];

/** Switches a subscription between monthly and yearly billing; prices come from the pricing catalog. */
export function ChangePeriodDialog({ open, plan, currentInterval, onClose, onConfirm }: ChangePeriodDialogProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState(currentInterval);
  const { catalog } = usePricingCatalog({ enabled: open });
  const catalogPlan = catalog ? findPlan(catalog, plan) : undefined;

  useEffect(() => {
    if (open) setSelected(currentInterval);
  }, [currentInterval, open]);

  const unchanged = selected === currentInterval;

  return (
    <NormalModal
      open={open}
      title={t('settings.billingPage.changePeriod')}
      okText={t('button.confirm')}
      cancelText={t('button.cancel')}
      onClose={onClose}
      onCancel={onClose}
      okButtonProps={{ disabled: unchanged, 'data-testid': 'change-period-confirm' }}
      onOk={() => {
        if (!unchanged) onConfirm(selected);
        onClose();
      }}
      classes={{ paper: 'w-[440px]' }}
    >
      <div className='flex flex-col gap-3'>
        {INTERVALS.map((interval) => {
          const isCurrent = interval === currentInterval;
          const isSelected = interval === selected;
          const price = catalogPlan ? getPlanPrice(catalogPlan, interval) : undefined;

          return (
            <button
              key={interval}
              type='button'
              data-testid={`period-option-${interval}`}
              aria-pressed={isSelected}
              disabled={isCurrent}
              onClick={() => setSelected(interval)}
              className={cn(
                'flex items-center justify-between rounded-[12px] border p-4 text-left',
                isSelected ? 'border-border-theme-thick' : 'border-border-primary',
                isCurrent && !isSelected && 'opacity-70'
              )}
            >
              <div className='flex flex-col gap-1'>
                <div className='flex items-center gap-2'>
                  <span className='text-base font-medium text-text-primary'>{intervalLabel(t, interval)}</span>
                  {isCurrent && (
                    <span className='rounded-[6px] bg-fill-theme-thick px-1.5 text-[11px] font-medium text-text-on-fill'>
                      {t('settings.billingPage.currentPeriodBadge')}
                    </span>
                  )}
                </div>
                {price && (
                  <span className='text-sm font-medium text-text-primary'>{formatPriceCents(price.price_cents)}</span>
                )}
                <span className='text-xs text-text-secondary'>
                  {interval === SubscriptionInterval.Year
                    ? t('settings.billingPage.annualPriceInfo')
                    : t('settings.billingPage.monthlyPriceInfo')}
                </span>
              </div>
              <span
                aria-hidden
                className={cn(
                  'flex h-5 w-5 items-center justify-center rounded-full border',
                  isSelected ? 'border-border-theme-thick' : 'border-border-primary'
                )}
              >
                {isSelected && <span className='h-2.5 w-2.5 rounded-full bg-fill-theme-thick' />}
              </span>
            </button>
          );
        })}
      </div>
    </NormalModal>
  );
}
