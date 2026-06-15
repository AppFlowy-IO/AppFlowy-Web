import { Button } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { ReactComponent as TrashIcon } from '@/assets/icons/delete.svg';

export function Trash () {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <Button
      size={'small'} onClick={() => {
      navigate('/app/trash');
    }}
      variant={'text'}
      color={'inherit'}
      className={'flex-1'}
      startIcon={<TrashIcon />}
    >{
      t('trash.text')
    }</Button>
  );
}

export default Trash;