import { AnimatePresence, motion } from 'framer-motion';
import React, { useCallback, useContext, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AuthProvider } from '@/application/types';
import { ReactComponent as AppleSvg } from '@/assets/login/apple.svg';
import { ReactComponent as DiscordSvg } from '@/assets/login/discord.svg';
import { ReactComponent as GithubSvg } from '@/assets/login/github.svg';
import { ReactComponent as GoogleSvg } from '@/assets/login/google.svg';
import { ReactComponent as SamlSvg } from '@/assets/login/saml.svg';
import { notify } from '@/components/_shared/notify';
import SamlLoginDialog from '@/components/login/SamlLoginDialog';
import { AFConfigContext } from '@/components/main/app.hooks';
import { Button } from '@/components/ui/button';

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
  availableProviders = [],
}: {
  redirectTo: string;
  availableProviders?: AuthProvider[];
}) {
  const { t } = useTranslation();
  const [expand, setExpand] = React.useState(false);
  const service = useContext(AFConfigContext)?.service;

  // SAML SSO dialog state
  const [samlDialogOpen, setSamlDialogOpen] = useState(false);

  const allOptions = useMemo(
    () => [
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
    ],
    [t]
  );

  // Filter options based on available providers
  const options = useMemo(() => {
    return allOptions.filter((option) => availableProviders.includes(option.value));
  }, [allOptions, availableProviders]);

  // Handle SAML SSO login with email domain
  const handleSamlSubmit = useCallback(
    async (domain: string) => {
      await service?.signInSaml({ redirectTo, domain });
    },
    [service, redirectTo]
  );

  const handleClick = useCallback(
    async (option: AuthProvider) => {
      try {
        switch (option) {
          case AuthProvider.GOOGLE:
            await service?.signInGoogle({ redirectTo });
            break;
          case AuthProvider.APPLE:
            await service?.signInApple({ redirectTo });
            break;
          case AuthProvider.GITHUB:
            await service?.signInGithub({ redirectTo });
            break;
          case AuthProvider.DISCORD:
            await service?.signInDiscord({ redirectTo });
            break;
          case AuthProvider.SAML:
            // Open SAML dialog to get user's email for domain identification
            setSamlDialogOpen(true);
            return;
        }
      } catch (e) {
        notify.error(t('web.signInError'));
      }
    },
    [service, t, redirectTo]
  );

  const renderOption = useCallback(
    (option: (typeof options)[0]) => {
      return (
        <Button
          key={option.value}
          size={'lg'}
          variant={'outline'}
          className={'w-full'}
          onClick={() => handleClick(option.value)}
        >
          <option.Icon className={'h-5 w-5'} />
          <div className={'w-auto whitespace-pre'}>{option.label}</div>
        </Button>
      );
    },
    [handleClick]
  );

  // Don't show component if no OAuth providers available
  if (options.length === 0) {
    return null;
  }

  return (
    <div className={'flex w-full transform flex-col items-center justify-center gap-3 transition-all'}>
      {options.slice(0, 2).map((option, index) => (
        <motion.div
          key={`option-${index}`}
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
            initial='initial'
            animate='initial'
            exit='exit'
            whileHover='hover'
            whileTap='tap'
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
                key={`extra-option-${index}`}
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
    </div>
  );
}

export default LoginProvider;
