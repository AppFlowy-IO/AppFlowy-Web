import { ReactNode, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { ReactComponent as ErrorLogo } from '@/assets/icons/warning_logo.svg';
import { getLandingPageErrorContent, LandingPageError } from '@/components/_shared/landing-page/errorContent';
import LandingPage from '@/components/_shared/landing-page/LandingPage';
import { Progress } from '@/components/ui/progress';

interface ErrorPageProps {
  onRetry?: () => Promise<void>;
  error?: LandingPageError;
  title?: ReactNode;
  description?: ReactNode;
}

export function ErrorPage({ onRetry, error, title, description }: ErrorPageProps) {
  const { t } = useTranslation();

  const [loading, setLoading] = useState(false);
  const errorContent = useMemo(() => getLandingPageErrorContent(error, t), [error, t]);

  const handleCopyError = useCallback(async () => {
    if (!error) return;

    const errorText = error.code ? `Error: ${error.message}\nCode: ${error.code}` : `Error: ${error.message}`;

    try {
      await navigator.clipboard.writeText(errorText);
      toast.success('Error details copied to clipboard', { duration: 3000 });
    } catch (e) {
      console.error('Failed to copy:', e);
      toast.error('Failed to copy error details', { duration: 3000 });
    }
  }, [error]);

  return (
    <LandingPage
      Logo={ErrorLogo}
      title={title ?? errorContent.title}
      description={
        <>
          <div>{description ?? errorContent.description}</div>
          <div className='mt-4'>
            {t('landingPage.error.contactSupport', 'If the problem persists, ')}
            {error?.message && (
              <>
                <span onClick={handleCopyError} className='cursor-pointer text-text-action hover:underline'>
                  {t('landingPage.error.copyError', 'copy error')}
                </span>
                {' and '}
              </>
            )}
            {t('landingPage.error.contact', 'contact ')}
            <span
              onClick={() => window.open('mailto:support@appflowy.io', '_blank')}
              className='cursor-pointer text-text-action hover:underline'
            >
              support@appflowy.io
            </span>
            .
          </div>
        </>
      }
      primaryAction={
        onRetry
          ? {
              onClick: async () => {
                try {
                  setLoading(true);
                  await onRetry();
                  setLoading(false);
                } catch (e) {
                  setLoading(false);
                }
              },
              label: loading ? (
                <span className='flex items-center gap-2'>
                  <Progress />
                  {t('landingPage.error.retry')}
                </span>
              ) : (
                t('landingPage.error.retry')
              ),
            }
          : undefined
      }
      secondaryAction={{
        onClick: () => window.open('/app', '_self'),
        label: t('landingPage.backToHome'),
      }}
    />
  );
}
