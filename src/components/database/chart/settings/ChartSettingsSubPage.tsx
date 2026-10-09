import { ReactNode, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as BackIcon } from '@/assets/icons/alt_arrow_left.svg';

export interface ChartSettingsSubPageProps {
  title: string;
  onBack: () => void;
  /** The control that takes focus when the page opens (a search box); the back button otherwise. */
  autoFocusBack?: boolean;
  children: ReactNode;
}

/**
 * A page pushed onto the panel (WP11 §1.2): a pinned 28px header with a
 * 24×24 back button and the title, then the page content. No animation.
 */
export function ChartSettingsSubPage({ title, onBack, autoFocusBack = true, children }: ChartSettingsSubPageProps) {
  const { t } = useTranslation();
  const backRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (autoFocusBack) backRef.current?.focus();
  }, [autoFocusBack]);

  return (
    <div className='flex min-h-0 flex-col' data-testid='chart-settings-subpage' data-page-title={title}>
      <div className='sticky top-0 z-[1] flex h-7 shrink-0 items-center gap-1 bg-surface-primary'>
        <button
          ref={backRef}
          type='button'
          aria-label={t('chart.settings.back', { defaultValue: 'Back' })}
          data-testid='chart-settings-back'
          data-parity-id='dash-chart-panel-back'
          className='flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-dash-tool-icon outline-none hover:bg-dash-hover-fill focus-visible:bg-dash-hover-fill'
          onClick={onBack}
        >
          <BackIcon aria-hidden='true' className='h-4 w-4' data-parity-id='dash-chart-panel-back__icon' />
        </button>
        <span className='min-w-0 flex-1 truncate text-sm font-medium leading-5 text-text-primary'>{title}</span>
      </div>
      <div className='flex flex-col pt-1'>{children}</div>
    </div>
  );
}

export default ChartSettingsSubPage;
