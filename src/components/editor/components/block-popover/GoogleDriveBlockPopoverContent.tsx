import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { GoogleDriveBlockData } from '@/application/types';
import EmbedLink from '@/components/_shared/image-upload/EmbedLink';
import {
  isGoogleDriveUrl,
  resolveGoogleDriveName,
} from '@/components/editor/components/blocks/google-drive/google-drive-utils';
import { processUrl } from '@/utils/url';

function GoogleDriveBlockPopoverContent({ blockId, onClose }: { blockId: string; onClose: () => void }) {
  const editor = useSlateStatic() as YjsEditor;
  const { t } = useTranslation();
  const entry = useMemo(() => {
    try {
      return findSlateEntryByBlockId(editor, blockId);
    } catch {
      return null;
    }
  }, [blockId, editor]);
  const data = entry?.[0]?.data as GoogleDriveBlockData | undefined;

  const handleInsertEmbedLink = useCallback(
    (rawUrl: string) => {
      const url = processUrl(rawUrl) || rawUrl;

      CustomEditor.setBlockData(editor, blockId, {
        url,
        name: resolveGoogleDriveName(url),
        uploaded_at: Date.now(),
        width_factor: data?.width_factor ?? 1,
        height_factor: data?.height_factor ?? 1,
      } as GoogleDriveBlockData);
      onClose();
    },
    [blockId, data?.height_factor, data?.width_factor, editor, onClose]
  );

  return (
    <div className={'flex flex-col gap-2 p-4'}>
      <EmbedLink
        onDone={handleInsertEmbedLink}
        defaultLink={data?.url}
        placeholder={t('document.plugins.googleDrive.embedPlaceholder', {
          defaultValue: 'Paste a Google Drive link',
        })}
        validator={isGoogleDriveUrl}
      />
      <div className={'w-full text-center text-sm text-text-secondary'}>
        {t('document.plugins.googleDrive.worksWithLinksOfGoogleDrive', {
          defaultValue: 'Works with Google Docs, Sheets, Slides, Forms, files, and folders.',
        })}
      </div>
    </div>
  );
}

export default GoogleDriveBlockPopoverContent;
