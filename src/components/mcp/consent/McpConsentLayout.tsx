import { HTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as AppFlowyLogo } from '@/assets/icons/appflowy.svg';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

/** Visible keyboard focus for the consent page's buttons (the Button primitive removes the outline), offset from the page so it shows around Filled Blue. */
export const CONSENT_FOCUS_RING =
  'focus-visible:ring-2 focus-visible:ring-border-theme-thick focus-visible:ring-offset-2 focus-visible:ring-offset-background-primary';

/** The 20 px target around a consent checkbox and its tick (Figma Checkbox 2322:39924); a checked, disabled box drops to 40 %. */
export const CONSENT_CHECKBOX_TARGET =
  'relative flex h-5 w-5 shrink-0 items-center justify-center has-[:checked:disabled]:opacity-40';

/**
 * A native checkbox drawn to the Figma box (1913:1173): 14 px, radius 4, a 1.25 px Border/primary, Fill/theme-thick
 * when checked. Pass it as a plain className: tailwind-merge drops `focus-visible:outline`.
 */
export const CONSENT_CHECKBOX =
  'peer h-3.5 w-3.5 cursor-[inherit] appearance-none rounded-100 border-[1.25px] border-border-primary bg-fill-content transition-colors checked:border-transparent checked:bg-fill-theme-thick focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-theme-thick enabled:hover:border-border-primary-hover enabled:checked:hover:border-transparent enabled:checked:hover:bg-fill-theme-thick-hover [&:disabled:not(:checked)]:bg-fill-content-hover';

/** The Icon/on-fill tick drawn over a checked CONSENT_CHECKBOX, as its next sibling. */
export const CONSENT_CHECK_MARK = 'pointer-events-none absolute hidden h-3 w-3 text-icon-on-fill peer-checked:block';

/**
 * The consent page shell: the AppFlowy logo above a centered 400 px column, like the
 * landing pages. Props go to the column (test ids, roles). The logo is not a
 * link, so nothing on the page leads away from the decision (the consent
 * view's "Learn more" opens a new tab). The shell is its own scroll container:
 * the app's body never scrolls (`overflow: hidden`), and a column with many
 * workspaces is taller than the window.
 */
export function McpConsentLayout({ children, className, ...columnProps }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className='appflowy-scroller flex h-screen w-full flex-col overflow-y-auto bg-background-primary'>
      <header className='flex h-[60px] w-full shrink-0 items-center px-5 py-4'>
        <AppFlowyLogo className='h-full w-[141px]' role='img' aria-label='AppFlowy' />
      </header>
      <main className='flex w-full flex-1 justify-center px-4 pb-16 pt-4 sm:items-center sm:pt-0'>
        <div
          {...columnProps}
          className={cn('flex w-full min-w-0 max-w-[400px] flex-col gap-6 text-text-primary', className)}
        >
          {children}
        </div>
      </main>
    </div>
  );
}

/**
 * Spinner while the request, the user's workspaces or the sign-in
 * redirect are pending. `retrying`: AppFlowy's server-info failed and the page
 * keeps asking, which the spinner alone would not tell from a slow load.
 */
export function McpConsentLoading({ retrying = false }: { retrying?: boolean }) {
  const { t } = useTranslation();

  return (
    <McpConsentLayout data-testid='mcp-consent-loading'>
      <div
        role='status'
        aria-label={retrying ? undefined : t('loading')}
        className='flex flex-col items-center gap-4 py-12'
      >
        <Progress variant='primary' />
        {retrying && (
          <p className='text-center text-sm text-text-secondary' data-testid='mcp-consent-retrying'>
            {t('mcp.serverInfoRetrying')}
          </p>
        )}
      </div>
    </McpConsentLayout>
  );
}

export default McpConsentLayout;
