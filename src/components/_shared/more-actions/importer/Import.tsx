import { ReactNode, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as CheckedIcon } from '@/assets/icons/check_circle.svg';
import { NormalModal } from '@/components/_shared/modal';
import { ImporterModal } from '@/components/_shared/more-actions/importer/ImporterModal';
import { useImport } from '@/components/_shared/more-actions/importer/useImport.hook';
import { LoginModal } from '@/components/login';
import { useAuthenticatedUserIdOptional } from '@/components/main/app.hooks';
import { getConfigValue } from '@/utils/runtime-config';

/**
 * The shared new-workspace importer. A finished upload always gets a confirmation, because the
 * workspace appears only after the server processes the file; hosts are notified as well.
 */
function Import({
  disableClose,
  onSuccessfulImport,
  successMessage,
}: {
  disableClose?: boolean;
  onSuccessfulImport?: () => void;
  /** Replaces the default note about finding the workspace in the switcher. */
  successMessage?: ReactNode;
}) {
  const { open, handleImportClose, handleLoginClose, loginOpen, url, source } = useImport();
  const [openSuccess, setOpenSuccess] = useState(false);
  const { t } = useTranslation();
  const userId = useAuthenticatedUserIdOptional();
  const serverUrl = getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud');

  const handleSuccess = useCallback(() => {
    setOpenSuccess(true);
    onSuccessfulImport?.();
  }, [onSuccessfulImport]);

  return (
    <>
      <LoginModal redirectTo={url} open={loginOpen} onClose={handleLoginClose} />
      {open && (
        <ImporterModal
          key={`${serverUrl}:${userId ?? ''}`}
          open={open}
          disableClose={disableClose}
          source={source || undefined}
          onClose={handleImportClose}
          onSuccess={handleSuccess}
        />
      )}
      {openSuccess && (
        <NormalModal
          classes={{ container: 'items-start max-md:mt-auto max-md:items-center mt-[20%] ' }}
          title={
            <div className={'flex items-center gap-2 font-semibold'}>
              <CheckedIcon className={'h-4 w-4 text-function-success'} />
              {t('web.importSuccess')}
            </div>
          }
          open={openSuccess}
          onOk={() => {
            setOpenSuccess(false);
            handleImportClose();
          }}
          cancelButtonProps={{
            className: 'hidden',
          }}
          closable={false}
          onClose={() => setOpenSuccess(false)}
        >
          <div className='text-text-secondary'>{successMessage ?? t('web.importSuccessMessage')}</div>
        </NormalModal>
      )}
    </>
  );
}

export default Import;
