import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as InfoIcon } from '@/assets/icons/info.svg';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getErrorMessage } from '@/utils/errors';

/** Header and scrollable body shared by the settings panels (same markup as the account panel). */
export function SettingsPanelShell({ title, testId, children }: { title: string; testId?: string; children: ReactNode }) {
  return (
    <div className='flex h-full min-h-0 flex-1 flex-col overflow-hidden' data-testid={testId}>
      <div className='border-b border-border-primary px-8 py-5'>
        <h2 className='text-xl font-semibold text-text-primary'>{title}</h2>
      </div>
      <div className='appflowy-scroller flex-1 overflow-y-auto px-8 py-6'>
        <div className='flex flex-col gap-6'>{children}</div>
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
  return (
    <div className='flex flex-col gap-4'>
      <div className='flex items-center gap-2'>
        <div className='text-base font-semibold text-text-primary'>{title}</div>
        {tooltip && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className='cursor-default text-icon-secondary'>
                <InfoIcon className='h-4 w-4' />
              </span>
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
