import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AuthService } from '@/application/services/domains';
import {
  AuthProvider,
  CUSTOM_PROVIDER_PREFIX,
  CustomAuthProvider,
  CustomAuthProviderId,
  LoginProviderId,
  isCustomAuthProviderId,
} from '@/application/types';
import { ReactComponent as AppleSvg } from '@/assets/login/apple.svg';
import { ReactComponent as DiscordSvg } from '@/assets/login/discord.svg';
import { ReactComponent as GithubSvg } from '@/assets/login/github.svg';
import { ReactComponent as GoogleSvg } from '@/assets/login/google.svg';
import { ReactComponent as SamlSvg } from '@/assets/login/saml.svg';
import { notify } from '@/components/_shared/notify';
import LdapLoginDialog from '@/components/login/LdapLoginDialog';
import SamlLoginDialog from '@/components/login/SamlLoginDialog';
import { Button } from '@/components/ui/button';

/**
 * Fallback only, for a server that predates `custom_providers` and therefore
 * sends no display name. `custom:okta-prod` reads as "Okta Prod" — close, but
 * not what an admin typed, which is why the name is preferred when present.
 */
function customProviderLabel(identifier: CustomAuthProviderId) {
  return identifier
    .slice(CUSTOM_PROVIDER_PREFIX.length)
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Stable identities, so omitting a prop does not defeat the options memo. */
const NO_PROVIDERS: LoginProviderId[] = [];
const NO_CUSTOM_PROVIDERS: CustomAuthProvider[] = [];

const moreOptionsVariants = {
  hidden: {
    opacity: 0,
    height: 0,
  },
  visible: {
    opacity: 1,
    height: 'auto',
    transition: {
      height: {
        duration: 0.3,
        ease: [0.4, 0, 0.2, 1],
      },
      opacity: {
        duration: 0.2,
        delay: 0.05,
      },
    },
  },
};

function LoginProvider({
  redirectTo,
  availableProviders = NO_PROVIDERS,
  customProviders = NO_CUSTOM_PROVIDERS,
}: {
  redirectTo: string;
  availableProviders?: LoginProviderId[];
  customProviders?: CustomAuthProvider[];
}) {
  const { t } = useTranslation();
  const [expand, setExpand] = useState(false);
  // SAML SSO dialog state
  const [samlDialogOpen, setSamlDialogOpen] = useState(false);
  const [ldapDialogOpen, setLdapDialogOpen] = useState(false);

  // Only render what this deployment actually serves. Built-in providers are
  // matched against the advertised list; custom OAuth/OIDC providers are named
  // per deployment, so they come from that list rather than from any local
  // table — an unadvertised provider has no button at all.
  const options = useMemo(() => {
    const advertised = new Set<LoginProviderId>(availableProviders);

    const builtIn = [
      {
        label: t('web.continueWithGoogle'),
        Icon: GoogleSvg,
        value: AuthProvider.GOOGLE,
      },
      {
        label: t('web.continueWithApple'),
        Icon: AppleSvg,
        value: AuthProvider.APPLE,
      },
      {
        label: t('web.continueWithGithub'),
        value: AuthProvider.GITHUB,
        Icon: GithubSvg,
      },
      {
        label: t('web.continueWithDiscord'),
        value: AuthProvider.DISCORD,
        Icon: DiscordSvg,
      },
      {
        label: t('web.continueWithSaml'),
        value: AuthProvider.SAML,
        Icon: SamlSvg,
      },
      {
        label: t('web.continueWithLdap'),
        value: AuthProvider.LDAP,
        Icon: SamlSvg,
      },
    ].filter((option) => advertised.has(option.value));

    // The admin's chosen name wins; deriving a label from the identifier is only
    // a fallback for a server that does not send names. Blank names are dropped
    // rather than stored, so the `??` below cannot be satisfied by an empty one.
    const names = new Map(
      customProviders
        .filter((provider) => provider.name)
        .map((provider) => [provider.identifier, provider.name])
    );

    const custom = availableProviders.filter(isCustomAuthProviderId).map((identifier) => ({
      label: t('web.continueWithProvider', {
        provider: names.get(identifier) ?? customProviderLabel(identifier),
      }),
      value: identifier,
      Icon: SamlSvg,
    }));

    return [...builtIn, ...custom];
  }, [availableProviders, customProviders, t]);

  // Handle SAML SSO login with email domain
  const handleSamlSubmit = useCallback(
    async (domain: string) => {
      await AuthService.signInSaml({ redirectTo, domain });
    },
    [redirectTo]
  );

  // Completes server-side and returns tokens inline, so failures surface in the
  // dialog rather than as a redirect back to an error page.
  const handleLdapSubmit = useCallback(
    async (username: string, password: string) => {
      await AuthService.signInLdap({ username, password, redirectTo });
    },
    [redirectTo]
  );

  const handleClick = useCallback(
    async (option: LoginProviderId) => {
      try {
        if (isCustomAuthProviderId(option)) {
          await AuthService.signInCustomProvider({ redirectTo, identifier: option });
          return;
        }

        switch (option) {
          case AuthProvider.GOOGLE:
            await AuthService.signInGoogle({ redirectTo });
            break;
          case AuthProvider.APPLE:
            await AuthService.signInApple({ redirectTo });
            break;
          case AuthProvider.GITHUB:
            await AuthService.signInGithub({ redirectTo });
            break;
          case AuthProvider.DISCORD:
            await AuthService.signInDiscord({ redirectTo });
            break;
          case AuthProvider.SAML:
            // Open SAML dialog to get user's email for domain identification
            setSamlDialogOpen(true);
            return;
          case AuthProvider.LDAP:
            setLdapDialogOpen(true);
            return;
        }
      } catch (e) {
        notify.error(t('web.signInError'));
      }
    },
    [t, redirectTo]
  );

  // Called inline from the maps below rather than passed as a prop, so its
  // identity is unobservable and memoizing it would prevent nothing.
  const renderOption = (option: (typeof options)[0]) => (
    <Button
      size={'lg'}
      variant={'outline'}
      className={'w-full'}
      onClick={() => handleClick(option.value)}
    >
      <option.Icon className={'h-5 w-5'} />
      <div className={'w-auto whitespace-pre'}>{option.label}</div>
    </Button>
  );

  // Don't show component if no OAuth providers available
  if (options.length === 0) {
    return null;
  }

  return (
    <div className={'flex w-full transform flex-col items-center justify-center gap-3 transition-all'}>
      {options.slice(0, 2).map((option, index) => (
        <motion.div
          key={option.value}
          className='w-full'
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.3,
            delay: index * 0.1,
          }}
        >
          {renderOption(option)}
        </motion.div>
      ))}

      <AnimatePresence mode='wait'>
        {!expand && options.length > 2 && (
          <motion.div
            className='w-full'
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <Button variant={'link'} onClick={() => setExpand(true)} className={'w-full'}>
              {t('web.moreOptions')}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {expand && (
          <motion.div
            className='flex w-full flex-col gap-3 overflow-hidden'
            variants={moreOptionsVariants}
            initial='hidden'
            animate='visible'
          >
            {options.slice(2).map((option, index) => (
              <motion.div
                key={option.value}
                className='w-full'
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.25,
                  delay: 0.1 + index * 0.07,
                }}
              >
                {renderOption(option)}
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <SamlLoginDialog
        open={samlDialogOpen}
        onOpenChange={setSamlDialogOpen}
        onSubmit={handleSamlSubmit}
      />

      <LdapLoginDialog
        open={ldapDialogOpen}
        onOpenChange={setLdapDialogOpen}
        onSubmit={handleLdapSubmit}
      />
    </div>
  );
}

export default LoginProvider;
