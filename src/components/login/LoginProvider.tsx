import { notify } from '@/components/_shared/notify';
import { AFConfigContext } from '@/components/main/app.hooks';
import { motion, AnimatePresence } from 'framer-motion';
import React, { useCallback, useContext, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ReactComponent as GoogleSvg } from '@/assets/login/google.svg';
import { ReactComponent as GithubSvg } from '@/assets/login/github.svg';
import { ReactComponent as DiscordSvg } from '@/assets/login/discord.svg';
import { ReactComponent as AppleSvg } from '@/assets/login/apple.svg';
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

function LoginProvider ({ redirectTo }: { redirectTo: string }) {
  const { t } = useTranslation();
  const [expand, setExpand] = React.useState(false);
  const options = useMemo(
    () => [
      {
        label: t('web.continueWithGoogle'),
        Icon: GoogleSvg,
        value: 'google',
      },
      {
        label: t('web.continueWithApple'),
        Icon: AppleSvg,
        value: 'apple',
      },
      {
        label: t('web.continueWithGithub'),
        value: 'github',
        Icon: GithubSvg,
      },
      {
        label: t('web.continueWithDiscord'),
        value: 'discord',
        Icon: DiscordSvg,
      },
    ],
    [t],
  );
  const service = useContext(AFConfigContext)?.service;

  const handleClick = useCallback(async (option: string) => {
    try {
      switch (option) {
        case 'google':
          await service?.signInGoogle({ redirectTo });
          break;
        case 'apple':
          await service?.signInApple({ redirectTo });
          break;
        case 'github':
          await service?.signInGithub({ redirectTo });
          break;
        case 'discord':
          await service?.signInDiscord({ redirectTo });
          break;
      }
    } catch (e) {
      notify.error(t('web.signInError'));
    }
  }, [service, t, redirectTo]);

  const renderOption = useCallback((option: typeof options[0]) => {

    return <Button
      key={option.value}
      size={'lg'}
      variant={'outline'}
      className={'w-full'}
      onClick={() => handleClick(option.value)}
    >
      <option.Icon className={'w-5 h-5'} />
      <div className={'w-auto whitespace-pre'}>{option.label}</div>

    </Button>;
  }, [handleClick]);

  return (
    <div className={'flex transform transition-all gap-3 w-full flex-col items-center justify-center'}>
      {options.slice(0, 2).map((option, index) => (
        <motion.div
          key={`option-${index}`}
          className="w-full"
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

      <AnimatePresence mode="wait">
        {!expand && (
          <motion.div
            className="w-full"
            initial="initial"
            animate="initial"
            exit="exit"
            whileHover="hover"
            whileTap="tap"
          >
            <Button
              variant={'link'}
              onClick={() => setExpand(true)}
              className={'w-full'}
            >
              {t('web.moreOptions')}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {expand && (
          <motion.div
            className="w-full flex flex-col gap-3 overflow-hidden"
            variants={moreOptionsVariants}
            initial="hidden"
            animate="visible"
          >
            {options.slice(2).map((option, index) => (
              <motion.div
                key={`extra-option-${index}`}
                className="w-full"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.25,
                  delay: 0.1 + (index * 0.07),
                }}
              >
                {renderOption(option)}
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default LoginProvider;
