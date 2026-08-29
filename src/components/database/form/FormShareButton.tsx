import { Share2 } from 'lucide-react';
import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';

import { FormSharePopover } from './FormSharePopover';
import { useCanAuthorFormView } from './useCanAuthorFormView';
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
 *
 * Dev / test / self-hosted bypass lives in `useCanAuthorFormView` so
 * all three web entry points (this button, the access banner's
 * `Change` link, and the `+` picker) stay consistent.
 */
export function FormShareButton() {
  const share = useFormShareContext();
  const url = share.resolveShareUrl();
  const {
    canAuthor,
    isLoading: isLoadingEntitlement,
    hasError: hasEntitlementError,
    ensureCanAuthor,
  } = useCanAuthorFormView();

  const [, setSearch] = useSearchParams();
  const canUpdateSettings = share.canUpdateSettings;
  const openUpgradePlan = useCallback(() => {
    setSearch((prev) => {
      prev.set('action', 'change_plan');
      return prev;
    });
  }, [setSearch]);

  const retryEntitlement = useCallback(async () => {
    const allowed = await ensureCanAuthor();

    if (allowed === false) openUpgradePlan();
  }, [ensureCanAuthor, openUpgradePlan]);
  const shouldShowEntitlementGate =
    canUpdateSettings &&
    share.info === null &&
    !share.isLoading &&
    (share.errorKind === 'plan_required' || (!share.errorKind && !share.error));

  // Existing shares stay inspectable after a plan downgrade so their owner can
  // close an active link. Loading and generic GET failures also keep the
  // popover reachable so an owner can retry the read needed to close it.
  // Only a confirmed missing/plan-gated link takes the entitlement-only path.
  if (shouldShowEntitlementGate && !canAuthor) {
    if (canAuthor === null) {
      return (
        <Button
          data-testid='form-share-button'
          size='sm'
          className='gap-1'
          disabled={!hasEntitlementError || isLoadingEntitlement}
          loading={isLoadingEntitlement}
          onClick={hasEntitlementError ? () => void retryEntitlement() : undefined}
        >
          <Share2 size={14} />
          {hasEntitlementError ? 'Retry plan check' : 'Share form'}
        </Button>
      );
    }

    return (
      <Button data-testid='form-share-button' size='sm' className='gap-1' onClick={openUpgradePlan}>
        <Share2 size={14} />
        Share form
      </Button>
    );
  }

  return (
    <FormSharePopover
      trigger={
        <Button data-testid='form-share-button' size='sm' className='gap-1'>
          <Share2 size={14} />
          Share form
        </Button>
      }
      info={share.info}
      isLoading={share.isLoading}
      errorKind={share.errorKind}
      errorMessage={share.error}
      onUpgradePlan={openUpgradePlan}
      hasEntitlementError={hasEntitlementError}
      onRetryEntitlement={() => void retryEntitlement()}
      onRetry={share.retryBootstrap}
      onRetryMutation={share.retryMutation}
      canUpdateSettings={canUpdateSettings}
      canBroadenAccess={canUpdateSettings && canAuthor === true}
      setTier={share.setTier}
      setAnonymous={share.setAnonymous}
      url={url}
    />
  );
}
