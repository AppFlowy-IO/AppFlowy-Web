import { toast } from 'sonner';
import { AFConfigContext } from '@/components/main/app.hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import React, { useContext } from 'react';
import { useTranslation } from 'react-i18next';
import isEmail from 'validator/lib/isEmail';

function MagicLink ({ redirectTo }: { redirectTo: string }) {
  const { t } = useTranslation();
  const [email, setEmail] = React.useState<string>('');
  const [loading, setLoading] = React.useState<boolean>(false);
  const service = useContext(AFConfigContext)?.service;
  const handleSubmit = async () => {
    const isValidEmail = isEmail(email);

    if (!isValidEmail) {
      toast.error(t('signIn.invalidEmail'));
      return;
    }

    setLoading(true);

    try {
      await service?.signInMagicLink({
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
      />

      <Button
        onClick={handleSubmit}
        disabled={loading}
        size={'lg'}
        className={'w-[320px]'}
      >
        {loading ? (
          <>
            <Progress />
            {t('editor.loading')}...
          </>
        ) : (
          t('signIn.signInWithEmail')
        )}
      </Button>
    </div>
  );
}

export default MagicLink;
