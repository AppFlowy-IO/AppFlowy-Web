import { YjsEditor } from '@/application/slate-yjs';
import { VideoBlockNode } from '@/components/editor/editor.type';
import React from 'react';
import { ReactComponent as ImageIcon } from '@/assets/image.svg';
import { useTranslation } from 'react-i18next';
import { Element } from 'slate';
import { useReadOnly, useSlateStatic } from 'slate-react';

function VideoEmpty({ node }: { node: VideoBlockNode }) {
  const { t } = useTranslation();
  const editor = useSlateStatic() as YjsEditor;

  const readOnly = useReadOnly() || editor.isElementReadOnly(node as unknown as Element);

  return (
    <>
      <div
        className={
          `flex w-full select-none items-center gap-4 text-text-caption ${readOnly ? 'cursor-not-allowed' : 'cursor-pointer'}`
        }
      >
        <ImageIcon className={'w-6 h-6'} />
        {t('embedAVideo')}
      </div>
    </>
  );
}

export default VideoEmpty;
