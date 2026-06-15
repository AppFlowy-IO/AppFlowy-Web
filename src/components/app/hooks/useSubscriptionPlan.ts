import { useCallback, useEffect, useState } from 'react';

import { Subscription, SubscriptionPlan } from '@/application/types';
import { getProAccessPlanFromSubscriptions, isAppFlowyHosted } from '@/utils/subscription';

/**
 * Hook to manage subscription plan loading and Pro feature detection
 * Only loads subscription for official hosts (self-hosted instances have Pro features enabled by default)
 *
 * @param getSubscriptions - Function to fetch subscriptions (can be undefined)
 * @returns Object containing activeSubscriptionPlan and isPro flag
 */
export function useSubscriptionPlan(
    getSubscriptions?: () => Promise<Subscription[] | undefined>
): {
    activeSubscriptionPlan: SubscriptionPlan | null;
    isPro: boolean;
} {
    const [activeSubscriptionPlan, setActiveSubscriptionPlan] = useState<SubscriptionPlan | null>(null);
    // Pro features are enabled by default on self-hosted instances
    const isPro = activeSubscriptionPlan === SubscriptionPlan.Pro || !isAppFlowyHosted();

    const loadSubscription = useCallback(async () => {
        try {
            if (!getSubscriptions) {
                setActiveSubscriptionPlan(SubscriptionPlan.Free);
                return;
            }

            const subscriptions = await getSubscriptions();

            if (!subscriptions || subscriptions.length === 0) {
                setActiveSubscriptionPlan(SubscriptionPlan.Free);
                return;
            }

            setActiveSubscriptionPlan(getProAccessPlanFromSubscriptions(subscriptions));
        } catch (e: unknown) {
            // Silently handle expected errors (API not initialized, no response data, etc.)
            // These are normal scenarios when the service isn't available or there's no subscription data
            const error = e as { code?: number; message?: string };
            const isExpectedError =
                error?.code === -1 &&
                (error?.message === 'No response data received' ||
                    error?.message === 'No response received from server' ||
                    error?.message === 'API service not initialized');

            if (!isExpectedError) {
                console.error(e);
            }

            setActiveSubscriptionPlan(SubscriptionPlan.Free);
        }
    }, [getSubscriptions]);

    useEffect(() => {
        // Only load subscription for official host (self-hosted instances have Pro features enabled by default)
        if (isAppFlowyHosted()) {
            void loadSubscription();
        }
    }, [loadSubscription]);

    return {
        activeSubscriptionPlan,
        isPro,
    };
}
