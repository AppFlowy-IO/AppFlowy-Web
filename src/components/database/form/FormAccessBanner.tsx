import { CircleAlert, LoaderCircle } from 'lucide-react';
import { useContext } from 'react';

import { FormShareTier } from '@/application/services/js-services/http';
import { AuthInternalContext } from '@/components/app/contexts/AuthInternalContext';
import { Button } from '@/components/ui/button';
import { ReactComponent as LockIcon } from '@/assets/icons/lock.svg';
import { cn } from '@/lib/utils';

import { useFormShareContext } from './FormShareContext';
import { FormSharePopover } from './FormSharePopover';

/**
 * At-rest banner that surfaces the current share tier (Image #9 /
 * Image #33). Public tier elevates to the warning palette since
 * "anyone with the link can submit" carries operational risk; other
 * tiers keep the neutral surface. The `Change` link opens the same
 * popover as the toolbar's `Share form` button — two anchors, one
 * menu definition.
 */
export function FormAccessBanner() {
  const share = useFormShareContext();
  // `AuthInternalContext` is provided by `AppAuthLayer`; outside of
  // that (e.g. the publish/embed surface) it's null. Read defensively
  // so the banner falls back to generic copy without crashing.
  const auth = useContext(AuthInternalContext);
  const workspaceName = auth?.userWorkspaceInfo?.selectedWorkspace?.name ?? 'this workspace';

  const tier = share.info?.tier;
  const anonymous = share.info?.anonymous ?? false;
  const submissionAccess = share.info?.submission_access ?? 'none';
  const url = share.resolveShareUrl();
  const isPublic = tier === 'public';
  const hasUnavailableLink = !share.isLoading && (share.info === null || !url);

  return (
    <div
      data-testid='form-access-banner'
      data-tier={tier ?? 'unavailable'}
      data-anonymous={anonymous ? 'true' : 'false'}
      data-submission-access={submissionAccess}
      className={cn(
        'flex items-center gap-3 rounded-xl py-3 pl-4 pr-3 text-sm',
        isPublic
          ? 'border border-border-warning-thick bg-fill-warning-light text-text-warning-on-fill'
          : 'bg-fill-content-visible text-text-primary'
      )}
    >
      <BannerIcon isPublic={isPublic} isLoading={share.isLoading} unavailable={hasUnavailableLink} />
      <span className='flex-1' aria-live='polite'>
        {bannerCopy(tier, workspaceName, share.isLoading, hasUnavailableLink)}
      </span>
      <FormSharePopover
        trigger={
          <Button type='button' variant='outline' size='sm' className='h-7'>
            Change
          </Button>
        }
        info={share.info}
        isLoading={share.isLoading}
        isSaving={share.isSaving}
        errorMessage={share.error}
        onRetry={share.retryBootstrap}
        onRetryMutation={share.retryMutation}
        canUpdateSettings={share.canUpdateSettings}
        setTier={share.setTier}
        setAnonymous={share.setAnonymous}
        url={url}
      />
    </div>
  );
}

function BannerIcon({
  isPublic,
  isLoading,
  unavailable,
}: {
  isPublic: boolean;
  isLoading: boolean;
  unavailable: boolean;
}) {
  const className = isPublic ? 'text-text-warning-on-fill' : 'text-text-tertiary';
  const props = { size: 20, className: `${className} shrink-0` };

  if (isLoading) return <LoaderCircle {...props} className={`${className} animate-spin`} />;
  if (unavailable) return <CircleAlert {...props} />;

  return <LockIcon className='h-5 w-5 shrink-0 text-icon-primary' />;
}

function bannerCopy(
  tier: FormShareTier | undefined,
  workspaceName: string,
  isLoading: boolean,
  unavailable: boolean
): string {
  if (isLoading) return 'Loading form link…';
  if (unavailable) return 'Form link unavailable.';

  switch (tier) {
    case 'public':
      return 'This form is public. Anyone with the link can submit a response.';
    case 'closed':
      return 'This form is no longer accepting responses.';
    case 'workspace':
    default:
      return `Only members at ${workspaceName} can fill out this form.`;
  }
}
