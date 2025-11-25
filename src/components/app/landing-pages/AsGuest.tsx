import { useCallback, useEffect, useState } from 'react';
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
import { Progress } from '@/components/ui/progress';

export function AsGuest() {
  const { t } = useTranslation();
  const service = useService();
  const [searchParams] = useSearchParams();
  const code = searchParams.get('code');
  const workspaceId = searchParams.get('workspace_id');
  const [loading, setLoading] = useState(false);

  const [workspace, setWorkspace] = useState<Workspace>();
  const [page, setPage] = useState<{ view_id: string; name: string } | null>(null);

  const [isInvalid, setIsInvalid] = useState(false);
  const [invalidMessage, setInvalidMessage] = useState<string>();

  const [notInvitee, setNotInvitee] = useState(false);

  const [isError, setIsError] = useState(false);

  const loadInvitation = useCallback(async () => {
    if (!service) return;
    setLoading(true);
    if (!workspaceId || !code) {
      setIsError(true);
      return;
    }

    try {
      const info = await service.getGuestInvitation(workspaceId, code);

      setWorkspace({
        id: info.workspace_id,
        name: info.workspace_name,
        icon: info.workspace_icon_url,
        memberCount: 0,
        databaseStorageId: '',
        createdAt: '',
      });

      setPage({
        view_id: info.view_id,
        name: info.page_name,
      });

      if (info.is_existing_member) {
        return;
      }

      await service.acceptGuestInvitation(workspaceId, code);

      // eslint-disable-next-line
    } catch (e: any) {
      if (e.code === ERROR_CODE.INVALID_LINK) {
        setInvalidMessage(e.message);
        setIsInvalid(true);
      } else if (e.code === ERROR_CODE.ALREADY_JOINED) {
        // do nothing
      } else if (e.code === ERROR_CODE.NOT_INVITEE_OF_INVITATION) {
        setNotInvitee(true);
      } else {
        setIsError(true);
      }
    } finally {
      setLoading(false);
    }
  }, [code, service, workspaceId]);

  useEffect(() => {
    void loadInvitation();
  }, [loadInvitation]);

  if (isInvalid) {
    return <InvalidLink message={invalidMessage} />;
  }

  if (notInvitee) {
    return <NotInvitationAccount />;
  }

  if (isError) {
    return <ErrorPage onRetry={loadInvitation} />;
  }

  return (
    <LandingPage
      Logo={SuccessLogo}
      workspace={workspace}
      title={
        <div className='font-normal'>
          <Trans
            i18nKey='landingPage.asGuest.title'
            components={{
              page: <span className='font-bold'>{page?.name || t('menuAppHeader.defaultNewPageName')}</span>,
            }}
          />
        </div>
      }
      primaryAction={{
        onClick: () => {
          window.open(`/app/${workspace?.id}/${page?.view_id}`, '_self');
        },
        label: loading ? (
          <span className='flex items-center gap-2'>
            <Progress />
            {t('landingPage.asGuest.viewPage')}
          </span>
        ) : (
          t('landingPage.asGuest.viewPage')
        ),
        loading,
      }}
    />
  );
}
