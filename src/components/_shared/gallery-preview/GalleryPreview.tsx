import { IconButton, Portal, Tooltip } from '@mui/material';
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
import { notify } from '@/components/_shared/notify';
import { copyTextToClipboard } from '@/utils/copy';
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

function GalleryPreview({ images, open, onClose, previewIndex, workspaceId, viewId }: GalleryPreviewProps) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(previewIndex);
  const transformComponentRef = useRef<ReactZoomPanPinchContentRef>(null);

  const handleToPrev = useCallback(() => {
    setIndex((prev) => (prev === 0 ? images.length - 1 : prev - 1));
    transformComponentRef.current?.resetTransform();
  }, [images.length]);

  const handleToNext = useCallback(() => {
    setIndex((prev) => (prev === images.length - 1 ? 0 : prev + 1));
    transformComponentRef.current?.resetTransform();
  }, [images.length]);

  const handleCopy = useCallback(async () => {
    const image = images[index];

    if (!image) {
      return;
    }

    await copyTextToClipboard(image.src);
    notify.success(t('publish.copy.imageBlock'));
  }, [images, index, t]);

  const handleDownload = useCallback(() => {
    const image = images[index];

    if (!image) {
      return;
    }

    window.open(image.src, '_blank');
  }, [images, index]);

  const handleKeydown = useCallback(
    (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      switch (true) {
        case e.key === 'ArrowLeft':
        case e.key === 'ArrowUp':
          handleToPrev();
          break;
        case e.key === 'ArrowRight':
        case e.key === 'ArrowDown':
          handleToNext();
          break;
        case e.key === 'Escape':
          onClose();
          break;
      }
    },
    [handleToNext, handleToPrev, onClose]
  );

  useEffect(() => {
    (document.activeElement as HTMLElement)?.blur();
    window.addEventListener('keydown', handleKeydown);

    return () => {
      window.removeEventListener('keydown', handleKeydown);
    };
  }, [handleKeydown]);

  const imageUrl = useMemo(() => {
    return resolveFileUrl(images[index].src, workspaceId, viewId);
  }, [images, index, workspaceId, viewId]);

  if (!open) {
    return null;
  }

  return (
    <Portal>
      <div
        className={'fixed inset-0 z-[1400] bg-black bg-opacity-80'}
        onClick={(e) => {
          e.stopPropagation();
          onClose?.();
        }}
      >
        <TransformWrapper
          ref={transformComponentRef}
          initialScale={1}
          maxScale={1.5}
          minScale={0.5}
          limitToBounds={false}
        >
          {({ zoomIn, zoomOut, resetTransform }) => (
            <React.Fragment>
              <div
                className='absolute bottom-20 left-1/2 z-10 flex -translate-x-1/2 transform gap-4 p-4'
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
                  <Tooltip title={t('gallery.zoomIn')}>
                    <IconButton size={'small'} onClick={() => zoomIn()} className={buttonClassName}>
                      <AddIcon />
                    </IconButton>
                  </Tooltip>
                  {/*<Button color={'inherit'} size={'small'}>*/}
                  {/*  {scale * 100}%*/}
                  {/*</Button>*/}
                  <Tooltip title={t('gallery.zoomOut')}>
                    <IconButton size={'small'} onClick={() => zoomOut()} className={buttonClassName}>
                      <MinusIcon />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t('gallery.resetZoom')}>
                    <IconButton size={'small'} onClick={() => resetTransform()} className={buttonClassName}>
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
              <TransformComponent
                contentProps={{
                  onClick: (e) => e.stopPropagation(),
                }}
                wrapperStyle={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <img
                  src={imageUrl}
                  alt={images[index].src}
                  style={{
                    maxWidth: '100%',
                    maxHeight: '100%',
                    objectFit: 'contain',
                  }}
                />
              </TransformComponent>
            </React.Fragment>
          )}
        </TransformWrapper>
      </div>
    </Portal>
  );
}

export default memo(GalleryPreview);
