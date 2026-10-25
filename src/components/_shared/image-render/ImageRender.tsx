import { Skeleton } from '@mui/material';
import React, { RefObject, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as ErrorOutline } from '@/assets/icons/error.svg';
import { useAuthenticatedImage } from '@/components/_shared/hooks/useAuthenticatedImage';
import { DisplayFit } from '@/utils/display-size-image';

interface ImageRenderProps extends React.HTMLAttributes<HTMLImageElement> {
  src: string;
  alt?: string;
  /**
   * Decode an AppFlowy file storage image at the size of the parent element's
   * box instead of at full resolution; the value is the `<img>`'s object-fit.
   * The parent must size the box itself (a fixed height, a column width), as
   * the image's own size is not known until it is decoded.
   */
  decodeAtDisplaySize?: DisplayFit;
}

export function ImageRender({ src, style, decodeAtDisplaySize, ...props }: ImageRenderProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  // The <img> is 0×1 px while it loads, so its parent is the box it will fill.
  const parentRef = useMemo<RefObject<HTMLElement | null>>(
    () => ({
      get current() {
        return imageRef.current?.parentElement ?? null;
      },
    }),
    []
  );
  const authenticatedSrc = useAuthenticatedImage(
    src,
    decodeAtDisplaySize ? { fit: decodeAtDisplaySize, boxRef: parentRef } : undefined
  );
  const baseStyle: React.CSSProperties = {
    display: hasError ? 'none' : 'block',
    height: loading ? 0 : '100%',
    width: loading ? 1 : '100%',
  };
  const mergedStyle = {
    ...baseStyle,
    ...style,
  };

  return (
    <>
      {hasError ? (
        <div className={'flex h-full w-full items-center justify-center gap-2 bg-red-50'}>
          <ErrorOutline className={'text-function-error'} />
          <div className={'text-function-error'}>{t('editor.imageLoadFailed')}</div>
        </div>
      ) : loading ? (
        <Skeleton variant='rectangular' width={'100%'} height={'100%'} />
      ) : null}
      <img
        ref={imageRef}
        style={mergedStyle}
        draggable={false}
        // An empty src fires `error` in browsers; while the authenticated URL
        // is pending the image has no source yet.
        src={authenticatedSrc || undefined}
        {...props}
        onLoad={(e) => {
          props.onLoad?.(e);
          setLoading(false);
          setHasError(false);
        }}
        onError={(e) => {
          props.onError?.(e);
          setHasError(true);
          setLoading(false);
        }}
      />
    </>
  );
}

export default ImageRender;
