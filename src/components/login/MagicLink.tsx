import { AFConfigContext } from '@/components/main/app.hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';
import React, { useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import isEmail from 'validator/lib/isEmail';

function MagicLink ({ redirectTo }: { redirectTo: string }) {
  const { t } = useTranslation();
  const [email, setEmail] = React.useState<string>('');
  const [, setLoading] = React.useState<boolean>(false);
  const service = useContext(AFConfigContext)?.service;
  const handleSubmit = async () => {
    const isValidEmail = isEmail(email);

    if (!isValidEmail) {
      toast.error(t('signIn.invalidEmail'));
      return;
    }

    setLoading(true);

    try {
      void service?.signInMagicLink({
        email,
        redirectTo,
      });

      window.location.href = `/login?action=checkEmail&email=${email}&redirectTo=${redirectTo}`;
    } catch (e) {
      toast.error(t('web.signInError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={'flex w-full flex-col items-center justify-center gap-3'}>
      <Input
        size={'md'}
        type={'email'}
        className={'w-[320px]'}
        onChange={(e) => setEmail(e.target.value)}
        value={email}
        placeholder={t('signIn.pleaseInputYourEmail')}
        onKeyDown={e => {
          if (createHotkey(HOT_KEY_NAME.ENTER)(e.nativeEvent)) {
            void handleSubmit();
          }
        }}
      />

      <Button
        onClick={handleSubmit}
        size={'lg'}
        className={'w-[320px]'}
      >
        {t('signIn.signInWithEmail')}
      </Button>
    </div>
  );
}

export default MagicLink;
