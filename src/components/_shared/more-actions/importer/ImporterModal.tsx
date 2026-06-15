
import { useTranslation } from 'react-i18next';

import { ReactComponent as ImportIcon } from '@/assets/icons/save_as.svg';
import { NormalModal } from '@/components/_shared/modal';
import ImporterDialogContent from '@/components/_shared/more-actions/importer/ImporterDialogContent';

export function ImporterModal ({
  open,
  onClose,
  source,
  onSuccess,
  disableClose,
}: {
  open: boolean,
  onClose: () => void,
  source?: string,
  onSuccess: () => void,
  disableClose?: boolean
}) {
  const { t } = useTranslation();

  return (
    <NormalModal
      onCancel={onClose}
      title={
        <div className={'flex items-center gap-2 justify-center font-semibold'}>
          <ImportIcon className={'w-5 h-5'} />
          {t('web.import')}
        </div>
      }
      open={open}
      onClose={onClose}
      classes={{ container: 'items-start max-md:mt-auto max-md:items-center mt-[10%] ' }}
      okButtonProps={{
        className: 'hidden',
      }}
      cancelButtonProps={{
        className: 'hidden',
      }}
      closable={!disableClose}
    >
      <ImporterDialogContent
        onSuccess={onSuccess}
        source={source}
      />
    </NormalModal>
  );
}

export default ImporterModal;