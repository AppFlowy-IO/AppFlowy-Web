import { HTMLAttributes, useCallback, useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';

import { ERROR_CODE } from '@/application/constants';
import { Workspace } from '@/application/types';
import { ReactComponent as SuccessLogo } from '@/assets/icons/success_logo.svg';
import { ErrorPage } from '@/components/_shared/landing-page/ErrorPage';
import { InvalidLink } from '@/components/_shared/landing-page/InvalidLink';
import LandingPage from '@/components/_shared/landing-page/LandingPage';
import { useService } from '@/components/main/app.hooks';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

function InviteCode() {
  const { t } = useTranslation();
  const service = useService();
  const params = useParams();
  const [loading, setLoading] = useState(false);
  const [hasJoined, setHasJoined] = useState(false);

  const [isInValid, setIsInValid] = useState(false);
  const [invalidMessage, setInvalidMessage] = useState<string>();
  const [workspace, setWorkspace] = useState<Workspace>();
  const [isError, setIsError] = useState(false);

  const loadWorkspaceInfo = useCallback(async () => {
    if (!service) return;
    if (!params.code) {
      setIsError(true);
      return;
    }

    try {
      const info = await service.getWorkspaceInfoByInvitationCode(params.code);

      setWorkspace({
        name: info.workspace_name,
        icon: info.workspace_icon_url,
        id: info.workspace_id,
        memberCount: info.member_count,
        databaseStorageId: '',
        createdAt: '',
      });

      if (info.is_member) {
        setHasJoined(true);
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      if (e.code === ERROR_CODE.INVALID_LINK) {
        setInvalidMessage(e.message);
        setIsInValid(true);
      } else {
        setIsError(true);
      }
    } finally {
      setLoading(false);
    }
  }, [params.code, service]);

  useEffect(() => {
    void loadWorkspaceInfo();
  }, [loadWorkspaceInfo]);

  const handleJoin = async () => {
    if (!service) return;
    if (!params.code) {
      setIsError(true);
      return;
    }

    setLoading(true);
    try {
      await service.joinWorkspaceByInvitationCode(params.code);

      window.open(`/app/${workspace?.id}`, '_self');
      setHasJoined(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      if (e.code === ERROR_CODE.INVALID_LINK) {
        setInvalidMessage(e.message);
        setIsInValid(true);
      } else {
        setIsError(true);
      }
    } finally {
      setLoading(false);
    }
  };

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

  if (isError) {
    return <ErrorPage onRetry={handleJoin} />;
  }

  if (hasJoined) {
    return (
      <LandingPage
        Logo={SuccessLogo}
        workspace={workspace}
        title={
          <Trans
            i18nKey='landingPage.inviteCode.hasJoined'
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
          i18nKey='landingPage.inviteCode.title'
          components={{ workspace: <span className='font-bold'>{workspace?.name}</span> }}
        />
      }
      primaryAction={{
        onClick: handleJoin,
        loading,
        label: loading ? (
          <span className='flex items-center gap-2'>
            <Progress />
            {t('landingPage.inviteCode.joinWorkspace')}
          </span>
        ) : (
          t('landingPage.inviteCode.joinWorkspace')
        ),
      }}
    />
  );
}

export default InviteCode;
