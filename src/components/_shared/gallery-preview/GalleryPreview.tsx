import { CircularProgress, IconButton, Portal, Tooltip } from '@mui/material';
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ReactZoomPanPinchContentRef, TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';

import { ReactComponent as RightIcon } from '@/assets/icons/alt_arrow_right.svg';
import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { ReactComponent as LinkIcon } from '@/assets/icons/link.svg';
import { ReactComponent as MinusIcon } from '@/assets/icons/minus.svg';
import { ReactComponent as AddIcon } from '@/assets/icons/plus.svg';
import { ReactComponent as ReloadIcon } from '@/assets/icons/reset.svg';
import { ReactComponent as DownloadIcon } from '@/assets/icons/save_as.svg';
import { useAuthenticatedOriginalImage } from '@/components/_shared/hooks/useAuthenticatedImage';
import { notify } from '@/components/_shared/notify';
import { copyTextToClipboard } from '@/utils/copy';
import { downloadFile } from '@/utils/download';
import { resolveFileUrl } from '@/utils/file-storage-url';

export interface GalleryImage {
  src: string;
}

export interface GalleryPreviewProps {
  images: GalleryImage[];
  open: boolean;
  onClose: () => void;
  previewIndex: number;
  workspaceId: string;
  viewId: string;
}

const buttonClassName = 'p-1 hover:bg-transparent text-white hover:text-text-action p-0';

/** Zoom is relative to the fitted image: 1 shows the whole picture, 8 inspects a 12 MP photo pixel for pixel. */
const MIN_SCALE = 0.5;
const MAX_SCALE = 8;

/**
 * The toolbar block is about 100 px tall at the bottom; a fitted image, which
 * is centred, ends above it once it is twice that short.
 */
const VIEWPORT_INSET = 'calc(100vh - 200px)';

function fileNameFromUrl(url: string): string | undefined {
  try {
    const name = new URL(url, window.location.origin).pathname.split('/').pop();

    return name ? decodeURIComponent(name) : undefined;
  } catch {
    return undefined;
  }
}

function GalleryPreview({ images, open, onClose, previewIndex, workspaceId, viewId }: GalleryPreviewProps) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(previewIndex);
  const [scale, setScale] = useState(1);
  const [loadedSrc, setLoadedSrc] = useState('');
  const transformComponentRef = useRef<ReactZoomPanPinchContentRef>(null);
  const lastPanEndRef = useRef(0);

  const imageUrl = useMemo(() => {
    const image = images[index];

    return image ? resolveFileUrl(image.src, workspaceId, viewId) : '';
  }, [images, index, workspaceId, viewId]);

  // Fetched with the session token (a plain <img src> would be refused for a
  // private file) and served from the media cache when the file was seen
  // before, so a photo already shown as a thumbnail opens without a download.
  const authenticatedSrc = useAuthenticatedOriginalImage(open ? imageUrl : undefined);
  const ready = Boolean(authenticatedSrc) && loadedSrc === authenticatedSrc;

  const resetView = useCallback(() => {
    transformComponentRef.current?.resetTransform();
    setScale(1);
  }, []);

  const handleToPrev = useCallback(() => {
    setIndex((prev) => (prev === 0 ? images.length - 1 : prev - 1));
    resetView();
  }, [images.length, resetView]);

  const handleToNext = useCallback(() => {
    setIndex((prev) => (prev === images.length - 1 ? 0 : prev + 1));
    resetView();
  }, [images.length, resetView]);

  const handleCopy = useCallback(async () => {
    const image = images[index];

    if (!image) {
      return;
    }

    await copyTextToClipboard(image.src);
    notify.success(t('publish.copy.imageBlock'));
  }, [images, index, t]);

  const handleDownload = useCallback(() => {
    if (!imageUrl) return;

    // Keeps the bearer token on protected files, unlike `window.open`.
    void downloadFile(imageUrl, fileNameFromUrl(imageUrl));
  }, [imageUrl]);

  const handleKeydown = useCallback(
    (e: KeyboardEvent) => {
      const transform = transformComponentRef.current;

      switch (e.key) {
        case 'ArrowLeft':
        case 'ArrowUp':
          handleToPrev();
          break;
        case 'ArrowRight':
        case 'ArrowDown':
          handleToNext();
          break;
        case 'Escape':
          onClose();
          break;
        case '+':
        case '=':
          transform?.zoomIn();
          break;
        case '-':
          transform?.zoomOut();
          break;
        case '0':
          resetView();
          break;
        default:
          // Leave every other shortcut to the browser.
          return;
      }

      e.preventDefault();
      e.stopPropagation();
    },
    [handleToNext, handleToPrev, onClose, resetView]
  );

  useEffect(() => {
    (document.activeElement as HTMLElement)?.blur();
    window.addEventListener('keydown', handleKeydown);

    return () => {
      window.removeEventListener('keydown', handleKeydown);
    };
  }, [handleKeydown]);

  // Releasing a drag past the image's edge also fires a click on the backdrop;
  // that must not close the viewer.
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (e.target !== e.currentTarget) return;
      if (Date.now() - lastPanEndRef.current < 200) return;
      onClose();
    },
    [onClose]
  );

  if (!open) {
    return null;
  }

  return (
    <Portal>
      <div
        className={'fixed inset-0 z-[1400] bg-black bg-opacity-80'}
        data-testid='gallery-preview'
        onClick={handleBackdropClick}
      >
        <TransformWrapper
          ref={transformComponentRef}
          initialScale={1}
          minScale={MIN_SCALE}
          maxScale={MAX_SCALE}
          centerZoomedOut
          wheel={{ step: 0.2 }}
          doubleClick={{ mode: 'toggle', step: 2 }}
          onPanningStop={() => {
            lastPanEndRef.current = Date.now();
          }}
          onTransformed={(_, state) => setScale(state.scale)}
        >
          {({ zoomIn, zoomOut }) => (
            <React.Fragment>
              <div
                className='absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 transform gap-4 p-4'
                onClick={(e) => e.stopPropagation()}
              >
                {images.length > 1 && (
                  <div className={'flex w-fit items-center gap-2 rounded-[8px] bg-bg-mask p-2'}>
                    <Tooltip title={t('gallery.prev')}>
                      <IconButton size={'small'} onClick={handleToPrev} className={buttonClassName}>
                        <RightIcon className={'rotate-180 transform'} />
                      </IconButton>
                    </Tooltip>
                    <span className={'text-text-secondary'}>
                      {index + 1}/{images.length}
                    </span>
                    <Tooltip title={t('gallery.next')}>
                      <IconButton size={'small'} onClick={handleToNext} className={buttonClassName}>
                        <RightIcon />
                      </IconButton>
                    </Tooltip>
                  </div>
                )}
                <div className={'flex w-fit items-center gap-2  rounded-[8px] bg-bg-mask p-2'}>
                  <Tooltip title={t('gallery.zoomOut')}>
                    <IconButton size={'small'} onClick={() => zoomOut()} className={buttonClassName}>
                      <MinusIcon />
                    </IconButton>
                  </Tooltip>
                  <span className={'min-w-[3.5em] text-center text-sm text-text-secondary'} data-testid='gallery-preview-zoom'>
                    {Math.round(scale * 100)}%
                  </span>
                  <Tooltip title={t('gallery.zoomIn')}>
                    <IconButton size={'small'} onClick={() => zoomIn()} className={buttonClassName}>
                      <AddIcon />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t('gallery.resetZoom')}>
                    <IconButton size={'small'} onClick={resetView} className={buttonClassName}>
                      <ReloadIcon />
                    </IconButton>
                  </Tooltip>
                </div>
                <div className={'flex w-fit gap-2  rounded-[8px] bg-bg-mask p-2'}>
                  <Tooltip title={t('gallery.copy')}>
                    <IconButton size={'small'} className={buttonClassName} onClick={handleCopy}>
                      <LinkIcon />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t('button.download')}>
                    <IconButton size={'small'} className={buttonClassName} onClick={handleDownload}>
                      <DownloadIcon />
                    </IconButton>
                  </Tooltip>
                </div>
                <Tooltip title={t('button.close')}>
                  <IconButton
                    size={'small'}
                    onClick={onClose}
                    className={'rounded-[8px] bg-bg-mask px-3.5 text-white hover:text-text-action'}
                  >
                    <CloseIcon />
                  </IconButton>
                </Tooltip>
              </div>
              {!ready && (
                <div className={'pointer-events-none absolute inset-0 flex items-center justify-center'}>
                  <CircularProgress size={32} sx={{ color: 'white' }} />
                </div>
              )}
              <TransformComponent
                contentProps={{
                  onClick: handleBackdropClick,
                }}
                wrapperStyle={{ width: '100%', height: '100%' }}
                // The content box fills the viewport so the image centres inside
                // it at any time and the pan bounds match what is on screen.
                contentStyle={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                {authenticatedSrc ? (
                  <img
                    key={authenticatedSrc}
                    src={authenticatedSrc}
                    alt={images[index]?.src ?? ''}
                    draggable={false}
                    data-testid='gallery-preview-image'
                    onLoad={() => setLoadedSrc(authenticatedSrc)}
                    style={{
                      // Fit the whole picture on screen at scale 1 without ever
                      // enlarging a small image past its own size.
                      maxWidth: 'calc(100vw - 32px)',
                      maxHeight: VIEWPORT_INSET,
                      width: 'auto',
                      height: 'auto',
                      objectFit: 'contain',
                      visibility: ready ? 'visible' : 'hidden',
                    }}
                  />
                ) : null}
              </TransformComponent>
            </React.Fragment>
          )}
        </TransformWrapper>
      </div>
    </Portal>
  );
}

export default memo(GalleryPreview);
