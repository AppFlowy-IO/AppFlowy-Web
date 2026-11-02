import { CircularProgress, Dialog } from '@mui/material';
import { forwardRef, lazy, memo, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ReactEditor, useReadOnly, useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { BlockType, GoogleDriveBlockData } from '@/application/types';
import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import brand from '@/assets/icons/google-drive/brand.svg';
import logo from '@/assets/icons/google-drive/drive-logo.svg';
import errorIcon from '@/assets/icons/google-drive/error.svg';
import { Popover } from '@/components/_shared/popover';
import { useAIEnabled } from '@/components/app/app.hooks';
import { usePopoverContext } from '@/components/editor/components/block-popover/BlockPopoverContext';
import { EditorElementProps, GoogleDriveBlockNode } from '@/components/editor/editor.type';
import { useBlockSelected, useEditorContext } from '@/components/editor/EditorContext';
import { Button } from '@/components/ui/button';
import { openUrl } from '@/utils/url';

import { DRIVE_ACTION_EVENT, DriveAction, writableDrive } from './drive-actions';
import { driveDetails, driveName, driveSize, driveType, validDriveSource } from './drive-data';
import { DriveCaption } from './DriveCaption';
import { DriveAlignItems, DriveIcon, driveMenuPaper } from './DriveMenuItems';
import { DriveResizeHandles } from './DriveResizeHandles';
import { buildGoogleDriveEmbeddedUrl, getGoogleDriveFileId, resolveGoogleDriveName } from './google-drive-utils';
import { GoogleDriveBlockMenu } from './GoogleDriveBlockMenu';
import { useDriveLinkName } from './useDriveLinkName';
import { useDrivePreview } from './useDrivePreview';
import './google-drive.scss';

const MediaAssistant = lazy(() => import('../media/MediaAssistant'));

const Preview = memo(function Preview({
  url,
  thumbnail,
  name,
  onError,
}: {
  url: string;
  thumbnail?: string;
  name: string;
  onError: () => void;
}) {
  const [failedThumbnail, setFailedThumbnail] = useState('');

  return thumbnail && thumbnail !== failedThumbnail ? (
    // Match Flutter's full-width image inside a SingleChildScrollView. Fitting
    // it to the card height removes all overflow and makes tall previews unreadable.
    <div
      role='region'
      aria-label={name}
      tabIndex={0}
      className='h-full w-full overflow-auto overscroll-contain'
      onKeyDown={(event) => {
        // Let the browser scroll without Slate moving its selection. Escape
        // still reaches the fullscreen dialog so it can close normally.
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key))
          event.stopPropagation();
      }}
    >
      <div className='flex min-h-full items-center'>
        <img
          src={thumbnail}
          alt={name}
          draggable={false}
          className='block h-auto w-full'
          onError={() => setFailedThumbnail(thumbnail)}
        />
      </div>
    </div>
  ) : (
    <iframe
      title={name}
      src={url}
      className='h-full w-full border-0 bg-white'
      onError={onError}
      allow='autoplay; clipboard-read; clipboard-write; fullscreen'
      referrerPolicy='strict-origin-when-cross-origin'
      sandbox='allow-same-origin allow-scripts allow-popups allow-forms allow-downloads allow-popups-to-escape-sandbox'
    />
  );
});

export const GoogleDriveBlock = memo(
  forwardRef<HTMLDivElement, EditorElementProps<GoogleDriveBlockNode>>(({ node, children, ...attributes }, ref) => {
    const editor = useSlateStatic() as YjsEditor;
    const readOnly = useReadOnly() || editor.isElementReadOnly(node);
    const selected = useBlockSelected(node.blockId);
    const { workspaceId } = useEditorContext();
    const { openPopover, open, blockId: popoverId } = usePopoverContext();
    const ai = useAIEnabled();
    const { t, i18n } = useTranslation();
    const root = useRef<HTMLDivElement>(null);
    const sizing = useRef<HTMLDivElement>(null);
    const card = useRef<HTMLDivElement>(null);
    const caption = useRef<HTMLTextAreaElement>(null);
    const [menu, setMenu] = useState<HTMLElement | null>(null);
    const [alignAnchor, setAlignAnchor] = useState<HTMLElement | null>(null);
    const [focusCaption, setFocusCaption] = useState(false);
    const [assistant, setAssistant] = useState(false);
    const [fallbackFullscreen, setFallbackFullscreen] = useState(false);
    const [failure, setFailure] = useState(false);
    const [draft, setDraft] = useState<ReturnType<typeof driveSize>>();
    const source = validDriveSource(node.data.url);
    const fileId = node.data.file_id || (node.data.email && source ? getGoogleDriveFileId(source) : undefined);
    const preview = useDrivePreview(workspaceId, fileId, node.data.email, node.data.uploaded_at);
    const { reload } = preview;
    const privateSource = !!(node.data.file_id || node.data.email);
    const reconnect = !!source && privateSource && preview.status === 'reconnect';
    const failed = !!node.data.url && (!source || failure || (privateSource && preview.status === 'error'));
    const loading = privateSource && preview.status === 'loading';
    const needsName =
      !!source && !privateSource && (!node.data.name || node.data.name === resolveGoogleDriveName(source));
    const linkName = useDriveLinkName(needsName ? source : undefined);
    const name = preview.metadata?.name || linkName || driveName(node.data);
    const size = draft || driveSize(node.data);
    const embed = source ? buildGoogleDriveEmbeddedUrl(source) : '';
    const mimeType = preview.metadata?.mimeType || node.data.mime_type;
    // A PDF/document thumbnail contains only its first page. Keep the full
    // Google viewer for those files; image files alone can use an image preview.
    const imageThumbnail = mimeType?.startsWith('image/') ? preview.thumbnail : undefined;
    const change = useCallback(
      (data: Partial<GoogleDriveBlockData>) => {
        if (!readOnly && writableDrive(editor, node.blockId)) CustomEditor.setBlockData(editor, node.blockId, data);
      },
      [editor, node.blockId, readOnly]
    );

    useEffect(() => {
      const live = writableDrive(editor, node.blockId);

      if (linkName && needsName && live && live.data.url === node.data.url && live.data.name === node.data.name)
        change({ name: linkName });
    }, [linkName, needsName, editor, node.blockId, node.data.url, node.data.name, change]);
    const edit = () => {
      if (!readOnly && root.current) openPopover(node.blockId, BlockType.GoogleDriveBlock, root.current);
    };

    const closeAssistant = useCallback(() => setAssistant(false), []);
    const onPreviewError = useCallback(() => setFailure(true), []);
    const action = useCallback(
      (action: DriveAction) => {
        if (action === 'reload') {
          setFailure(false);
          reload();
        } else if (action === 'fullscreen' && source) {
          if (card.current?.requestFullscreen)
            void card.current.requestFullscreen().catch(() => setFallbackFullscreen(true));
          else setFallbackFullscreen(true);
        } else if (!readOnly && writableDrive(editor, node.blockId)) {
          if (action === 'caption') {
            if (typeof node.data.caption !== 'string') change({ caption: '' });
            setFocusCaption(true);
          } else if (action === 'ask' && ai) {
            ReactEditor.blur(editor);
            setAssistant(true);
          }
        }
      },
      [editor, node.blockId, node.data.caption, source, readOnly, change, reload, ai]
    );

    useEffect(() => {
      const nodeEntry = findSlateEntryByBlockId(editor, node.blockId);
      const element = nodeEntry && ReactEditor.toDOMNode(editor, nodeEntry[0]);
      const listen = (event: Event) => action((event as CustomEvent<DriveAction>).detail);

      element?.addEventListener(DRIVE_ACTION_EVENT, listen);
      return () => element?.removeEventListener(DRIVE_ACTION_EVENT, listen);
    }, [editor, node.blockId, action]);
    useEffect(() => {
      setFailure(false);
      setAssistant(false);
      setDraft(undefined);
    }, [source, node.data.uploaded_at, readOnly]);
    useEffect(() => {
      if (!focusCaption || typeof node.data.caption !== 'string') return;
      if (!readOnly) caption.current?.focus();
      setFocusCaption(false);
    }, [focusCaption, node.data.caption, readOnly]);

    const previewContent = failed ? (
      <div
        role='alert'
        className='flex h-full flex-col items-center justify-center gap-3 bg-fill-list-hover p-5 text-center text-sm'
      >
        <img src={errorIcon} alt='' />
        <p className='whitespace-pre-line text-text-secondary'>{t('document.plugins.googleDrive.loadError')}</p>
        <Button variant='outline' className='h-8' onClick={() => action('reload')}>
          {t('button.tryAgain')}
        </Button>
      </div>
    ) : loading ? (
      <div
        role='status'
        aria-label={t('settings.connections.loading')}
        className='flex h-full items-center justify-center'
      >
        <CircularProgress size={24} />
      </div>
    ) : (
      <Preview
        key={`${embed}:${preview.version}`}
        url={embed}
        thumbnail={imageThumbnail}
        name={name}
        onError={onPreviewError}
      />
    );
    const displayData = {
      ...node.data,
      mime_type: mimeType,
      size: preview.metadata?.size || node.data.size,
      modified_time: preview.metadata?.modifiedTime || node.data.modified_time,
    };
    const details = driveDetails(
      displayData,
      i18n.language,
      t(`document.plugins.googleDrive.metadataType.${driveType(displayData)}`)
    );
    const footer = (
      <div className='drive-footer flex min-w-0 shrink-0 items-center gap-3 border-t border-border-primary px-5 py-3'>
        <span className='flex h-10 w-10 shrink-0 items-center justify-center'>
          <img src={logo} alt='' />
        </span>
        <div className='min-w-0 flex-1'>
          <div className='truncate text-sm font-medium leading-5' title={name}>
            {name}
          </div>
          <div className='mt-1 truncate text-xs leading-[18px] tracking-[0.1px] text-text-secondary'>
            {details || t(`document.plugins.googleDrive.${driveType(displayData)}`)}
          </div>
        </div>
      </div>
    );

    return (
      <div
        {...attributes}
        ref={root}
        className={`google-drive-block relative w-full ${attributes.className || ''}`}
        data-selected={!!selected || !!menu}
        data-picker-open={open && popoverId === node.blockId}
      >
        <div contentEditable={false}>
          {!node.data.url ? (
            <div
              className='drive-empty drive-selection-surface relative flex h-11 items-center gap-2 rounded-lg bg-fill-list-active pl-3 pr-2'
              role={readOnly ? undefined : 'button'}
              tabIndex={readOnly ? undefined : 0}
              onClick={edit}
              onKeyDown={(event) => {
                if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) {
                  event.preventDefault();
                  edit();
                }
              }}
            >
              <img src={brand} alt='' />
              <span className='min-w-0 flex-1 truncate text-sm leading-5 text-text-tertiary'>
                {t('document.plugins.googleDrive.empty')}
              </span>
              {!readOnly && (
                <Button
                  variant='ghost'
                  size='icon'
                  className='h-7 w-7 shrink-0 text-icon-secondary'
                  aria-label={t('document.plugins.googleDrive.options')}
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenu(event.currentTarget);
                  }}
                >
                  <DriveIcon name='more' />
                </Button>
              )}
            </div>
          ) : reconnect ? (
            <div className='drive-empty drive-selection-surface relative flex min-h-[54px] items-center gap-2 rounded-lg bg-fill-list-active px-3 py-2'>
              <img src={brand} alt='' />
              <div className='min-w-0 flex-1'>
                <div className='truncate text-sm'>{name}</div>
                <div className='truncate text-xs text-text-secondary'>{new URL(source).origin}</div>
              </div>
              <Button variant='outline' className='h-8 gap-1 px-2' onClick={edit} disabled={readOnly}>
                <img src={brand} alt='' />
                {t('document.plugins.googleDrive.connectToDrive')}
              </Button>
            </div>
          ) : (
            <div
              ref={sizing}
              className='w-full'
              style={{
                display: 'flex',
                justifyContent:
                  node.data.align === 'right' ? 'flex-end' : node.data.align === 'center' ? 'center' : 'flex-start',
              }}
            >
              <div className='drive-content min-w-0' style={{ width: `${size.width_factor * 100}%` }}>
                <div
                  ref={card}
                  className='drive-card drive-selection-surface relative flex flex-col overflow-hidden rounded-xl border border-border-primary'
                  style={{ height: 400 * size.height_factor }}
                >
                  <div className='min-h-0 flex-1' style={{ pointerEvents: draft ? 'none' : undefined }}>
                    {previewContent}
                  </div>
                  {!failed && footer}
                  <div
                    className='drive-toolbar absolute right-2 top-2 z-10 flex gap-1 rounded-md bg-black/60 p-1 text-white shadow-menu backdrop-blur-[4px]'
                    data-open={!!menu || !!alignAnchor}
                    aria-label={t('document.plugins.googleDrive.controls')}
                  >
                    {!readOnly && ai && (
                      <Button
                        variant='ghost'
                        size='icon'
                        className='drive-toolbar-extra'
                        aria-label={t('document.plugins.pdf.askAI')}
                        title={t('document.plugins.pdf.askAI')}
                        onClick={() => action('ask')}
                      >
                        <DriveIcon name='ai' />
                      </Button>
                    )}
                    {!readOnly && (
                      <Button
                        variant='ghost'
                        size='icon'
                        className='drive-toolbar-extra'
                        aria-label={t('document.plugins.googleDrive.replace')}
                        title={t('document.plugins.googleDrive.replace')}
                        onClick={edit}
                      >
                        <DriveIcon name='replace' />
                      </Button>
                    )}
                    <Button
                      variant='ghost'
                      size='icon'
                      className='drive-toolbar-extra'
                      disabled={!source}
                      aria-label={t('document.plugins.pdf.fullScreen')}
                      title={t('document.plugins.pdf.fullScreen')}
                      onClick={() => action('fullscreen')}
                    >
                      <DriveIcon name='fullscreen' />
                    </Button>
                    {!readOnly && (
                      <Button
                        variant='ghost'
                        size='icon'
                        className='drive-toolbar-extra'
                        aria-label={t('document.plugins.optionAction.align')}
                        title={t('document.plugins.optionAction.align')}
                        onClick={(event) => setAlignAnchor(event.currentTarget)}
                      >
                        <DriveIcon name='align' />
                      </Button>
                    )}
                    <Button
                      variant='ghost'
                      size='icon'
                      aria-label={t('document.plugins.googleDrive.options')}
                      title={t('button.more')}
                      onClick={(event) => setMenu(event.currentTarget)}
                    >
                      <DriveIcon name='more' />
                    </Button>
                  </div>
                  <Button
                    className='drive-fullscreen-close absolute right-2 top-2 z-10 !h-8 !w-8 !bg-black/60 !p-1 !text-white'
                    variant='ghost'
                    size='icon'
                    aria-label={t('button.close')}
                    onClick={() => void document.exitFullscreen()}
                  >
                    <CloseIcon className='h-5 w-5' />
                  </Button>
                  {!readOnly && (
                    <DriveResizeHandles container={sizing} data={node.data} onDraft={setDraft} onCommit={change} />
                  )}
                </div>
                {typeof node.data.caption === 'string' && (
                  <DriveCaption
                    ref={caption}
                    readOnly={readOnly}
                    label={t('document.plugins.googleDrive.caption')}
                    placeholder={t('document.plugins.googleDrive.captionPlaceholder')}
                    value={node.data.caption}
                    onChange={(caption) => change({ caption })}
                  />
                )}
              </div>
            </div>
          )}
          {assistant && !readOnly && (
            <Suspense fallback={null}>
              <MediaAssistant node={node} mode='ask' text={`${name}\n${source}`} onClose={closeAssistant} />
            </Suspense>
          )}
        </div>
        {menu && <GoogleDriveBlockMenu node={node} anchorEl={menu} onClose={() => setMenu(null)} />}
        <Popover
          open={!!alignAnchor}
          anchorEl={alignAnchor}
          onClose={() => setAlignAnchor(null)}
          PaperProps={driveMenuPaper}
        >
          <div role='menu' className='w-[200px] p-2'>
            <DriveAlignItems
              align={node.data.align}
              onChange={(align) => {
                change({ align });
                setAlignAnchor(null);
              }}
            />
          </div>
        </Popover>
        <Dialog
          open={fallbackFullscreen}
          onClose={() => setFallbackFullscreen(false)}
          maxWidth={false}
          PaperProps={{ sx: { width: 'calc(100vw - 32px)', height: 'calc(100dvh - 32px)', margin: 2 } }}
        >
          <div className='flex justify-end p-2'>
            <Button variant='ghost' onClick={() => setFallbackFullscreen(false)}>
              {t('button.close')}
            </Button>
            <Button
              variant='ghost'
              onClick={() => {
                if (source) void openUrl(source, '_blank', 'noopener,noreferrer');
              }}
            >
              {t('document.plugins.pdf.openInBrowser')}
            </Button>
          </div>
          <div className='min-h-0 flex-1'>
            <Preview url={embed} thumbnail={imageThumbnail} name={name} onError={onPreviewError} />
          </div>
        </Dialog>
        <div ref={ref} className='pointer-events-none absolute h-0 w-0 overflow-hidden text-transparent'>
          {children}
        </div>
      </div>
    );
  })
);
GoogleDriveBlock.displayName = 'GoogleDriveBlock';
export default GoogleDriveBlock;
