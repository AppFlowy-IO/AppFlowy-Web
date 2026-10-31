import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as BackIcon } from '@/assets/icons/alt_arrow_left.svg';
import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { cn } from '@/lib/utils';

import { DASHBOARD_MOTION_FAST_CLASS } from '../constants';

interface DockPanelHeaderProps {
  title: ReactNode;
  onBack?: () => void;
  onClose: () => void;
  /** Test id and parity id prefix of the header parts (`dashboard-widget-picker` → `-back`, `-close`). */
  testIdPrefix: string;
  parityPrefix?: string;
}

/**
 * The 40px header of a docked panel (WP06 §1.4): a 24px back button, the
 * title (14/20/600) and a round 20px close button on the hover fill.
 */
export function DockPanelHeader({ title, onBack, onClose, testIdPrefix, parityPrefix }: DockPanelHeaderProps) {
  const { t } = useTranslation();

  return (
    <div className='flex h-10 shrink-0 items-center gap-1 px-1'>
      {onBack ? (
        <button
          aria-label={t('dashboard.picker.back', { defaultValue: 'Back' })}
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-dash-tool-icon outline-none transition-colors',
            'hover:bg-dash-hover-fill focus-visible:bg-dash-hover-fill',
            DASHBOARD_MOTION_FAST_CLASS
          )}
          data-parity-id={parityPrefix ? `${parityPrefix}-back` : undefined}
          data-testid={`${testIdPrefix}-back`}
          onClick={onBack}
          type='button'
        >
          <BackIcon
            aria-hidden='true'
            className='h-4 w-4'
            data-parity-id={parityPrefix ? `${parityPrefix}-back__icon` : undefined}
          />
        </button>
      ) : null}
      <span
        className='min-w-0 flex-1 truncate px-1 text-sm font-semibold leading-5 text-text-primary'
        data-parity-id={parityPrefix ? `${parityPrefix}__title` : undefined}
      >
        {title}
      </span>
      <button
        aria-label={t('dashboard.picker.close', { defaultValue: 'Close' })}
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-dash-hover-fill text-dash-tool-icon outline-none transition-colors',
          'hover:bg-fill-content-hover focus-visible:ring-2 focus-visible:ring-dash-accent',
          DASHBOARD_MOTION_FAST_CLASS
        )}
        data-parity-id={parityPrefix ? `${parityPrefix}-close` : undefined}
        data-testid={`${testIdPrefix}-close`}
        onClick={onClose}
        type='button'
      >
        <CloseIcon
          aria-hidden='true'
          className='h-4 w-4'
          data-parity-id={parityPrefix ? `${parityPrefix}-close__icon` : undefined}
        />
      </button>
    </div>
  );
}

export default DockPanelHeader;
