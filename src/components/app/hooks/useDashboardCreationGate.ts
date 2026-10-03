import { useTranslation } from 'react-i18next';

import { EXPERIMENTAL_DATABASE_VIEW_CREATION_ENABLED } from '@/application/constants';
import { Subscription } from '@/application/types';
import { useMobileContext } from '@/components/_shared/hooks/useMobileContext';

import { useTimelineCreationDisabledReason } from './useTimelineCreationDisabledReason';

export interface DashboardCreationGate {
  /**
   * Whether a Dashboard view can be created here at all: the feature is on and
   * the page is not a mobile context (dashboards are view-only there, so none
   * is created). When `false` the entry point hides its Dashboard option.
   */
  available: boolean;
  /**
   * Why creation is refused although it is available (the workspace plan, or
   * the plan check still running). The entry point shows it on the disabled
   * option.
   */
  disabledReason: string | undefined;
}

/**
 * The rule for creating a Dashboard view, in one place for every entry point:
 * the tab bar's "+" menu, the layout switcher and the slash menu. The server
 * applies the Timeline Pro policy to Dashboard views, so the plan check is the
 * shared one with the Dashboard message. `enabled` defers the plan request
 * until the menu is open.
 */
export function useDashboardCreationGate(
  getSubscriptions: (() => Promise<Subscription[] | undefined>) | undefined,
  { workspaceId, enabled = true }: { workspaceId?: string; enabled?: boolean }
): DashboardCreationGate {
  const { t } = useTranslation();
  const mobileContext = useMobileContext();
  const available = EXPERIMENTAL_DATABASE_VIEW_CREATION_ENABLED && !mobileContext;
  const disabledReason = useTimelineCreationDisabledReason(getSubscriptions, {
    workspaceId,
    enabled: available && enabled,
    requiresProMessage: t('dashboard.creationRequiresPro', {
      defaultValue: 'Creating a Dashboard view requires a Pro workspace.',
    }),
  });

  return { available, disabledReason };
}
