import { Ban, Globe, Lock } from 'lucide-react';
import { useContext } from 'react';

import { FormShareTier } from '@/application/services/js-services/http';
import { AuthInternalContext } from '@/components/app/contexts/AuthInternalContext';
import { cn } from '@/lib/utils';

import { FormSharePopover } from './FormSharePopover';
import { useFormShareContext } from './FormShareContext';

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
  const workspaceName =
    auth?.userWorkspaceInfo?.selectedWorkspace?.name ?? 'this workspace';

  const tier = share.info?.tier ?? 'workspace';
  const url = share.resolveShareUrl();
  const isPublic = tier === 'public';

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-md border px-4 py-3 text-sm',
        isPublic
          ? 'border-border-warning-thick bg-fill-warning-light text-text-warning-on-fill'
          : 'border-line-divider text-text-primary',
      )}
    >
      <BannerIcon tier={tier} isPublic={isPublic} />
      <span className='flex-1'>{bannerCopy(tier, workspaceName)}</span>
      <FormSharePopover
        trigger={
          <button
            type='button'
            className={cn(
              'text-sm font-medium hover:underline',
              isPublic ? 'text-text-warning-on-fill' : 'text-fill-default',
            )}
          >
            Change
          </button>
        }
        info={share.info}
        setTier={share.setTier}
        setAnonymous={share.setAnonymous}
        setSubmissionAccess={share.setSubmissionAccess}
        url={url}
      />
    </div>
  );
}

function BannerIcon({
  tier,
  isPublic,
}: {
  tier: FormShareTier;
  isPublic: boolean;
}) {
  const className = isPublic ? 'text-text-warning-on-fill' : 'text-text-tertiary';
  const props = { size: 16, className };

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

function bannerCopy(tier: FormShareTier, workspaceName: string): string {
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
