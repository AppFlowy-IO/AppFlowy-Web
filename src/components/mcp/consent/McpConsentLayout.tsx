import { HTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as AppFlowyLogo } from '@/assets/icons/appflowy.svg';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

/** Visible keyboard focus for the consent page's buttons (the Button primitive removes the outline). */
export const CONSENT_FOCUS_RING = 'focus-visible:ring-2 focus-visible:ring-border-theme-thick';

/**
 * The consent page shell: the AppFlowy logo above a centered card, like the
 * landing pages. Props go to the card (test ids, roles). The logo is not a
 * link, so nothing on the page leads away from the decision (the consent
 * view's "Learn more" opens a new tab).
 */
export function McpConsentLayout({ children, className, ...cardProps }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className='flex min-h-screen w-full flex-col bg-background-primary'>
      <header className='flex h-[60px] w-full shrink-0 items-center p-4'>
        <AppFlowyLogo className='h-full w-[141px]' role='img' aria-label='AppFlowy' />
      </header>
      <main className='flex w-full flex-1 justify-center px-4 pb-16 pt-4 sm:items-center sm:pt-0'>
        <div
          {...cardProps}
          className={cn(
            'flex w-full min-w-0 max-w-[480px] flex-col gap-6 rounded-500 border border-border-primary bg-surface-primary p-6 text-text-primary shadow-card sm:p-8',
            className
          )}
        >
          {children}
        </div>
      </main>
    </div>
  );
}

/** Spinner card while the request, the user's workspaces or the sign-in redirect are pending. */
export function McpConsentLoading() {
  const { t } = useTranslation();

  return (
    <McpConsentLayout data-testid='mcp-consent-loading'>
      <div role='status' aria-label={t('loading')} className='flex justify-center py-12'>
        <Progress variant='primary' />
      </div>
    </McpConsentLayout>
  );
}

export default McpConsentLayout;
