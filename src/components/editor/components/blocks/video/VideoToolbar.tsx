import { Divider } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { Element } from 'slate';
import { useReadOnly, useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { ReactComponent as CopyIcon } from '@/assets/icons/copy.svg';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { notify } from '@/components/_shared/notify';
import ActionButton from '@/components/editor/components/toolbar/selection-toolbar/actions/ActionButton';
import Align from '@/components/editor/components/toolbar/selection-toolbar/actions/Align';
import { VideoBlockNode } from '@/components/editor/editor.type';
import { copyTextToClipboard } from '@/utils/copy';

function VideoToolbar({ node }: { node: VideoBlockNode }) {
  const editor = useSlateStatic() as YjsEditor;
  const readOnly = useReadOnly() || editor.isElementReadOnly(node as unknown as Element);
  const { t } = useTranslation();
  const onCopy = async () => {
    await copyTextToClipboard(node.data.url || '');
    notify.success(t('copiedVideoLink'));
  };

  const onDelete = () => {
    CustomEditor.deleteBlock(editor, node.blockId);
  };

  return (
    <div className={'absolute right-0 top-0 z-10'}>
      <div className={'flex space-x-1 rounded-[8px] border border-border-primary bg-fill-toolbar p-1 shadow '}>
        <ActionButton onClick={onCopy} tooltip={t('button.copyLinkOriginal')}>
          <CopyIcon />
        </ActionButton>

        {!readOnly && (
          <>
            <Align blockId={node.blockId} />
            <Divider className={'my-1.5 bg-line-on-toolbar'} orientation={'vertical'} flexItem={true} />
            <ActionButton onClick={onDelete} tooltip={t('button.delete')}>
              <DeleteIcon />
            </ActionButton>
          </>
        )}
      </div>
    </div>
  );
}

export default VideoToolbar;
