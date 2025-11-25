import { useTranslation } from 'react-i18next';

import { ReactComponent as InvalidLinkLogo } from '@/assets/icons/invalid_link.svg';
import LandingPage from '@/components/_shared/landing-page/LandingPage';

type InvalidLinkProps = {
  message?: string;
};

export function InvalidLink({ message }: InvalidLinkProps) {
  const { t } = useTranslation();

  return (
    <LandingPage
      Logo={InvalidLinkLogo}
      title={t('landingPage.inviteMember.invalid')}
      description={message ?? t('landingPage.inviteMember.invalidMessage')}
      secondaryAction={{
        onClick: () => window.open('/app', '_self'),
        label: t('landingPage.backToHome'),
      }}
    />
  );
}
