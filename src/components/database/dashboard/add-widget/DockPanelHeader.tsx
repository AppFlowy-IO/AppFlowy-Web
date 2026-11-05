import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as BackIcon } from '@/assets/icons/alt_arrow_left.svg';
import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { DASHBOARD_MOTION_FAST_CLASS } from '../constants';
import { DASHBOARD_ICON_BUTTON_CLASS } from '../dashboard-ui';

interface DockPanelHeaderProps {
  title: ReactNode;
  onBack?: () => void;
  onClose: () => void;
  /** Test id and parity id prefix of the header parts (`dashboard-widget-picker` → `-back`, `-close`). */
  testIdPrefix: string;
  parityPrefix?: string;
}

/**
 * The dock header groups its title and 32px navigation controls above a
 * semantic divider. Both icon buttons expose their keyboard focus state.
 */
export function DockPanelHeader({ title, onBack, onClose, testIdPrefix, parityPrefix }: DockPanelHeaderProps) {
  const { t } = useTranslation();

  return (
    <div className='mb-2 flex min-h-10 shrink-0 items-center gap-1 border-b border-border-primary pb-2'>
      {onBack ? (
        <Button
          aria-label={t('dashboard.picker.back', { defaultValue: 'Back' })}
          className={cn(DASHBOARD_ICON_BUTTON_CLASS, 'shrink-0 transition-colors', DASHBOARD_MOTION_FAST_CLASS)}
          data-parity-id={parityPrefix ? `${parityPrefix}-back` : undefined}
          data-testid={`${testIdPrefix}-back`}
          onClick={onBack}
          variant='ghost'
          size='icon-lg'
          type='button'
        >
          <BackIcon
            aria-hidden='true'
            className='h-5 w-5'
            data-parity-id={parityPrefix ? `${parityPrefix}-back__icon` : undefined}
          />
        </Button>
      ) : null}
      <span
        className='min-w-0 flex-1 truncate px-1 text-sm font-semibold leading-5 text-text-primary'
        data-parity-id={parityPrefix ? `${parityPrefix}__title` : undefined}
      >
        {title}
      </span>
      <Button
        aria-label={t('dashboard.picker.close', { defaultValue: 'Close' })}
        className={cn(DASHBOARD_ICON_BUTTON_CLASS, 'shrink-0 transition-colors', DASHBOARD_MOTION_FAST_CLASS)}
        data-parity-id={parityPrefix ? `${parityPrefix}-close` : undefined}
        data-testid={`${testIdPrefix}-close`}
        onClick={onClose}
        variant='ghost'
        size='icon-lg'
        type='button'
      >
        <CloseIcon
          aria-hidden='true'
          className='h-5 w-5'
          data-parity-id={parityPrefix ? `${parityPrefix}-close__icon` : undefined}
        />
      </Button>
    </div>
  );
}

export default DockPanelHeader;
