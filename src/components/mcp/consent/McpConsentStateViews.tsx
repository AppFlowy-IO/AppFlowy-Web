import { useTranslation } from 'react-i18next';

import { ReactComponent as ErrorIcon } from '@/assets/icons/error.svg';
import { ReactComponent as SuccessIcon } from '@/assets/icons/success.svg';
import { ReactComponent as TimeIcon } from '@/assets/icons/time.svg';
import { RAW_INTERPOLATION } from '@/components/mcp/rawInterpolation';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { consentErrorMessageKey, type ConsentErrorReason } from './consentModel';
import { McpConsentAccount, type McpConsentAccountProps } from './McpConsentAccount';
import { CONSENT_FOCUS_RING, McpConsentLayout } from './McpConsentLayout';

/** "Cancel and return to …" on an error view: the server-validated `access_denied` redirect. */
export interface McpConsentCancelProps {
  /** The app's display name; without it the button just reads "Cancel". */
  name?: string;
  onCancel: () => void;
  /** The deny request is in flight; every button waits for it. */
  busy: boolean;
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
      <div className='flex flex-col items-center gap-3 text-center'>
        <ErrorIcon className='h-10 w-10 text-icon-error-thick' aria-hidden='true' />
        <h1 className='text-xl font-semibold text-text-primary'>{t('mcp.consent.errorTitle')}</h1>
        <p role='alert' className='text-sm text-text-secondary' data-testid='mcp-consent-error-message'>
          {t(consentErrorMessageKey(reason))}
        </p>
      </div>
      {(onRetry || cancel) && (
        <div className='flex flex-col gap-3'>
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
      {account && <McpConsentAccount {...account} disabled={account.disabled || cancelling} />}
    </McpConsentLayout>
  );
}

/** Access granted; the browser is on its way back to the app. */
export function McpConsentDoneView({ name }: { name: string }) {
  const { t } = useTranslation();

  return (
    <McpConsentLayout data-testid='mcp-consent-done'>
      <div className='flex flex-col items-center gap-3 text-center'>
        <SuccessIcon className='h-10 w-10 text-icon-success-thick' aria-hidden='true' />
        <h1 className='text-xl font-semibold text-text-primary'>{t('mcp.consent.doneTitle')}</h1>
        <p role='status' className='text-sm text-text-secondary'>
          {t('mcp.consent.doneDescription', { name, ...RAW_INTERPOLATION })}
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
      <div className='flex flex-col items-center gap-3 text-center'>
        <SuccessIcon className='h-10 w-10 text-icon-success-thick' aria-hidden='true' />
        <h1 className='text-xl font-semibold text-text-primary'>{t('mcp.consent.requestSentTitle')}</h1>
        <p role='status' className='text-sm text-text-secondary'>
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
      <div className='flex flex-col items-center gap-3 text-center'>
        <TimeIcon className='h-10 w-10 text-icon-warning-thick' aria-hidden='true' />
        <h1 className='text-xl font-semibold text-text-primary'>{t('mcp.consent.expiredTitle')}</h1>
        <p role='status' className='text-sm text-text-secondary' data-testid='mcp-consent-expired-message'>
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
      className='flex min-h-screen w-full items-center justify-center bg-background-primary p-6'
      data-testid='mcp-consent-framed'
    >
      <p role='alert' className='max-w-[480px] text-center text-sm text-text-primary'>
        {t('mcp.consent.framed')}
      </p>
    </div>
  );
}
