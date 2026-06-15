import { Button, CircularProgress } from '@mui/material';
import { useTranslation } from 'react-i18next';

import { QuickNote } from '@/application/types';
import { ReactComponent as AddIcon } from '@/assets/icons/plus.svg';
import { useAddNode } from '@/components/quick-note/QuickNote.hooks';

function AddNote ({
  onEnterNote,
  onAdd,
}: {
  onEnterNote: (node: QuickNote) => void;
  onAdd: (note: QuickNote) => void;
}) {
  const {
    handleAdd,
    loading,
  } = useAddNode({
    onEnterNote,
    onAdd,
  });

  const { t } = useTranslation();

  return (
    <>
      <Button
        size={'small'}
        color={'inherit'}
        startIcon={loading ? <CircularProgress size={20} /> : <AddIcon />}
        onClick={handleAdd}
        className={'justify-start w-full'}
      >
        {t('quickNote.addNote')}
      </Button>
    </>
  );
}

export default AddNote;