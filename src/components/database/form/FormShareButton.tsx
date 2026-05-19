import { Share2 } from 'lucide-react';
import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

import { BillingService } from '@/application/services/domains';
import { Subscription } from '@/application/types';
import { useUserWorkspaceInfo } from '@/components/app/app.hooks';
import { useSubscriptionPlan } from '@/components/app/hooks/useSubscriptionPlan';
import { Button } from '@/components/ui/button';

import { FormSharePopover } from './FormSharePopover';
import { useFormShareContext } from './FormShareContext';

/**
 * Toolbar entry point for the share popover. Sits next to the
 * Preview button at the top-right of the form-builder view.
 *
 * Free-plan workspaces tapping this button get the `?action=change_plan`
 * upgrade modal instead of an empty popover. The cloud's
 * `plan_check::is_workspace_on_paid_plan` gate refuses the share-token
 * mint for Free plans, which would otherwise leave `useFormShare`'s
 * bootstrap with `info === null` forever — the popover would render
 * its `ShareLoading` skeleton indefinitely. Mirrors the gate the
 * `AddViewButton` picker already applies for Form creation.
 */
export function FormShareButton() {
  const share = useFormShareContext();
  const url = share.resolveShareUrl();

  // Same subscription-plan helper the chart settings and the
  // AddViewButton picker use. Self-hosted instances return
  // `isPro = true` without a billing round-trip, so the share button
  // stays usable for both cloud-Pro and on-prem deployments.
  const userWorkspaceInfo = useUserWorkspaceInfo();
  const currentWorkspaceId = userWorkspaceInfo?.selectedWorkspace.id;
  const getSubscriptions = useCallback(async (): Promise<
    Subscription[] | undefined
  > => {
    if (!currentWorkspaceId) return undefined;
    return BillingService.getWorkspaceSubscriptions(currentWorkspaceId);
  }, [currentWorkspaceId]);
  const { isPro } = useSubscriptionPlan(getSubscriptions);

  const [, setSearch] = useSearchParams();
  const openUpgradePlan = useCallback(() => {
    setSearch((prev) => {
      prev.set('action', 'change_plan');
      return prev;
    });
  }, [setSearch]);

  if (!isPro) {
    return (
      <Button size='sm' className='gap-1' onClick={openUpgradePlan}>
        <Share2 size={14} />
        Share form
      </Button>
    );
  }

  return (
    <FormSharePopover
      trigger={
        <Button size='sm' className='gap-1'>
          <Share2 size={14} />
          Share form
        </Button>
      }
      info={share.info}
      setTier={share.setTier}
      setAnonymous={share.setAnonymous}
      setSubmissionAccess={share.setSubmissionAccess}
      url={url}
    />
  );
}
