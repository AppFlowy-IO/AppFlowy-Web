import { Ban, Globe, Lock } from 'lucide-react';
import { useContext } from 'react';

import { FormShareTier } from '@/application/services/js-services/http';
import { AuthInternalContext } from '@/components/app/contexts/AuthInternalContext';

import { FormSharePopover } from './FormSharePopover';
import { useFormShareContext } from './FormShareContext';

/**
 * At-rest banner that surfaces the current share tier (Image #9). The
 * `Change` link opens the same popover as the toolbar's `Share form`
 * button — two anchors, one menu definition.
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

  return (
    <div className='flex items-center gap-3 rounded-md border border-line-divider px-4 py-3 text-sm'>
      <BannerIcon tier={tier} />
      <span className='flex-1 text-text-primary'>
        {bannerCopy(tier, workspaceName)}
      </span>
      <FormSharePopover
        trigger={
          <button
            type='button'
            className='text-sm font-medium text-fill-default hover:underline'
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

function BannerIcon({ tier }: { tier: FormShareTier }) {
  const props = { size: 16, className: 'text-text-tertiary' };

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
      return 'Anyone with the link can fill out this form.';
    case 'closed':
      return 'This form is no longer accepting responses.';
    case 'workspace':
    default:
      return `Only members at ${workspaceName} can fill out this form.`;
  }
}
