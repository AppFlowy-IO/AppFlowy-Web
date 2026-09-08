import { useTranslation } from 'react-i18next';

import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { ReactComponent as WarningIcon } from '@/assets/icons/warning.svg';
import { Button } from '@/components/ui/button';

import { useClientCompatibility } from './ClientCompatibility';

/** An inline reminder: navigation and editing remain available while either side is upgraded. */
export function ClientCompatibilityBanner() {
  const compatibility = useClientCompatibility();
  const warning = compatibility?.warning;
  const { t } = useTranslation();

  if (!warning) return null;

  const message =
    warning.type === 'server-too-old'
      ? t('clientCompatibility.serverTooOld', warning)
      : t(warning.remedyReachable ? 'clientCompatibility.clientTooOld' : 'clientCompatibility.upgradeBoth', warning);

  return (
    <div
      role='status'
      aria-live='polite'
      data-testid='client-compatibility-banner'
      className='flex w-full shrink-0 items-start gap-3 bg-fill-warning-light px-4 py-3 text-text-warning sm:items-center'
    >
      <WarningIcon aria-hidden='true' className='mt-0.5 h-5 w-5 shrink-0 text-icon-warning-thick sm:mt-0' />
      <div className='flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2'>
        <p className='min-w-0 flex-1 basis-64 text-sm'>{message}</p>
        {warning.type === 'client-too-old' && warning.remedyReachable && (
          <Button size='sm' onClick={() => window.location.reload()}>
            {t('clientCompatibility.reload')}
          </Button>
        )}
      </div>
      <Button
        variant='ghost'
        size='icon-sm'
        aria-label={t('clientCompatibility.dismiss')}
        onClick={compatibility.dismiss}
      >
        <CloseIcon aria-hidden='true' className='h-5 w-5' />
      </Button>
    </div>
  );
}
