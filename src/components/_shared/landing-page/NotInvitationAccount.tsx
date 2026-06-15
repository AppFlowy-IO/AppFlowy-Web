import { useMemo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { ReactComponent as Logo } from '@/assets/icons/no_access.svg';
import LandingPage from '@/components/_shared/landing-page/LandingPage';
import { useCurrentUser, useOpenLoginModalOptional } from '@/components/main/app.hooks';

export function NotInvitationAccount() {
  const { t } = useTranslation();

  const currentUser = useCurrentUser();
  const openLoginModal = useOpenLoginModalOptional();

  const url = useMemo(() => {
    return window.location.href;
  }, []);

  return (
    <LandingPage
      Logo={Logo}
      title={t('landingPage.notInvitationAccount.title')}
      description={
        <Trans
          i18nKey={'landingPage.notInvitationAccount.description'}
          components={{
            email: <span className='font-medium'>{currentUser?.email}</span>,
          }}
        />
      }
      primaryAction={{
        onClick: () => openLoginModal?.(url),
        label: t('landingPage.notInvitationAccount.loginWithInvitationEmail'),
      }}
      secondaryAction={{
        onClick: () => window.open('/app', '_self'),
        label: t('landingPage.backToHome'),
      }}
    />
  );
}
