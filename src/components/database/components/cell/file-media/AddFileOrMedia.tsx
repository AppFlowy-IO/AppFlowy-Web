import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FileMediaCell as CellType } from '@/application/database-yjs/cell.type';
import { ReactComponent as AddIcon } from '@/assets/icons/plus.svg';
import FileMediaUpload from '@/components/database/components/cell/file-media/FileMediaUpload';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';


function AddFileOrMedia ({
  cell,
  fieldId,
  rowId,
}: {
  cell?: CellType;
  fieldId: string;
  rowId: string;
}) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
    >
      <PopoverTrigger asChild>
        <Button
          variant={'ghost'}
          className={'w-full justify-start'}
        >
          <AddIcon className={'w-5 h-5'} />
          {t('grid.media.addFileOrMedia')}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        onMouseDown={e => {
          e.stopPropagation();
        }}
        side={'top'}
        align={'center'}
        className={'overflow-hidden min-w-fit'}
      >
        <FileMediaUpload
          rowId={rowId}
          fieldId={fieldId}
          cell={cell}
          onClose={handleClose}
        />
      </PopoverContent>
    </Popover>
  );
}

export default AddFileOrMedia;