import { ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as InfoIcon } from '@/assets/icons/info.svg';
import { MoreBelowFade, useMoreContentBelow } from '@/components/_shared/scroller/MoreBelowFade';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { getErrorMessage } from '@/utils/errors';

/**
 * Every button in a settings panel shows where keyboard focus is (the shared Button has no focus
 * style). The gap keeps the ring visible around a filled theme button, which has the ring's color.
 */
const BUTTON_FOCUS_RING =
  '[&_button:focus-visible]:outline-none [&_button:focus-visible]:ring-2 [&_button:focus-visible]:ring-border-theme-thick [&_button:focus-visible]:ring-offset-2 [&_button:focus-visible]:ring-offset-surface-primary';

/** Header and scrollable body shared by the settings panels (same markup as the account panel). */
export function SettingsPanelShell({ title, testId, children }: { title: string; testId?: string; children: ReactNode }) {
  const [scrollArea, setScrollArea] = useState<HTMLDivElement | null>(null);
  const moreBelow = useMoreContentBelow(scrollArea);

  return (
    <div className={cn('flex h-full min-h-0 flex-1 flex-col overflow-hidden', BUTTON_FOCUS_RING)} data-testid={testId}>
      <div className='border-b border-border-primary px-8 py-5'>
        <h2 className='text-xl font-semibold text-text-primary'>{title}</h2>
      </div>
      {/* No vertical padding on the scroll area itself, so the fade sits right at its bottom edge. */}
      <div ref={setScrollArea} className='appflowy-scroller flex-1 overflow-y-auto px-8'>
        <div className='flex flex-col gap-6 py-6'>{children}</div>
        <MoreBelowFade visible={moreBelow} />
      </div>
    </div>
  );
}

export function SettingsSection({
  title,
  tooltip,
  children,
}: {
  title: string;
  tooltip?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex items-center gap-2'>
        <div className='text-base font-semibold text-text-primary'>{title}</div>
        {tooltip && (
          <Tooltip>
            {/* A real button, so keyboard users can focus it: the explanation opens on focus too. */}
            <TooltipTrigger asChild>
              <Button
                type='button'
                variant='ghost'
                size='icon-sm'
                aria-label={t('settings.sectionInfo', { title, interpolation: { escapeValue: false } })}
                className='text-icon-secondary focus-visible:ring-2 focus-visible:ring-border-theme-thick'
              >
                <InfoIcon aria-hidden='true' className='h-4 w-4' />
              </Button>
            </TooltipTrigger>
            <TooltipContent className='max-w-[320px]'>{tooltip}</TooltipContent>
          </Tooltip>
        )}
      </div>
      {children}
    </div>
  );
}

export function SettingsDivider() {
  return <div className='border-t border-border-primary' />;
}

export function SettingsPanelLoading({ label }: { label: string }) {
  return (
    <div role='status' aria-label={label} className='flex h-full items-center justify-center'>
      <Progress variant='primary' />
    </div>
  );
}

export function SettingsPanelError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useTranslation();

  return (
    <div className='flex flex-col items-start gap-3' data-testid='billing-error'>
      <div className='text-sm text-text-secondary'>{getErrorMessage(error)}</div>
      <Button variant='outline' size='default' onClick={onRetry}>
        {t('button.retry')}
      </Button>
    </div>
  );
}
