import { HTMLAttributes, useCallback, useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import { ERROR_CODE } from '@/application/constants';
import { Workspace } from '@/application/types';
import { ReactComponent as SuccessLogo } from '@/assets/icons/success_logo.svg';
import { ErrorPage } from '@/components/_shared/landing-page/ErrorPage';
import { InvalidLink } from '@/components/_shared/landing-page/InvalidLink';
import LandingPage from '@/components/_shared/landing-page/LandingPage';
import { NotInvitationAccount } from '@/components/_shared/landing-page/NotInvitationAccount';
import { useService } from '@/components/main/app.hooks';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

export function ApproveConversion() {
  const { t } = useTranslation();
  const service = useService();
  const [searchParams] = useSearchParams();
  const code = searchParams.get('code');
  const workspaceId = searchParams.get('workspace_id');
  const [loading, setLoading] = useState(false);
  const [workspace, setWorkspace] = useState<Workspace>();
  const [requester, setRequester] = useState<{
    avatarUrl: string;
    name: string;
  }>();
  const [guestName, setGuestName] = useState<string>();

  const [isInvalid, setIsInvalid] = useState(false);
  const [invalidMessage, setInvalidMessage] = useState<string>();

  const [notInvitee, setNotInvitee] = useState(false);

  const [isError, setIsError] = useState(false);

  const [isAlreadyMember, setIsAlreadyMember] = useState(false);

  const loadConversion = useCallback(async () => {
    if (!service) return;
    setLoading(true);
    if (!workspaceId || !code) {
      setIsError(true);
      return;
    }

    try {
      const info = await service.getGuestToMemberConversionInfo(workspaceId, code);

      setWorkspace({
        id: workspaceId,
        name: info.workspace_name,
        icon: info.workspace_icon_url || '',
        memberCount: info.member_count,
        databaseStorageId: '',
        createdAt: '',
      });

      setRequester({
        avatarUrl: info.requester_avatar || '',
        name: info.requester_name,
      });

      setGuestName(info.guest_name);

      setIsAlreadyMember(info.guest_is_already_a_member);
      // eslint-disable-next-line
    } catch (e: any) {
      if (e.code === ERROR_CODE.INVALID_LINK) {
        setInvalidMessage(e.message);
        setIsInvalid(true);
      } else if (e.code === ERROR_CODE.ALREADY_JOINED) {
        setIsAlreadyMember(true);
      } else if (e.code === ERROR_CODE.NOT_INVITEE_OF_INVITATION) {
        setNotInvitee(true);
      } else {
        setIsError(true);
      }
    } finally {
      setLoading(false);
    }
  }, [service, workspaceId, code]);

  const AvatarLogo = useCallback(
    (props: HTMLAttributes<HTMLDivElement>) => {
      return (
        <Avatar className={cn(props.className)} variant='default' shape={'circle'}>
          <AvatarImage src={requester?.avatarUrl || ''} alt={''} />
          <AvatarFallback className='text-2xl'>{requester?.name}</AvatarFallback>
        </Avatar>
      );
    },
    [requester]
  );

  const handleApprove = useCallback(async () => {
    if (!service) return;
    setLoading(true);
    if (!workspaceId || !code) {
      setIsError(true);
      return;
    }

    try {
      await service.approveTurnGuestToMember(workspaceId, code);
      setIsAlreadyMember(true);
      // eslint-disable-next-line
    } catch (e: any) {
      if (e.code === ERROR_CODE.NOT_INVITEE_OF_INVITATION) {
        setNotInvitee(true);
        return;
      }

      setIsError(true);
    } finally {
      setLoading(false);
    }
  }, [service, workspaceId, code]);

  useEffect(() => {
    void loadConversion();
  }, [loadConversion]);

  if (isAlreadyMember) {
    return (
      <LandingPage
        Logo={SuccessLogo}
        workspace={workspace}
        title={
          <div className='font-normal'>
            <Trans
              i18nKey={'landingPage.approve.alreadyApproved'}
              components={{
                user: <span className='font-bold text-text-primary'>{requester?.name}</span>,
                workspace: <span className='font-bold text-text-primary'>{workspace?.name}</span>,
              }}
            />
          </div>
        }
        secondaryAction={{
          onClick: () => window.open('/app', '_self'),
          label: t('landingPage.backToHome'),
        }}
      />
    );
  }

  if (isInvalid) {
    return <InvalidLink message={invalidMessage} />;
  }

  if (notInvitee) {
    return <NotInvitationAccount />;
  }

  if (isError) {
    return <ErrorPage onRetry={handleApprove} />;
  }

  return (
    <LandingPage
      Logo={AvatarLogo}
      workspace={workspace}
      title={
        <Trans
          i18nKey='landingPage.approveConversion.title'
          components={{
            requester: <span className='font-bold'>{requester?.name}</span>,
            guest: <span className='font-bold'>{guestName}</span>,
          }}
        />
      }
      primaryAction={{
        onClick: handleApprove,
        label: loading ? (
          <span className='flex items-center gap-2'>
            <Progress />
            {t('landingPage.approveConversion.approve')}
          </span>
        ) : (
          t('landingPage.approveConversion.approve')
        ),
        loading,
      }}
      secondaryAction={{
        onClick: () => window.open('/app', '_self'),
        label: t('landingPage.backToHome'),
      }}
    />
  );
}
