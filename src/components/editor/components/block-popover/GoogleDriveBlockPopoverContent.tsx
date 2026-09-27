import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSlateStatic } from 'slate-react';

import { DriveFile, driveFileUrl } from '@/application/integrations/google-drive';
import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { GoogleDriveBlockData } from '@/application/types';
import EmbedLink from '@/components/_shared/image-upload/EmbedLink';
import {
  isGoogleDriveUrl,
  resolveGoogleDriveName,
} from '@/components/editor/components/blocks/google-drive/google-drive-utils';
import { GoogleDriveBrowser } from '@/components/editor/components/blocks/google-drive/GoogleDriveBrowser';
import { useEditorContext } from '@/components/editor/EditorContext';
import { Button } from '@/components/ui/button';
import { processUrl } from '@/utils/url';

function GoogleDriveBlockPopoverContent({ blockId, onClose }: { blockId: string; onClose: () => void }) {
  const editor = useSlateStatic() as YjsEditor;
  const { t } = useTranslation();
  const { workspaceId } = useEditorContext();
  const [browse, setBrowse] = useState(false);
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
        email: '',
        file_id: '',
        name: resolveGoogleDriveName(url),
        uploaded_at: Date.now(),
        width_factor: data?.width_factor ?? 1,
        height_factor: data?.height_factor ?? 1,
      } as GoogleDriveBlockData);
      onClose();
    },
    [blockId, data?.height_factor, data?.width_factor, editor, onClose]
  );

  const handleSelectFile = (file: DriveFile, email?: string) => {
    CustomEditor.setBlockData(editor, blockId, {
      url: driveFileUrl(file),
      name: file.name,
      email: email ?? '',
      file_id: file.id,
      uploaded_at: Date.now(),
      width_factor: data?.width_factor ?? 1,
      height_factor: data?.height_factor ?? 1,
    });
    onClose();
  };

  return (
    <div className={'flex flex-col gap-2 p-4'}>
      {workspaceId && (
        <div className='flex gap-2'>
          <Button variant={browse ? 'ghost' : 'outline'} onClick={() => setBrowse(false)}>
            {t('document.plugins.googleDrive.pasteLink')}
          </Button>
          <Button variant={browse ? 'outline' : 'ghost'} onClick={() => setBrowse(true)}>
            {t('document.plugins.googleDrive.browseGoogleDrive')}
          </Button>
        </div>
      )}
      {browse && workspaceId ? (
        <GoogleDriveBrowser key={workspaceId} workspaceId={workspaceId} onSelect={handleSelectFile} />
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}

export default GoogleDriveBlockPopoverContent;
