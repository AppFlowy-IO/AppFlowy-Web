import { HTMLAttributes, useCallback, useEffect, useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { ERROR_CODE } from '@/application/constants';
import { Invitation } from '@/application/types';
import { ReactComponent as SuccessLogo } from '@/assets/icons/success_logo.svg';
import { ErrorPage } from '@/components/_shared/landing-page/ErrorPage';
import { InvalidLink } from '@/components/_shared/landing-page/InvalidLink';
import LandingPage from '@/components/_shared/landing-page/LandingPage';
import { NotInvitationAccount } from '@/components/_shared/landing-page/NotInvitationAccount';
import { useCurrentUser, useService } from '@/components/main/app.hooks';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

function AcceptInvitationPage() {
  const currentUser = useCurrentUser();
  const [searchParams] = useSearchParams();
  const invitationId = searchParams.get('invited_id');
  const service = useService();
  const [invitation, setInvitation] = useState<Invitation>();
  const { t } = useTranslation();
  const [hasJoined, setHasJoined] = useState(false);
  const [isInValid, setIsInValid] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notInvitee, setNotInvitee] = useState(false);
  const [isError, setIsError] = useState(false);
  const [invalidMessage, setInvalidMessage] = useState<string>();

  const loadInvitation = useCallback(async () => {
    if (!service) return;
    if (!invitationId) {
      setIsError(true);
      return;
    }

    try {
      const res = await service.getInvitation(invitationId);

      if (res.status === 'Accepted') {
        setHasJoined(true);
      }

      setInvitation(res);
      // eslint-disable-next-line
    } catch (e: any) {
      if (e.code === ERROR_CODE.NOT_INVITEE_OF_INVITATION) {
        setNotInvitee(true);
        return;
      }

      if (e.code === ERROR_CODE.INVALID_LINK) {
        setInvalidMessage(e.message);
        setIsInValid(true);
        return;
      }

      setIsError(true);
    }
  }, [invitationId, service]);

  useEffect(() => {
    void loadInvitation();
  }, [loadInvitation]);

  const workspace = useMemo(() => {
    if (!invitation) return;
    return {
      id: invitation.workspace_id,
      name: invitation.workspace_name,
      icon: invitation.workspace_icon,
      memberCount: invitation.member_count,
      databaseStorageId: '',
      createdAt: '',
    };
  }, [invitation]);

  const whoSentInvitation = useMemo(() => {
    if (!invitation) return '';

    return invitation.inviter_name;
  }, [invitation]);

  const handleJoinWorkspace = useCallback(async () => {
    if (!invitationId) return;
    if (invitation?.status === 'Accepted') {
      toast.warning(t('invitation.alreadyAccepted'));
      setHasJoined(true);
      return;
    }

    try {
      setLoading(true);
      await service?.acceptInvitation(invitationId);
      toast.success(t('invitation.successMessage'));
      window.open(`/app/${invitation?.workspace_id}`, '_self');
      setHasJoined(true);
      // eslint-disable-next-line
    } catch (e: any) {
      if (e.code === ERROR_CODE.INVALID_LINK) {
        setInvalidMessage(e.message);
        setIsInValid(true);
        return;
      }

      if (e.code === ERROR_CODE.NOT_INVITEE_OF_INVITATION) {
        setNotInvitee(true);
        return;
      }

      setIsError(true);
    } finally {
      setLoading(false);
    }
  }, [invitationId, invitation, service, t]);

  const AvatarLogo = useCallback(
    (props: HTMLAttributes<HTMLDivElement>) => {
      return (
        <Avatar className={cn(props.className)} variant='default' shape={'square'}>
          <AvatarImage src={workspace?.icon || ''} alt={''} />
          <AvatarFallback className='text-2xl'>{workspace?.name}</AvatarFallback>
        </Avatar>
      );
    },
    [workspace]
  );

  if (isInValid) {
    return <InvalidLink message={invalidMessage} />;
  }

  if (notInvitee) {
    return <NotInvitationAccount />;
  }

  if (isError) {
    return <ErrorPage onRetry={handleJoinWorkspace} />;
  }

  if (hasJoined) {
    return (
      <LandingPage
        Logo={SuccessLogo}
        workspace={workspace}
        title={
          <Trans
            i18nKey='landingPage.inviteMember.hasJoined'
            components={{ workspace: <span className='font-bold'>{workspace?.name}</span> }}
          />
        }
        secondaryAction={{
          onClick: () => window.open('/app', '_self'),
          label: t('landingPage.backToHome'),
        }}
      />
    );
  }

  return (
    <LandingPage
      Logo={AvatarLogo}
      title={
        <Trans
          i18nKey='landingPage.inviteMember.title'
          components={{ workspace: <span className='font-bold'>{workspace?.name}</span> }}
        />
      }
      description={
        <Trans
          i18nKey='landingPage.inviteMember.description'
          components={{
            who: <span className='font-bold'>{whoSentInvitation}</span>,
            email: <span className='font-bold'>{currentUser?.email}</span>,
          }}
        />
      }
      primaryAction={{
        onClick: handleJoinWorkspace,
        label: loading ? (
          <span className='flex items-center gap-2'>
            <Progress />
            {t('landingPage.inviteMember.joinWorkspace')}
          </span>
        ) : (
          t('landingPage.inviteMember.joinWorkspace')
        ),
        loading,
      }}
    />
  );
}

export default AcceptInvitationPage;
