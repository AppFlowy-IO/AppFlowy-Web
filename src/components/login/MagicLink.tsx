import { AFConfigContext } from '@/components/main/app.hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';
import React, { useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import isEmail from 'validator/lib/isEmail';

function MagicLink ({ redirectTo }: { redirectTo: string }) {
  const { t } = useTranslation();
  const [email, setEmail] = React.useState<string>('');
  const [loading, setLoading] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string>('');
  const [, setSearch] = useSearchParams();
  const service = useContext(AFConfigContext)?.service;
  const handleSubmit = async () => {
    if (loading) return;
    const isValidEmail = isEmail(email);

    if (!isValidEmail) {
      toast.error(t('signIn.invalidEmail'));
      return;
    }

    setError('');
    setLoading(true);

    void (async () => {
      try {
        await service?.signInMagicLink({
          email,
          redirectTo,
        });
        // eslint-disable-next-line
      } catch (e: any) {
        if (e.code === 429 || e.response?.status === 429) {
          toast.error(t('tooManyRequests'));
        } else {
          toast.error(e.message);
        }
      } finally {
        setLoading(false);
      }
    })();

    setSearch(prev => {
      prev.set('email', email);
      prev.set('action', 'checkEmail');
      return prev;
    });

  };

  return (
    <div className={'flex w-full flex-col items-center justify-center gap-3'}>
      <div className={'flex flex-col gap-1'}>
        <Input
          size={'md'}
          variant={error ? 'destructive' : 'default'}
          type={'email'}
          className={'w-[320px]'}
          onChange={(e) => {
            setError('');
            setEmail(e.target.value);
          }}
          value={email}
          placeholder={t('signIn.pleaseInputYourEmail')}
          onKeyDown={e => {
            if (createHotkey(HOT_KEY_NAME.ENTER)(e.nativeEvent)) {
              void handleSubmit();
            }
          }}
        />
        {error && <div className={cn('help-text text-xs text-text-error')}>
          {error}
        </div>}
      </div>

      <Button
        onClick={handleSubmit}
        size={'lg'}
        className={'w-[320px]'}
        loading={loading}
      >
        {loading ? <>
          <Progress />
          {t('loading')}
        </> : t('signIn.signInWithEmail')}
      </Button>
    </div>
  );
}

export default MagicLink;
