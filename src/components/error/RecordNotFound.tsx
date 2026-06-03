import { ComponentProps, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppError, ErrorType } from '@/application/utils/error-utils';
import { ReactComponent as ErrorIcon } from '@/assets/icons/error.svg';
import { ReactComponent as NoAccessIcon } from '@/assets/icons/no_access.svg';
import { ReactComponent as WarningIcon } from '@/assets/icons/warning.svg';
import emptyImageSrc from '@/assets/images/empty.png';
import LandingPage from '@/components/_shared/landing-page/LandingPage';
import { useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { RequestAccessContent } from '@/components/app/share/RequestAccessContent';
import { Progress } from '@/components/ui/progress';

// Every error state below renders inside the app shell (content area, modal,
// drawer, or mobile view) — never as a standalone full page. LandingPage defaults
// to viewport sizing, which overflows past the sidebar and de-centers the card, so
// embed it with `fitParent` to fill its container (matches RequestAccessContent).
function EmbeddedLandingPage(props: ComponentProps<typeof LandingPage>) {
  return <LandingPage {...props} fitParent />;
}

function RecordNotFound({
  viewId,
  noContent,
  isViewNotFound,
  error,
  onRetry,
}: {
  viewId?: string;
  noContent?: boolean;
  isViewNotFound?: boolean;
  error?: AppError;
  onRetry?: () => void | Promise<unknown>;
}) {
  const { t } = useTranslation();
  const currentWorkspaceId = useCurrentWorkspaceId();
  const [retrying, setRetrying] = useState(false);

  const goToHomepage = () => {
    window.location.href = '/app';
  };

  const goToLogin = () => {
    window.location.href = '/';
  };

  const handleRetry = async () => {
    setRetrying(true);
    if (onRetry) {
      try {
        await onRetry();
      } finally {
        setRetrying(false);
      }
    } else {
      window.location.reload();
    }
  };

  if (error) {
    switch (error.type) {
      case ErrorType.PageNotFound:
        // No "Go to homepage" action: /app redirects back to the last opened
        // view, which is this missing page, so the button just loops here. The
        // sidebar and the footer's "login with a different account" link remain.
        return (
          <EmbeddedLandingPage
            Logo={WarningIcon}
            title={t('landingPage.pageNotFound.title')}
            description={t('landingPage.pageNotFound.description')}
          />
        );

      case ErrorType.Unauthorized:
        return (
          <EmbeddedLandingPage
            Logo={NoAccessIcon}
            title={t('landingPage.unauthorized.title')}
            description={t('landingPage.unauthorized.description')}
            primaryAction={{
              onClick: goToLogin,
              label: t('landingPage.unauthorized.signIn'),
            }}
          />
        );

      case ErrorType.Forbidden:
        if (viewId && currentWorkspaceId) {
          return <RequestAccessContent viewId={viewId} workspaceId={currentWorkspaceId} />;
        }

        return (
          <EmbeddedLandingPage
            Logo={NoAccessIcon}
            title={t('landingPage.forbidden.title')}
            description={t('landingPage.forbidden.description')}
            primaryAction={{
              onClick: goToHomepage,
              label: t('landingPage.pageNotFound.goToHomepage'),
            }}
          />
        );

      case ErrorType.ServerError:
        return (
          <EmbeddedLandingPage
            Logo={ErrorIcon}
            title={t('landingPage.serverError.title')}
            description={t('landingPage.serverError.description')}
            primaryAction={{
              onClick: handleRetry,
              label: retrying ? (
                <span className='flex items-center gap-2'>
                  <Progress />
                  {t('landingPage.serverError.retry')}
                </span>
              ) : (
                t('landingPage.serverError.retry')
              ),
            }}
          />
        );

      case ErrorType.NetworkError:
        return (
          <EmbeddedLandingPage
            Logo={ErrorIcon}
            title={t('landingPage.networkError.title')}
            description={t('landingPage.networkError.description')}
            primaryAction={{
              onClick: handleRetry,
              label: retrying ? (
                <span className='flex items-center gap-2'>
                  <Progress />
                  {t('landingPage.networkError.retry')}
                </span>
              ) : (
                t('landingPage.networkError.retry')
              ),
            }}
          />
        );

      case ErrorType.InvalidLink:
        return (
          <EmbeddedLandingPage
            Logo={WarningIcon}
            title={t('landingPage.invalidLink.title')}
            description={t('landingPage.invalidLink.description')}
            primaryAction={{
              onClick: goToHomepage,
              label: t('landingPage.invalidLink.goToHomepage'),
            }}
          />
        );

      case ErrorType.AlreadyJoined:
        return (
          <EmbeddedLandingPage
            Logo={NoAccessIcon}
            title={t('landingPage.alreadyJoined.title')}
            description={t('landingPage.alreadyJoined.description')}
            primaryAction={{
              onClick: goToHomepage,
              label: t('landingPage.alreadyJoined.goToWorkspace'),
            }}
          />
        );

      case ErrorType.NotInvitee:
        return (
          <EmbeddedLandingPage
            Logo={NoAccessIcon}
            title={t('landingPage.notInvitee.title')}
            description={t('landingPage.notInvitee.description')}
            primaryAction={{
              onClick: goToHomepage,
              label: t('landingPage.notInvitee.goToHomepage'),
            }}
          />
        );

      case ErrorType.Gone:
        return (
          <EmbeddedLandingPage
            Logo={WarningIcon}
            title={t('landingPage.gone.title')}
            description={t('landingPage.gone.description')}
            primaryAction={{
              onClick: goToHomepage,
              label: t('landingPage.gone.goToHomepage'),
            }}
          />
        );

      case ErrorType.Timeout:
        return (
          <EmbeddedLandingPage
            Logo={WarningIcon}
            title={t('landingPage.timeout.title')}
            description={t('landingPage.timeout.description')}
            primaryAction={{
              onClick: handleRetry,
              label: retrying ? (
                <span className='flex items-center gap-2'>
                  <Progress />
                  {t('landingPage.timeout.retry')}
                </span>
              ) : (
                t('landingPage.timeout.retry')
              ),
            }}
          />
        );

      case ErrorType.RateLimited:
        return (
          <EmbeddedLandingPage
            Logo={WarningIcon}
            title={t('landingPage.rateLimited.title')}
            description={t('landingPage.rateLimited.description')}
            primaryAction={{
              onClick: handleRetry,
              label: retrying ? (
                <span className='flex items-center gap-2'>
                  <Progress />
                  {t('landingPage.rateLimited.retry')}
                </span>
              ) : (
                t('landingPage.rateLimited.retry')
              ),
            }}
          />
        );

      case ErrorType.Unknown:
      default:
        return (
          <EmbeddedLandingPage
            Logo={ErrorIcon}
            title={t('landingPage.unknown.title')}
            description={t('landingPage.unknown.description')}
            primaryAction={{
              onClick: handleRetry,
              label: retrying ? (
                <span className='flex items-center gap-2'>
                  <Progress />
                  {t('landingPage.unknown.retry')}
                </span>
              ) : (
                t('landingPage.unknown.retry')
              ),
            }}
            secondaryAction={{
              onClick: goToHomepage,
              label: t('landingPage.unknown.goToHomepage'),
            }}
          />
        );
    }
  }

  if (viewId && currentWorkspaceId && !error) {
    return <RequestAccessContent viewId={viewId} workspaceId={currentWorkspaceId} />;
  }

  return (
    <div className={'flex h-full w-full flex-col items-center justify-center px-4'}>
      {!noContent && (
        <>
          <div className={'flex items-center gap-4 text-2xl font-bold text-text-primary opacity-70'}>
            <WarningIcon className={'h-12 w-12'} />
            {isViewNotFound ? 'Page Not Found' : 'Record Not Found'}
          </div>
          <div className={'mt-4 whitespace-pre-wrap break-words text-center text-lg text-text-primary opacity-50'}>
            {`We're sorry for inconvenience\n`}
            Submit an issue on our{' '}
            <a
              className={'text-text-action  underline'}
              href={'https://github.com/AppFlowy-IO/AppFlowy/issues/new?template=bug_report.yaml'}
            >
              Github
            </a>{' '}
            page that describes your error
          </div>
        </>
      )}

      <img src={emptyImageSrc} alt={'AppFlowy'} />
    </div>
  );
}

export default RecordNotFound;
