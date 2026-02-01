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
import { AFConfigContext } from '@/components/main/app.hooks';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

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

  // SAML SSO state
  const [samlDialogOpen, setSamlDialogOpen] = useState(false);
  const [samlEmail, setSamlEmail] = useState('');
  const [samlLoading, setSamlLoading] = useState(false);

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
  const handleSamlLogin = useCallback(async () => {
    if (!samlEmail) {
      notify.error(t('web.emailRequired'));
      return;
    }

    // Extract domain from email
    const emailParts = samlEmail.split('@');

    if (emailParts.length !== 2 || !emailParts[1]) {
      notify.error(t('web.invalidEmail'));
      return;
    }

    const domain = emailParts[1];

    setSamlLoading(true);
    try {
      await service?.signInSaml({ redirectTo, domain });
    } catch (e: unknown) {
      const err = e as { message?: string };

      notify.error(err?.message || t('web.signInError'));
    } finally {
      setSamlLoading(false);
    }
  }, [samlEmail, service, redirectTo, t]);

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

      {/* SAML SSO Email Dialog */}
      <Dialog open={samlDialogOpen} onOpenChange={setSamlDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('web.ssoLogin')}</DialogTitle>
            <DialogDescription>
              {t('web.ssoLoginDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            <Input
              type="email"
              placeholder={t('web.emailPlaceholder')}
              value={samlEmail}
              onChange={(e) => setSamlEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  void handleSamlLogin();
                }
              }}
              disabled={samlLoading}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setSamlDialogOpen(false);
                setSamlEmail('');
              }}
              disabled={samlLoading}
            >
              {t('button.cancel')}
            </Button>
            <Button
              onClick={handleSamlLogin}
              disabled={samlLoading || !samlEmail}
            >
              {samlLoading ? t('web.signingIn') : t('web.continueWithSso')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default LoginProvider;
