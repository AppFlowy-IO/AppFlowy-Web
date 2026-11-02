import { ReactNode } from 'react';

export interface ChartSettingsSectionProps {
  id: string;
  /** The header (12/16/500 secondary); empty for a section without one. */
  title: string;
  children: ReactNode;
}

/** A titled group of panel rows (WP11 §1.2): header padding 8 8 4, 4px above the first row. */
export function ChartSettingsSection({ id, title, children }: ChartSettingsSectionProps) {
  return (
    <div data-testid={`chart-settings-section-${id}`} data-section-title={title} className='flex flex-col'>
      {title ? (
        <div className='px-2 pb-1 pt-2 text-xs font-medium leading-4 text-text-secondary' data-section-header>
          {title}
        </div>
      ) : null}
      <div className='flex flex-col'>{children}</div>
    </div>
  );
}

export default ChartSettingsSection;
