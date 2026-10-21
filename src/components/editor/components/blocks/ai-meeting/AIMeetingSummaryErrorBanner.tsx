import { useEffect, useRef, useState } from 'react';

import { ERROR_CODE } from '@/application/constants';
import { getSubscriptionLink } from '@/application/services/domains/billing';
import { SubscriptionInterval, SubscriptionPlan } from '@/application/types';
import { notify } from '@/components/_shared/notify';
import { useIsOfficialHosted } from '@/components/app/hooks/useServerInfo';
import { getErrorMessage } from '@/utils/errors';

import { AIMeetingErrorBanner } from './AIMeetingImport';

export function AIMeetingSummaryErrorBanner({
  message,
  errorCode,
  workspaceId,
  readOnly,
  onRetry,
  onDismiss,
  dismissLabel,
}: {
  message: string;
  errorCode?: number;
  workspaceId?: string;
  readOnly: boolean;
  onRetry: () => void;
  onDismiss: () => void;
  dismissLabel: string;
}) {
  const isHosted = useIsOfficialHosted();
  const [checkoutPending, setCheckoutPending] = useState(false);
  const checkoutRequest = useRef<object>();
  const quotaExceeded = errorCode === ERROR_CODE.AI_RESPONSE_LIMIT_EXCEEDED;
  const canUpgrade = quotaExceeded && isHosted && Boolean(workspaceId) && !readOnly;

  useEffect(() => {
    checkoutRequest.current = undefined;
    setCheckoutPending(false);
    return () => {
      checkoutRequest.current = undefined;
    };
  }, [workspaceId, canUpgrade]);

  const openProCheckout = async () => {
    if (!canUpgrade || !workspaceId || checkoutRequest.current) return;
    const request = {};

    checkoutRequest.current = request;
    setCheckoutPending(true);
    try {
      // Use the same initial monthly Pro price as the app's upgrade dialog.
      // Stripe offers the annual option; the server supplies the checkout URL.
      const link = await getSubscriptionLink(workspaceId, SubscriptionPlan.Pro, SubscriptionInterval.Month);

      if (checkoutRequest.current !== request) return;
      if (link) window.open(link, '_current');
    } catch (error) {
      if (checkoutRequest.current === request) notify.error(getErrorMessage(error));
    } finally {
      if (checkoutRequest.current === request) {
        checkoutRequest.current = undefined;
        setCheckoutPending(false);
      }
    }
  };

  return (
    <AIMeetingErrorBanner
      message={message}
      onRetry={!quotaExceeded && !readOnly ? onRetry : undefined}
      onUpgrade={canUpgrade ? () => { void openProCheckout(); } : undefined}
      upgradePending={checkoutPending}
      onDismiss={onDismiss}
      dismissLabel={dismissLabel}
    />
  );
}
