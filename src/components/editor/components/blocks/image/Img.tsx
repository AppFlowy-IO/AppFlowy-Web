import React from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as ErrorOutline } from '@/assets/icons/error.svg';
import LoadingDots from '@/components/_shared/LoadingDots';
import { isAppFlowyFileStorageUrl } from '@/utils/file-storage-url';

import { useImageWithRetry } from './useImageWithRetry';

const GENERIC_ALT = 'Image';

interface ImgProps {
  url: string;
  imgRef?: React.RefObject<HTMLImageElement>;
  onLoad?: () => void;
  width: number | string;
  /**
   * Accessible label for the image. Should describe the content; pass an
   * empty string only for purely decorative images. When omitted, falls
   * back to a derived label from the URL filename, then a generic string.
   */
  alt?: string;
}

/**
 * Derive a human-ish alt label from a URL when none was provided.
 *
 * For AppFlowy storage URLs the trailing path segment is an opaque hash
 * (file_id) — reading "bGTk 4nxVz" aloud is no better than empty alt, so
 * we just use the generic label. For external URLs the trailing filename
 * is usually human-chosen and worth surfacing.
 *
 * Returns a non-empty string so screen readers always announce something
 * — callers must pass an explicit `alt=""` for genuinely decorative images.
 */
function fallbackAltFromUrl(url: string): string {
  if (!url) return GENERIC_ALT;
  if (isAppFlowyFileStorageUrl(url)) return GENERIC_ALT;

  try {
    const parsed = new URL(url, 'http://_');
    const segment = parsed.pathname.split('/').filter(Boolean).pop() ?? '';
    const decoded = decodeURIComponent(segment);
    const withoutExt = decoded.replace(/\.[a-z0-9]+$/i, '');
    const cleaned = withoutExt.replace(/[-_]+/g, ' ').trim();

    // Reject runs of hex/base64-ish hash output even from non-AppFlowy URLs.
    // A reasonable heuristic: needs at least one vowel and 3+ chars to be
    // worth reading aloud. Otherwise fall back to the generic label.
    const looksLikeWord = cleaned.length >= 3 && /[aeiou]/i.test(cleaned);

    return looksLikeWord ? cleaned : GENERIC_ALT;
  } catch {
    return GENERIC_ALT;
  }
}

function Img({ onLoad, imgRef, url, width, alt }: ImgProps) {
  const { t } = useTranslation();
  const { src, phase, isImageReady, lastError, retry, onImageLoaded, onImageError } =
    useImageWithRetry(url, onLoad);

  const showLoading = phase === 'loading' && !isImageReady;
  const showPending = phase === 'pending';
  const showFailed = phase === 'failed';

  const resolvedAlt = alt ?? fallbackAltFromUrl(url);

  return (
    <>
      <img
        ref={imgRef}
        src={src}
        alt={resolvedAlt}
        onLoad={onImageLoaded}
        onError={onImageError}
        loading={'lazy'}
        decoding={'async'}
        draggable={false}
        style={{
          visibility: isImageReady ? 'visible' : 'hidden',
          width,
        }}
        className={'h-full bg-cover bg-center object-cover'}
      />
      {showLoading && (
        <div
          role={'status'}
          aria-live={'polite'}
          aria-label={t('editor.imageLoading', 'Loading image')}
          className={
            'absolute inset-0 flex h-full w-full items-center justify-center bg-background-primary'
          }
        >
          <LoadingDots />
        </div>
      )}
      {showPending && (
        <div
          role={'status'}
          aria-live={'polite'}
          className={
            'absolute inset-0 flex h-full w-full items-center justify-center gap-2 bg-background-primary text-text-caption'
          }
        >
          <LoadingDots />
          <div>{t('editor.imageStillUploading', 'Waiting for upload to finish…')}</div>
        </div>
      )}
      {showFailed && (
        <button
          type={'button'}
          onClick={retry}
          aria-label={
            lastError?.errorKind === 'forbidden'
              ? t('editor.imageNoAccess', 'You do not have access to this image')
              : t('editor.imageLoadFailedRetry', 'Image load failed. Retry.')
          }
          className={
            'flex h-[48px] w-full items-center justify-center gap-2 rounded border border-function-error bg-red-50 hover:bg-red-100'
          }
        >
          <ErrorOutline className={'text-function-error'} aria-hidden={'true'} />
          <div className={'text-function-error'}>
            {lastError?.errorKind === 'forbidden'
              ? t('editor.imageNoAccess', 'You do not have access to this image')
              : t('editor.imageLoadFailed')}
          </div>
          <span className={'text-text-action underline'}>{t('button.retry', 'Retry')}</span>
        </button>
      )}
    </>
  );
}

export default Img;
