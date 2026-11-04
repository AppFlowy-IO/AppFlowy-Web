import { useTranslation } from 'react-i18next';

import { ReactComponent as InfoIcon } from '@/assets/icons/info.svg';
import { ReactComponent as SuccessLogo } from '@/assets/icons/success_logo.svg';
import { ReactComponent as TimeIcon } from '@/assets/icons/time.svg';
import { ReactComponent as WarningLogo } from '@/assets/icons/warning_logo.svg';
import { RAW_INTERPOLATION } from '@/components/mcp/rawInterpolation';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { consentErrorMessageKey, type ConsentErrorReason } from './consentModel';
import { McpConsentAccount, type McpConsentAccountProps } from './McpConsentAccount';
import { CONSENT_FOCUS_RING, McpConsentLayout } from './McpConsentLayout';
import { McpConsentNotice } from './McpConsentNotice';

/** "Cancel and return to …" on an error view: the server-validated `access_denied` redirect. */
export interface McpConsentCancelProps {
  /** The app's display name; without it the button just reads "Cancel". */
  name?: string;
  onCancel: () => void;
  /** The deny request is in flight; every button waits for it. */
  busy: boolean;
  /** Why the last Cancel failed for a transient reason; the button stays and a note says so. */
  error?: ConsentErrorReason | null;
}

export interface McpConsentErrorViewProps {
  reason: ConsentErrorReason;
  /** Offers "Try again" for transient failures. */
  onRetry?: () => void;
  /** Offers "Use a different account" when another account may succeed. */
  account?: McpConsentAccountProps;
  /** Offers to cancel and return to the app, when the request can still be denied. */
  cancel?: McpConsentCancelProps;
}

/** Why this app cannot be connected; it redirects to the client only through Cancel's validated deny. */
export function McpConsentErrorView({ reason, onRetry, account, cancel }: McpConsentErrorViewProps) {
  const { t } = useTranslation();
  const cancelling = Boolean(cancel?.busy);

  return (
    <McpConsentLayout data-testid='mcp-consent-error' data-reason={reason} aria-busy={cancelling || undefined}>
      <div className='flex flex-col items-center gap-6 text-center'>
        <WarningLogo className='h-16 w-16' aria-hidden='true' />
        <h1 className='text-xl font-bold text-text-primary'>{t('mcp.consent.errorTitle')}</h1>
        <p role='alert' className='max-w-80 text-sm text-text-primary' data-testid='mcp-consent-error-message'>
          {t(consentErrorMessageKey(reason))}
        </p>
      </div>
      {cancel?.error && (
        <McpConsentNotice tone='error' data-testid='mcp-consent-cancel-error' data-reason={cancel.error}>
          <p role='alert'>{t(consentErrorMessageKey(cancel.error))}</p>
        </McpConsentNotice>
      )}
      {(onRetry || cancel) && (
        <div className='flex w-full max-w-80 flex-col gap-3 self-center'>
          {onRetry && (
            <Button
              size='lg'
              className={cn('w-full', CONSENT_FOCUS_RING)}
              onClick={onRetry}
              disabled={cancelling}
              data-testid='mcp-consent-error-retry'
            >
              {t('mcp.consent.tryAgain')}
            </Button>
          )}
          {cancel && (
            <Button
              variant='outline'
              size='lg'
              className={cn('w-full', CONSENT_FOCUS_RING)}
              onClick={cancel.onCancel}
              disabled={cancelling}
              loading={cancelling}
              data-testid='mcp-consent-error-cancel'
            >
              {cancel.name
                ? t('mcp.consent.cancelAndReturn', { name: cancel.name, ...RAW_INTERPOLATION })
                : t('mcp.consent.cancel')}
            </Button>
          )}
        </div>
      )}
      {account && (
        // Figma landing page 4841:879: the footer sits 40 px below the form (the column's 24 + 16).
        <div className='mt-4'>
          <McpConsentAccount {...account} disabled={account.disabled || cancelling} />
        </div>
      )}
    </McpConsentLayout>
  );
}

/** Access granted; the browser is on its way back to the app. */
export function McpConsentDoneView({ name }: { name: string }) {
  const { t } = useTranslation();

  return (
    <McpConsentLayout data-testid='mcp-consent-done'>
      <div className='flex flex-col items-center gap-6 text-center'>
        <SuccessLogo className='h-16 w-16' aria-hidden='true' />
        <h1 className='text-xl font-bold text-text-primary'>{t('mcp.consent.doneTitle')}</h1>
        <p role='status' className='max-w-80 text-sm text-text-primary'>
          {t('mcp.consent.doneDescription', { name, ...RAW_INTERPOLATION })}
        </p>
      </div>
    </McpConsentLayout>
  );
}

/**
 * The user cancelled and the server validated the `access_denied` redirect;
 * the browser is on its way back to the app. A private-use scheme opens the
 * app and keeps this tab, so this view stays and says what happened.
 */
export function McpConsentCancelledView({ name }: { name: string }) {
  const { t } = useTranslation();

  return (
    <McpConsentLayout data-testid='mcp-consent-cancelled'>
      <div className='flex flex-col items-center gap-6 text-center'>
        <InfoIcon className='h-16 w-16 text-icon-info-thick' aria-hidden='true' />
        <h1 className='text-xl font-bold text-text-primary'>{t('mcp.consent.cancelledTitle')}</h1>
        <p role='status' className='max-w-80 text-sm text-text-primary'>
          {t('mcp.consent.cancelledDescription', { name, ...RAW_INTERPOLATION })}
        </p>
      </div>
    </McpConsentLayout>
  );
}

/** A member asked the workspace owners to approve the app. */
export function McpConsentRequestSentView({ name }: { name: string }) {
  const { t } = useTranslation();

  return (
    <McpConsentLayout data-testid='mcp-consent-request-sent'>
      <div className='flex flex-col items-center gap-6 text-center'>
        <SuccessLogo className='h-16 w-16' aria-hidden='true' />
        <h1 className='text-xl font-bold text-text-primary'>{t('mcp.consent.requestSentTitle')}</h1>
        <p role='status' className='max-w-80 text-sm text-text-primary'>
          {t('mcp.consent.requestSentDescription', { name, ...RAW_INTERPOLATION })}
        </p>
      </div>
    </McpConsentLayout>
  );
}

/**
 * Sign-in took longer than the Web waits for a consent request
 * (`MCP_CONSENT_AUTH_CONTINUATION_TTL_MS`), so the AI app has most likely
 * given up and has to start again. Nothing on it redirects.
 */
export function McpConsentExpiredView({ name }: { name?: string }) {
  const { t } = useTranslation();

  return (
    <McpConsentLayout data-testid='mcp-consent-expired'>
      <div className='flex flex-col items-center gap-6 text-center'>
        <TimeIcon className='h-16 w-16 text-icon-warning-thick' aria-hidden='true' />
        <h1 className='text-xl font-bold text-text-primary'>{t('mcp.consent.expiredTitle')}</h1>
        <p role='status' className='max-w-80 text-sm text-text-primary' data-testid='mcp-consent-expired-message'>
          {name
            ? t('mcp.consent.expiredDescription', { name, ...RAW_INTERPOLATION })
            : t('mcp.consent.expiredDescriptionUnnamed')}
        </p>
      </div>
    </McpConsentLayout>
  );
}

/**
 * Shown instead of everything else when the page is inside a frame: no data
 * is loaded, nothing redirects and there is nothing to click.
 */
export function McpConsentFramedView() {
  const { t } = useTranslation();

  return (
    <div
      className='flex min-h-screen w-full items-center justify-center bg-background-primary p-4'
      data-testid='mcp-consent-framed'
    >
      <p role='alert' className='max-w-[400px] text-center text-sm text-text-primary'>
        {t('mcp.consent.framed')}
      </p>
    </div>
  );
}
