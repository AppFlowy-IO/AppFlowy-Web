import { Button } from '@mui/material';
import { useTranslation } from 'react-i18next';

import { ReactComponent as CloseSvg } from '@/assets/icons/close.svg';
import { ReactComponent as InformationSvg } from '@/assets/icons/help.svg';

export const ErrorModal = ({ message, onClose }: { message: string; onClose: () => void }) => {
  const { t } = useTranslation();

  return (
    <div className={'fixed inset-0 z-10 flex items-center justify-center bg-bg-mask backdrop-blur-sm'}>
      <div
        className={
          'border-shade-5 relative flex flex-col items-center gap-8 rounded-xl border border-border-primary bg-background-primary px-16 py-8 shadow-md'
        }
      >
        <button
          onClick={() => onClose()}
          className={'absolute right-0 top-0 z-10 px-2 py-2 text-text-secondary hover:text-text-primary'}
        >
          <CloseSvg className={'h-5 w-5'} />
        </button>
        <div className={'text-main-alert'}>
          <InformationSvg className={'h-24 w-24'} />
        </div>
        <h1 className={'text-xl'}>{t('error.generalError')}</h1>
        <h2>{message}</h2>

        <Button
          onClick={() => {
            window.location.reload();
          }}
        >
          Reload
        </Button>
      </div>
    </div>
  );
};
