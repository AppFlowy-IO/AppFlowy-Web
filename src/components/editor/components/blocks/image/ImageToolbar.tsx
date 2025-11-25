import { Divider } from '@mui/material';
import React, { Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Element } from 'slate';
import { useReadOnly, useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as PreviewIcon } from '@/assets/icons/full_screen.svg';
import { GalleryPreview } from '@/components/_shared/gallery-preview';
import ActionButton from '@/components/editor/components/toolbar/selection-toolbar/actions/ActionButton';
import Align from '@/components/editor/components/toolbar/selection-toolbar/actions/Align';
import { ImageBlockNode } from '@/components/editor/editor.type';
import { useEditorContext } from '@/components/editor/EditorContext';

function ImageToolbar({ node }: { node: ImageBlockNode }) {
  const editor = useSlateStatic() as YjsEditor;
  const readOnly = useReadOnly() || editor.isElementReadOnly(node as unknown as Element);
  const { t } = useTranslation();
  const [openPreview, setOpenPreview] = React.useState(false);
  const { workspaceId, viewId } = useEditorContext();
  const onOpenPreview = () => {
    setOpenPreview(true);
  };

  const onDelete = () => {
    CustomEditor.deleteBlock(editor, node.blockId);
  };

  return (
    <div className={'absolute right-0 top-0 z-10'}>
      <div className={'flex space-x-1 rounded-[8px] border border-border-primary bg-fill-toolbar p-1 shadow '}>
        {!readOnly && (
          <ActionButton onClick={onOpenPreview} tooltip={t('document.imageBlock.openFullScreen')}>
            <PreviewIcon />
          </ActionButton>
        )}

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
      {openPreview && (
        <Suspense>
          <GalleryPreview
            workspaceId={workspaceId}
            viewId={viewId}
            images={[{ src: node.data.url || '' }]}
            previewIndex={0}
            open={openPreview}
            onClose={() => {
              setOpenPreview(false);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}

export default ImageToolbar;
