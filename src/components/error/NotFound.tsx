import { AFConfigContext, useCurrentUser } from '@/components/main/app.hooks';
import React, { useContext } from 'react';
import { Typography, Button } from '@mui/material';
import { Trans, useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { ReactComponent as AppflowyLogo } from '@/assets/icons/appflowy.svg';

const NotFound = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const openLoginModal = useContext(AFConfigContext)?.openLoginModal;
  const currentUser = useCurrentUser();
  const email = currentUser?.email || '';

  return (
    <div className={'m-0 flex h-screen w-screen items-center justify-center bg-bg-body p-0'}>
      <div className={'flex flex-col items-center gap-1 text-center'}>
        <Typography variant='h3' className={'mb-[27px] flex items-center gap-4 text-text-title'} gutterBottom>
          <AppflowyLogo className={'w-32'} />
        </Typography>
        <div className={'mb-[16px] text-[52px] font-semibold leading-[128%] text-text-title max-sm:text-[24px]'}>
          {t('publish.noAccessToVisit')}
        </div>
        <div className={'text-[20px] leading-[152%]'}>
          <div>{t('publish.createWithAppFlowy')}</div>
          <div className={'flex items-center gap-1'}>
            <div className={'font-semibold text-fill-default'}>{t('publish.fastWithAI')}</div>
            <div>{t('publish.tryItNow')}</div>
          </div>
        </div>
        <div className={'mt-4 flex w-full items-center justify-between gap-4 px-2 max-sm:flex-col'}>
          <Button
            component={Link}
            to='https://appflowy.com/download'
            variant='contained'
            color='primary'
            className={'flex-1 rounded-[8px] py-3 px-4 text-[20px] font-medium max-md:text-base max-sm:w-full'}
          >
            {t('publish.downloadApp')}
          </Button>
          <Button
            onClick={() => {
              navigate('/');
            }}
            className={'flex-1 rounded-[8px] py-3 px-4 text-[20px] font-medium max-md:text-base max-sm:w-full'}
            variant={'outlined'}
            color={'inherit'}
          >
            {t('requestAccess.backToHome')}
          </Button>
        </div>
        {currentUser ? (
          <div className={'mt-10 flex max-w-[400px] flex-col text-text-caption'}>
            <span>
              <Trans
                i18nKey='requestAccess.tip'
                components={{ link: <span className={'text-fill-default'}>{email}</span> }}
              />
            </span>
            <span>
              <Trans
                i18nKey='requestAccess.mightBe'
                components={{
                  login: (
                    <span onClick={() => openLoginModal?.()} className={'cursor-pointer text-fill-default underline'}>
                      {t('signIn.logIn')}
                    </span>
                  ),
                }}
              />
            </span>
          </div>
        ) : (
          <div className={'mt-10 flex max-w-[400px] flex-col gap-1 text-text-caption'}>
            You are currently not logged in.
            <div>
              Click
              <span className={'mx-1 cursor-pointer text-fill-default underline'} onClick={() => openLoginModal?.()}>
                here
              </span>
              to login.
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default NotFound;
