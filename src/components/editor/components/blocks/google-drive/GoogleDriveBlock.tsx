import { Divider } from '@mui/material';
import { forwardRef, memo, useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Element } from 'slate';
import { useReadOnly, useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { BlockType } from '@/application/types';
import { ReactComponent as CopyIcon } from '@/assets/icons/copy.svg';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as OpenIcon } from '@/assets/icons/link_arrow.svg';
import { ReactComponent as GoogleIcon } from '@/assets/login/google.svg';
import { notify } from '@/components/_shared/notify';
import { usePopoverContext } from '@/components/editor/components/block-popover/BlockPopoverContext';
import ActionButton from '@/components/editor/components/toolbar/selection-toolbar/actions/ActionButton';
import { EditorElementProps, GoogleDriveBlockNode } from '@/components/editor/editor.type';
import { copyTextToClipboard } from '@/utils/copy';
import { openUrl } from '@/utils/url';

import { buildGoogleDriveEmbeddedUrl } from './google-drive-utils';

export const GoogleDriveBlock = memo(
  forwardRef<HTMLDivElement, EditorElementProps<GoogleDriveBlockNode>>(({ node, children, ...attributes }, ref) => {
    const { t } = useTranslation();
    const { blockId, data } = node;
    const { url, name } = data || {};
    const editor = useSlateStatic() as YjsEditor;
    const readOnly = useReadOnly() || editor.isElementReadOnly(node as unknown as Element);
    const { openPopover } = usePopoverContext();
    const emptyRef = useRef<HTMLDivElement>(null);
    const [showToolbar, setShowToolbar] = useState(false);
    const embeddedUrl = useMemo(() => (url ? buildGoogleDriveEmbeddedUrl(url) : ''), [url]);

    const openEditPopover = useCallback(() => {
      if (emptyRef.current && !readOnly) {
        openPopover(blockId, BlockType.GoogleDriveBlock, emptyRef.current);
      }
    }, [blockId, openPopover, readOnly]);

    const onCopy = useCallback(async () => {
      if (!url) return;

      await copyTextToClipboard(url);
      notify.success(t('button.copyLinkOriginal'));
    }, [t, url]);

    const onOpen = useCallback(() => {
      if (!url) return;
      void openUrl(url, '_blank');
    }, [url]);

    const onDelete = useCallback(() => {
      CustomEditor.deleteBlock(editor, blockId);
    }, [blockId, editor]);

    return (
      <div
        {...attributes}
        contentEditable={readOnly ? false : undefined}
        className={['w-full', !readOnly || embeddedUrl ? 'cursor-pointer' : 'text-text-secondary', attributes.className]
          .filter(Boolean)
          .join(' ')}
        onClick={() => {
          if (!embeddedUrl) {
            openEditPopover();
          }
        }}
        onMouseEnter={() => {
          if (embeddedUrl) setShowToolbar(true);
        }}
        onMouseLeave={() => setShowToolbar(false)}
      >
        <div
          contentEditable={false}
          className={`embed-block flex-col p-4 ${embeddedUrl ? '!border-none !bg-transparent !p-0' : ''}`}
        >
          {embeddedUrl ? (
            <div
              className={
                'relative w-full overflow-hidden rounded-[8px] border border-border-primary bg-fill-list-active'
              }
            >
              <iframe
                title={name || t('document.slashMenu.name.googleDrive', { defaultValue: 'Google Drive' })}
                src={embeddedUrl}
                className={'h-[420px] w-full bg-white'}
                loading='lazy'
                allow='autoplay; clipboard-read; clipboard-write'
                sandbox='allow-same-origin allow-scripts allow-popups allow-forms allow-downloads'
              />
              {showToolbar && (
                <div onClick={(e) => e.stopPropagation()} className={'absolute right-2 top-2 z-10'}>
                  <div
                    className={'flex space-x-1 rounded-[8px] border border-border-primary bg-fill-toolbar p-1 shadow'}
                  >
                    <ActionButton onClick={onCopy} tooltip={t('button.copyLinkOriginal')}>
                      <CopyIcon />
                    </ActionButton>
                    <ActionButton onClick={onOpen} tooltip={'Open'}>
                      <OpenIcon />
                    </ActionButton>
                    {!readOnly && (
                      <>
                        <Divider className={'my-1.5 bg-line-on-toolbar'} orientation={'vertical'} flexItem={true} />
                        <ActionButton onClick={onDelete} tooltip={t('button.delete')}>
                          <DeleteIcon />
                        </ActionButton>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div ref={emptyRef} className={'flex w-full select-none items-center gap-4 text-text-secondary'}>
              <GoogleIcon className={'h-6 w-6 flex-none'} />
              {t('document.plugins.googleDrive.worksWithLinksOfGoogleDrive', {
                defaultValue: 'Embed a Google Drive link',
              })}
            </div>
          )}
        </div>
        <div ref={ref} className={'pointer-events-none absolute h-full w-full text-transparent caret-transparent'}>
          {children}
        </div>
      </div>
    );
  })
);

GoogleDriveBlock.displayName = 'GoogleDriveBlock';

export default GoogleDriveBlock;
