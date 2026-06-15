import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useFieldSelector } from '@/application/database-yjs';
import { useUpdateFileMediaTypeOption } from '@/application/database-yjs/dispatch';
import { parseFileMediaTypeOptions } from '@/application/database-yjs/fields/media/parse';
import { DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut } from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';

function FileMediaPropertyMenuContent({ fieldId }: { fieldId: string }) {
  const { field, clock } = useFieldSelector(fieldId);
  const typeOption = useMemo(() => {
    if (!field) return null;
    return parseFileMediaTypeOptions(field);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field, clock]);

  const showFileNames = typeOption?.hide_file_names !== true;

  const { t } = useTranslation();

  const updateOption = useUpdateFileMediaTypeOption(fieldId);

  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onSelect={(e) => {
          e.preventDefault();
          updateOption({
            hideFileNames: !typeOption?.hide_file_names,
          });
        }}
      >
        {t('grid.media.showFileNames')}
        <DropdownMenuShortcut className={'flex items-center'}>
          <Switch checked={showFileNames} />
        </DropdownMenuShortcut>
      </DropdownMenuItem>
    </>
  );
}

export default FileMediaPropertyMenuContent;
