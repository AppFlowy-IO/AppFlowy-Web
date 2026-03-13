import { HTMLAttributes, ReactNode, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { Workspace } from '@/application/types';
import { ReactComponent as AppFlowyLogo } from '@/assets/icons/appflowy.svg';
import LandingFooter from '@/components/_shared/landing-page/LandingFooter';
import { useCurrentUserOptional, useIsAuthenticatedOptional } from '@/components/main/app.hooks';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { openAppFlowySchema } from '@/utils/url';

export default function LandingPage({
  Logo,
  title,
  workspace,
  description,
  primaryAction,
  secondaryAction,
}: {
  Logo?: React.FC<HTMLAttributes<SVGElement | HTMLElement>>;
  title?: ReactNode;
  workspace?: Workspace;
  description?: ReactNode;
  primaryAction?: {
    onClick: () => void;
    label: ReactNode;
  } & React.ComponentProps<typeof Button>;
  secondaryAction?: {
    onClick: () => void;
    label: ReactNode;
  } & React.ComponentProps<typeof Button>;
}) {
  const { t } = useTranslation();
  const isAuthenticated = useIsAuthenticatedOptional();
  const url = useMemo(() => {
    return window.location.href;
  }, []);
  const currentUser = useCurrentUserOptional();

  useEffect(() => {
    if (!isAuthenticated) {
      window.open('/login?redirectTo=' + encodeURIComponent(url), '_self');
    }
  }, [isAuthenticated, url]);

  const openWorkspace = useCallback(() => {
    if (workspace) {
      window.open(`/app/${workspace.id}`, '_blank');
      window.open(
        `appflowy-flutter://invitation-callback?workspace_id=${workspace.id}&email=${currentUser?.email}`,
        '_self'
      );
    } else {
      window.open('/app', '_blank');
      window.open(openAppFlowySchema, '_self');
    }
  }, [currentUser?.email, workspace]);

  return (
    <div className='flex h-screen w-screen flex-col bg-background-primary'>
      <div className='absolute left-0 top-0 flex h-[60px] w-full items-center justify-between gap-[10px] p-4'>
        <span
          onClick={() => {
            window.open('/app', '_self');
          }}
          className='h-full w-[141px] cursor-pointer'
        >
          <AppFlowyLogo className='h-full w-full' />
        </span>
      </div>
      <div className='flex w-full flex-1  items-center justify-center'>
        <div className='flex w-[400px] flex-col items-center justify-center gap-10'>
          <div className='flex w-full flex-col items-center justify-center gap-6'>
            {Logo && <Logo className='h-16 w-16' />}
            <div className='w-full whitespace-pre-wrap break-words text-center text-xl font-bold text-text-primary'>
              {title}
            </div>
            {workspace && (
              <div
                onClick={openWorkspace}
                className='flex w-[320px] cursor-pointer items-center justify-center gap-2 text-sm text-text-primary'
              >
                <Avatar shape={'square'} className='min-w-[32px]'>
                  <AvatarImage src={workspace?.icon} alt={''} />
                  <AvatarFallback>{workspace?.name}</AvatarFallback>
                </Avatar>
                <div className='flex flex-col overflow-hidden'>
                  <div className='w-full truncate'>{workspace.name}</div>
                  {workspace.memberCount > 0 && (
                    <div className='text-xs text-text-secondary'>
                      {t('membersCount', { count: workspace.memberCount })}
                    </div>
                  )}
                </div>
              </div>
            )}
            {description && (
              <div className='w-[320px] whitespace-pre-wrap break-words text-center text-sm text-text-primary'>
                {description}
              </div>
            )}

            {(primaryAction || secondaryAction) && (
              <div className='flex w-[320px] flex-col gap-[10px]'>
                {primaryAction && (
                  <Button {...primaryAction} size='lg' className='w-full min-w-full' variant={'default'}>
                    {primaryAction.label}
                  </Button>
                )}
                {secondaryAction && (
                  <Button {...secondaryAction} size='lg' className='w-full min-w-full' variant={'outline'}>
                    {secondaryAction.label}
                  </Button>
                )}
              </div>
            )}
          </div>
          <LandingFooter />
        </div>
      </div>
    </div>
  );
}
