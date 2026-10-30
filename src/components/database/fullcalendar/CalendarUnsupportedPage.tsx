import { useTranslation } from 'react-i18next';

import { ReactComponent as CalendarLogo } from '@/assets/icons/warning_logo.svg';
import { Button } from '@/components/ui/button';

export function CalendarUnsupportedPage() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-center py-16 max-sm:py-6 px-4">
      {/* Icon */}
      <div className="mb-6">
        <CalendarLogo className="w-12 h-12 text-text-placeholder" />
      </div>
      
      {/* Title */}
      <h2 className="text-lg font-semibold text-text-title mb-4 text-center">
        Calendar Not Supported
      </h2>
      
      {/* Description */}
      <p className="text-text-caption text-center mb-8 max-w-md">
        Calendar view is not supported on this device. For the best calendar experience, please download the CustomerIK mobile app.
      </p>
      
      {/* Buttons */}
      <div className="flex flex-col max-sm:w-full sm:flex-row gap-3">
        <Button
          onClick={() => window.open('https://appflowy.com/download', '_blank')}
        >
          Download CustomerIK
        </Button>
        <Button
          variant="outline"
          onClick={() => window.open('/app', '_self')}
        >
          {t('landingPage.backToHome')}
        </Button>
      </div>
    </div>
  );
}