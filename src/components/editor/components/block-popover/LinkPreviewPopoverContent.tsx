import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { LinkPreviewBlockData, LinkPreviewType } from '@/application/types';
import EmbedLink from '@/components/_shared/image-upload/EmbedLink';
import { processUrl } from '@/utils/url';

function LinkPreviewPopoverContent({ blockId, onClose }: { blockId: string; onClose: () => void }) {
  const editor = useSlateStatic() as YjsEditor;
  const { t } = useTranslation();
  const entry = useMemo(() => {
    try {
      return findSlateEntryByBlockId(editor, blockId);
    } catch {
      return null;
    }
  }, [blockId, editor]);
  const data = entry?.[0]?.data as LinkPreviewBlockData | undefined;

  const handleInsertEmbedLink = useCallback(
    (rawUrl: string) => {
      const url = processUrl(rawUrl) || rawUrl;

      CustomEditor.setBlockData(editor, blockId, {
        url,
        preview_type: data?.preview_type ?? LinkPreviewType.Bookmark,
      } as LinkPreviewBlockData);
      onClose();
    },
    [blockId, data?.preview_type, editor, onClose]
  );

  return (
    <div className={'flex flex-col gap-2 p-4'}>
      <EmbedLink
        onDone={handleInsertEmbedLink}
        defaultLink={data?.url}
        placeholder={t('document.plugins.urlPreview.placeholder', { defaultValue: 'Paste a link' })}
      />
    </div>
  );
}

export default LinkPreviewPopoverContent;
