import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSlateStatic } from 'slate-react';

import { DriveFile } from '@/application/integrations/google-drive';
import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { BlockType, LinkPreviewBlockData } from '@/application/types';
import { notify } from '@/components/_shared/notify';
import { writableDrive } from '@/components/editor/components/blocks/google-drive/drive-actions';
import {
  driveFileData,
  driveLink,
  driveLinkData,
  validDriveSource,
} from '@/components/editor/components/blocks/google-drive/drive-data';
import { GoogleDriveBrowser } from '@/components/editor/components/blocks/google-drive/GoogleDriveBrowser';
import { useEditorContext } from '@/components/editor/EditorContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function GoogleDriveBlockPopoverContent({ blockId, onClose }: { blockId: string; onClose: () => void }) {
  const editor = useSlateStatic() as YjsEditor;
  const { t } = useTranslation();
  const { workspaceId } = useEditorContext();
  const [tab, setTab] = useState<'link' | 'browse'>('link');
  // Replace always starts with a fresh, focused link field.
  const [input, setInput] = useState('');
  const [originalUrl] = useState(() => writableDrive(editor, blockId)?.data.url);
  const canReplace = () => {
    const live = writableDrive(editor, blockId);

    return live && live.data.url === originalUrl;
  };

  const url = driveLink(input);
  const select = (file: DriveFile, email?: string) => {
    if (!canReplace()) return;
    CustomEditor.setBlockData(editor, blockId, driveFileData(file, email));
    onClose();
  };

  return (
    <div className='google-drive-picker w-full text-sm' data-testid='google-drive-picker'>
      <div
        role='tablist'
        aria-label={t('document.plugins.googleDrive.name')}
        className='flex border-b border-border-primary pl-3 pt-3'
      >
        {(['link', 'browse'] as const).map((value) => (
          <button
            key={value}
            type='button'
            role='tab'
            aria-selected={tab === value}
            className={`h-[34px] border-b-2 px-[10px] pb-2 font-medium ${
              tab === value ? 'border-border-theme-thick text-text-primary' : 'border-transparent text-text-tertiary'
            }`}
            onClick={() => setTab(value)}
          >
            {t(
              value === 'link'
                ? 'document.plugins.googleDrive.embedLink'
                : 'document.plugins.googleDrive.browseGoogleDrive'
            )}
          </button>
        ))}
      </div>
      {tab === 'link' ? (
        <form
          className='flex flex-col gap-4 p-5'
          onSubmit={(event) => {
            event.preventDefault();
            if (!url || !canReplace()) return;
            if (validDriveSource(url)) CustomEditor.setBlockData(editor, blockId, driveLinkData(url));
            else {
              CustomEditor.turnToBlock(editor, blockId, BlockType.LinkPreview, { url } as LinkPreviewBlockData);
              notify.warning(t('document.plugins.pdf.unableToEmbed'));
            }

            onClose();
          }}
        >
          <Input
            autoFocus
            aria-label={t('document.plugins.googleDrive.embedPlaceholder')}
            placeholder={t('document.plugins.googleDrive.embedPlaceholder')}
            className='h-10 rounded-[10px] px-2 text-sm'
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
          <Button type='submit' className='h-8 w-full' disabled={!url}>
            {t('document.plugins.googleDrive.embed')}
          </Button>
          <p className='text-sm leading-5 text-text-secondary'>
            {t('document.plugins.googleDrive.worksWithLinksOfGoogleDrive')}
          </p>
        </form>
      ) : workspaceId ? (
        <GoogleDriveBrowser key={workspaceId} workspaceId={workspaceId} onSelect={select} />
      ) : (
        <p className='p-5 text-text-secondary'>{t('document.plugins.googleDrive.accountRequired')}</p>
      )}
    </div>
  );
}
