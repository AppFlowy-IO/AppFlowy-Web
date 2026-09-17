import { useTranslation } from 'react-i18next';

import { ReactComponent as WarningLogo } from '@/assets/icons/warning_logo.svg';

/** Shown when the view's timeline field is missing or is not a date property. */
export function TimelineUnsupported() {
  const { t } = useTranslation();

  return (
    <div className='flex flex-col items-center justify-center px-4 py-16 max-sm:py-6' data-testid='timeline-unsupported'>
      <WarningLogo className='mb-6 h-12 w-12 text-text-placeholder' />
      <h2 className='mb-2 text-center text-lg font-semibold text-text-title'>
        {t('timeline.settings.unsupportedTitle', { defaultValue: 'This timeline has no date property' })}
      </h2>
      <p className='max-w-md text-center text-text-caption'>
        {t('timeline.settings.unsupportedHint', {
          defaultValue: 'Add a date property to the database, or pick one in the timeline settings.',
        })}
      </p>
    </div>
  );
}

export default TimelineUnsupported;
