import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { getMcpClientDisplayName } from '@/application/mcp/setup';
import { signOutCurrentUser } from '@/application/session/sign-out';
import { getTokenParsed } from '@/application/session/token';
import { useCurrentUserOptional } from '@/components/main/app.hooks';

import {
  consentStatusBlocker,
  isAccountConsentReason,
  isCancellableConsentReason,
  isRetryableConsentReason,
  type ConsentErrorReason,
  type McpConsentRequest,
} from './consentModel';
import { McpConsentLoading } from './McpConsentLayout';
import {
  McpConsentCancelledView,
  McpConsentDoneView,
  McpConsentErrorView,
  McpConsentRequestSentView,
} from './McpConsentStateViews';
import { McpConsentView } from './McpConsentView';
import { useMcpConsent } from './useMcpConsent';

export interface McpConsentFlowProps {
  request: McpConsentRequest;
  /** Sends the browser to sign-in with this consent request as the destination. */
  onLoginRequired: () => void;
}

/** The consent flow for a signed-in user (the page handles framing, validation and sign-in). */
export function McpConsentFlow({ request, onLoginRequired }: McpConsentFlowProps) {
  const { t } = useTranslation();
  const currentUser = useCurrentUserOptional();
  const consent = useMcpConsent(request, onLoginRequired);
  const email = currentUser?.email || getTokenParsed()?.user.email || undefined;
  const currentUserId = currentUser?.uid;

  const switchAccount = useCallback(() => {
    // The app's explicit sign-out (it clears this user's device-local state), then sign-in again.
    signOutCurrentUser(currentUserId);
    onLoginRequired();
  }, [currentUserId, onLoginRequired]);

  const { load, failure, outcome } = consent;
  const clientName = getMcpClientDisplayName(load.kind === 'loading' ? undefined : load.client);
  const name = clientName ?? t('settings.mcp.unknownApp');

  // The request parsed, so most error views can still send the app the
  // server-validated `access_denied` instead of leaving it waiting.
  const errorView = (reason: ConsentErrorReason, onRetry?: () => void, { offerCancel = true } = {}) => (
    <McpConsentErrorView
      reason={reason}
      onRetry={onRetry}
      account={isAccountConsentReason(reason) ? { email, onSwitch: switchAccount } : undefined}
      cancel={
        offerCancel && consent.canCancelFromError && isCancellableConsentReason(reason)
          ? {
              name: clientName,
              onCancel: consent.cancelFromError,
              busy: consent.busy === 'deny',
              error: consent.cancelError,
            }
          : undefined
      }
    />
  );

  if (outcome?.kind === 'done') return <McpConsentDoneView name={name} />;
  if (outcome?.kind === 'cancelled') return <McpConsentCancelledView name={name} />;
  if (outcome?.kind === 'request-sent') return <McpConsentRequestSentView name={name} />;
  if (failure) {
    return errorView(failure.reason, failure.dismissible ? consent.dismissFailure : undefined, {
      offerCancel: !failure.fromDeny,
    });
  }

  if (load.kind === 'loading') return <McpConsentLoading />;
  if (load.kind === 'failed') {
    return errorView(load.reason, isRetryableConsentReason(load.reason) ? consent.reload : undefined);
  }

  const blocker = consent.status ? consentStatusBlocker(consent.status) : null;

  if (blocker) return errorView(blocker);

  return (
    <McpConsentView
      client={load.client}
      name={name}
      redirectUri={request.redirectUri}
      requestedScope={request.scope}
      workspaces={load.workspaces}
      workspaceId={consent.workspaceId}
      onSelectWorkspace={consent.selectWorkspace}
      status={consent.status}
      statusLoading={consent.statusLoading}
      statusError={consent.statusError}
      onRetryStatus={consent.reloadStatus}
      scopes={consent.scopes}
      onToggleScope={consent.toggleScope}
      busy={consent.busy}
      actionError={consent.actionError}
      email={email}
      onSwitchAccount={switchAccount}
      onAllow={consent.allow}
      onApproveAndAllow={consent.approveAndAllow}
      onRequestApproval={consent.requestApproval}
      onDeny={consent.deny}
    />
  );
}

export default McpConsentFlow;
