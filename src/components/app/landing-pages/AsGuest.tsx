import { useCallback, useEffect, useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import { ERROR_CODE } from '@/application/constants';
import { WorkspaceService } from '@/application/services/domains';
import { Workspace } from '@/application/types';
import { ReactComponent as SuccessLogo } from '@/assets/icons/success_logo.svg';
import { LandingPageError } from '@/components/_shared/landing-page/errorContent';
import { ErrorPage } from '@/components/_shared/landing-page/ErrorPage';
import { InvalidLink } from '@/components/_shared/landing-page/InvalidLink';
import LandingPage from '@/components/_shared/landing-page/LandingPage';
import { NotInvitationAccount } from '@/components/_shared/landing-page/NotInvitationAccount';
import { useDesktopHandoff } from '@/components/app/hooks/useDesktopHandoff';
import { useCurrentUserOptional, useIsAuthenticatedOptional } from '@/components/main/app.hooks';
import { Progress } from '@/components/ui/progress';
import { buildOpenPageLink } from '@/utils/open_desktop_app';

export function AsGuest() {
  const { t } = useTranslation();
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
  const [error, setError] = useState<LandingPageError>();

  const isAuthenticated = useIsAuthenticatedOptional();
  const currentUser = useCurrentUserOptional();
  const { handoff } = useDesktopHandoff();
  const url = useMemo(() => window.location.href, []);

  const openPage = useCallback(() => {
    const goWeb = () => window.open(`/app/${workspace?.id}/${page?.view_id}`, '_self');

    if (!workspace?.id || !page?.view_id) {
      goWeb();
      return;
    }

    // Open the shared page in the desktop app if the user prefers it; otherwise stay on the web.
    handoff(
      buildOpenPageLink({ workspaceId: workspace.id, viewId: page.view_id, email: currentUser?.email }),
      { onStayInBrowser: goWeb }
    );
  }, [handoff, workspace?.id, page?.view_id, currentUser?.email]);

  // Redirect unauthenticated users to login, preserving the invitation URL
  useEffect(() => {
    if (!isAuthenticated) {
      window.open('/login?redirectTo=' + encodeURIComponent(url), '_self');
    }
  }, [isAuthenticated, url]);

  const loadInvitation = useCallback(async () => {
    setLoading(true);
    setError(undefined);

    if (!workspaceId || !code) {
      setError({
        message: t(
          'landingPage.error.invalidInvitationUrl',
          'This invitation link is missing required information. Please ask the sender for a new link.'
        ),
      });
      setIsError(true);
      setLoading(false);
      return;
    }

    try {
      const info = await WorkspaceService.getGuestInvitation(workspaceId, code);

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
        setIsError(false);
        return;
      }

      await WorkspaceService.acceptGuestInvitation(workspaceId, code);
      setIsError(false);

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
        setError(e);
        setIsError(true);
      }
    } finally {
      setLoading(false);
    }
  }, [code, t, workspaceId]);

  useEffect(() => {
    if (isAuthenticated) {
      void loadInvitation();
    }
  }, [isAuthenticated, loadInvitation]);

  if (isInvalid) {
    return <InvalidLink message={invalidMessage} />;
  }

  if (notInvitee) {
    return <NotInvitationAccount />;
  }

  if (isError) {
    return <ErrorPage onRetry={loadInvitation} error={error} />;
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
        onClick: openPage,
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
