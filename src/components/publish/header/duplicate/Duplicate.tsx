import { Button, IconButton, Tooltip } from '@mui/material';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import { ReactComponent as CopyIcon } from '@/assets/icons/copy.svg';
import { LoginModal } from '@/components/login';
import DuplicateModal from '@/components/publish/header/duplicate/DuplicateModal';
import { useDuplicate } from '@/components/publish/header/duplicate/useDuplicate';
import { getPlatform } from '@/utils/platform';

export function Duplicate() {
  const { t } = useTranslation();
  const { loginOpen, duplicateOpen, handleDuplicateClose, handleLoginClose, url } = useDuplicate();
  const [, setSearch] = useSearchParams();
  const handleClick = useCallback(() => {
    setSearch((prev) => {
      prev.set('action', 'duplicate');
      return prev;
    });
  }, [setSearch]);

  const isMobile = useMemo(() => {
    return getPlatform().isMobile;
  }, []);

  return (
    <>
      {isMobile ? (
        <Tooltip title={t('publish.saveThisPage')}>
          <IconButton onClick={handleClick} size={'small'} color={'inherit'}>
            <CopyIcon />
          </IconButton>
        </Tooltip>
      ) : (
        <Button onClick={handleClick} size={'small'} variant={'contained'} color={'primary'}>
          {t('publish.saveThisPage')}
        </Button>
      )}

      <LoginModal redirectTo={url} open={loginOpen} onClose={handleLoginClose} />
      <DuplicateModal open={duplicateOpen} onClose={handleDuplicateClose} />
    </>
  );
}

export default Duplicate;
