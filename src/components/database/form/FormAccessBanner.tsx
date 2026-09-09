import { Ban, CircleAlert, Globe, LoaderCircle, Lock } from 'lucide-react';
import { useContext } from 'react';

import { FormShareTier } from '@/application/services/js-services/http';
import { AuthInternalContext } from '@/components/app/contexts/AuthInternalContext';
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

  const changeLinkClasses = cn(
    'text-sm font-medium hover:underline',
    isPublic ? 'text-text-warning-on-fill' : 'text-fill-default'
  );

  return (
    <div
      data-testid='form-access-banner'
      data-tier={tier ?? 'unavailable'}
      data-anonymous={anonymous ? 'true' : 'false'}
      data-submission-access={submissionAccess}
      className={cn(
        'flex items-center gap-3 rounded-md border px-4 py-3 text-sm',
        isPublic
          ? 'border-border-warning-thick bg-fill-warning-light text-text-warning-on-fill'
          : 'border-line-divider text-text-primary'
      )}
    >
      <BannerIcon tier={tier} isPublic={isPublic} isLoading={share.isLoading} unavailable={hasUnavailableLink} />
      <span className='flex-1' aria-live='polite'>
        {bannerCopy(tier, workspaceName, share.isLoading, hasUnavailableLink)}
      </span>
      <FormSharePopover
        trigger={
          <button type='button' className={changeLinkClasses}>
            Change
          </button>
        }
        info={share.info}
        isLoading={share.isLoading}
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
  tier,
  isPublic,
  isLoading,
  unavailable,
}: {
  tier: FormShareTier | undefined;
  isPublic: boolean;
  isLoading: boolean;
  unavailable: boolean;
}) {
  const className = isPublic ? 'text-text-warning-on-fill' : 'text-text-tertiary';
  const props = { size: 16, className };

  if (isLoading) return <LoaderCircle {...props} className={`${className} animate-spin`} />;
  if (unavailable) return <CircleAlert {...props} />;

  switch (tier) {
    case 'public':
      return <Globe {...props} />;
    case 'closed':
      return <Ban {...props} />;
    case 'workspace':
    default:
      return <Lock {...props} />;
  }
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
