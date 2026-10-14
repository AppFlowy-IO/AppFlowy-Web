import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { ViewIconType } from '@/application/types';
import { ReactComponent as AddEmojiIcon } from '@/assets/icons/add_emoji.svg';
import { ReactComponent as ChevronRightIcon } from '@/assets/icons/alt_arrow_right.svg';
import { CustomIconPopover } from '@/components/_shared/cutsom-icon';
import {
  CALLOUT_ICON_VERSION,
  calloutIconUpdate,
  getCalloutIcon,
} from '@/components/editor/components/blocks/callout/callout.utils';
import { CalloutNode } from '@/components/editor/editor.type';
import { useEditorContext } from '@/components/editor/EditorContext';
import { Button } from '@/components/ui/button';

function CalloutIconControl({ node, onSelectIcon }: { node: CalloutNode; onSelectIcon: () => void }) {
  const { t } = useTranslation();
  const editor = useSlateStatic() as YjsEditor;
  const { uploadFile } = useEditorContext();
  const currentIcon = getCalloutIcon(node.data);
  const [open, setOpen] = useState(false);

  const handleChangeIcon = useCallback(
    (icon: { ty: ViewIconType; value: string; color?: string; content?: string }) => {
      CustomEditor.setBlockData(editor, node.blockId, calloutIconUpdate(icon));
      setOpen(false);
      onSelectIcon();
    },
    [editor, node.blockId, onSelectIcon]
  );

  const handleRemoveIcon = useCallback(() => {
    CustomEditor.setBlockData(editor, node.blockId, { icon: '', icon_type: 'icon', version: CALLOUT_ICON_VERSION });
    setOpen(false);
    onSelectIcon();
  }, [editor, node.blockId, onSelectIcon]);

  return (
    <CustomIconPopover
      open={open}
      onOpenChange={setOpen}
      onSelectIcon={handleChangeIcon}
      removeIcon={handleRemoveIcon}
      defaultActiveTab={currentIcon?.type === 'custom' ? 'upload' : currentIcon?.type || 'emoji'}
      tabs={['emoji', 'icon', 'upload']}
      onUploadFile={uploadFile}
      hideRemove={false}
      popoverContentProps={{ side: 'right', align: 'start' }}
    >
      <Button
        size='sm'
        variant='ghost'
        className='justify-start px-1'
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
      >
        <AddEmojiIcon className='h-5 w-5' />
        {t('document.callout.changeIcon')}
        <ChevronRightIcon className='ml-auto h-5 w-5 text-icon-tertiary' />
      </Button>
    </CustomIconPopover>
  );
}

export default CalloutIconControl;
