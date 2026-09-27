import i18next from 'i18next';

import { SubscriptionPlan, ViewLayout } from '@/application/types';
import { getServerHostingMode, ServerHostingMode } from '@/utils/server-info';

const PRO_WORKSPACE_REQUIRED = 'Upgrade this workspace to Pro to use this feature or increase its limits.';

/**
 * Client-side commercial plan policy. Server capabilities, permissions and
 * administrator-configured resource errors remain authoritative in every mode.
 * Reuse the immutable policies across React and non-React request handlers.
 */
export abstract class WorkspacePlanPolicy {
  abstract readonly usesHostedBilling: boolean;
  abstract readonly bypassesPlanLimits: boolean;
  abstract hasProAccess(plan: SubscriptionPlan | null): boolean;
  abstract requiresOnlineViewCreation(layout: ViewLayout): boolean;
  abstract getUpgradeMessage(serverMessage: unknown): string | undefined;
}

class HostedWorkspacePlanPolicy extends WorkspacePlanPolicy {
  readonly usesHostedBilling: boolean = true;
  readonly bypassesPlanLimits = false;

  hasProAccess(plan: SubscriptionPlan | null): boolean {
    return plan === SubscriptionPlan.Pro || plan === SubscriptionPlan.Team;
  }

  requiresOnlineViewCreation(layout: ViewLayout): boolean {
    return layout === ViewLayout.Form || layout === ViewLayout.Chart;
  }

  getUpgradeMessage(serverMessage: unknown): string | undefined {
    if (typeof serverMessage === 'string' && /\bPro\b/i.test(serverMessage)) return serverMessage;

    return i18next.t('billingLimits.workspaceProRequired', { defaultValue: PRO_WORKSPACE_REQUIRED }) || PRO_WORKSPACE_REQUIRED;
  }
}

class SelfHostedWorkspacePlanPolicy extends WorkspacePlanPolicy {
  readonly usesHostedBilling = false;
  readonly bypassesPlanLimits = true;

  hasProAccess(): boolean {
    return true;
  }

  requiresOnlineViewCreation(): boolean {
    return false;
  }

  getUpgradeMessage(): undefined {
    return undefined;
  }
}

/** Unknown capabilities must not grant the self-hosted bypass or advertise billing. */
class UnresolvedWorkspacePlanPolicy extends HostedWorkspacePlanPolicy {
  readonly usesHostedBilling = false;

  hasProAccess(): boolean {
    return false;
  }

  getUpgradeMessage(): undefined {
    return undefined;
  }
}

const policies: Record<ServerHostingMode, WorkspacePlanPolicy> = {
  cloud: new HostedWorkspacePlanPolicy(),
  'self-hosted': new SelfHostedWorkspacePlanPolicy(),
  unknown: new UnresolvedWorkspacePlanPolicy(),
};

export function getWorkspacePlanPolicy(mode = getServerHostingMode()): WorkspacePlanPolicy {
  return policies[mode];
}
