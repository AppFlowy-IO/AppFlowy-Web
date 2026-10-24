import { RefObject, useEffect, useMemo, useRef, useState } from 'react';

import { getImageUrl, revokeBlobUrl } from '@/utils/authenticated-image';
import { subscribeToDevicePixelRatio } from '@/utils/device-pixel-ratio';
import { DecodeBox, DisplayFit, decodeBoxKey, displayDecodeBox } from '@/utils/display-size-image';
import { acquireDisplaySizeImage, DisplaySizeImageHandle } from '@/utils/display-size-image-cache';
import { isAppFlowyAuthenticatedFileUrl, isAppFlowyPublicFormUploadUrl } from '@/utils/file-storage-url';
import { Log } from '@/utils/log';

export interface DecodeAtDisplaySizeOptions {
  /**
   * The CSS `object-fit` of the `<img>`: `cover` decodes to the side that
   * fills the box, `contain` to the side that fits it.
   */
  fit: DisplayFit;
  /**
   * The element whose laid-out box bounds the image: the `<img>` itself when
   * CSS fixes its size, otherwise the container that sizes it. Its border box
   * is measured and watched with a ResizeObserver; a side the layout leaves at
   * 0 counts as unbounded, so nothing above it may size itself from the image.
   * Null asks for the original at full size through the same caches; see
   * `useAuthenticatedOriginalImage`.
   */
  boxRef: RefObject<HTMLElement | null> | null;
}

const ORIGINAL_SIZE: DecodeAtDisplaySizeOptions = { fit: 'contain', boxRef: null };

/**
 * Hook to handle authenticated image loading for AppFlowy file storage URLs
 * Returns the authenticated blob URL or the original URL if authentication is not needed
 *
 * With `decodeAtDisplaySize`, an AppFlowy file storage image is instead fetched,
 * decoded at the size of the measured box times the device pixel ratio
 * (rounded up to a size bucket) and shared with every other image showing the
 * same file at the same bucket. Until it is ready the hook returns '' rather
 * than the protected URL, so the browser never requests it without a token.
 * Other URLs (external, blob:, data:) load as they do without the option.
 *
 * @param src - The image source URL
 * @returns The authenticated image URL (blob URL) or original URL
 */
export function useAuthenticatedImage(src: string | undefined, decodeAtDisplaySize?: DecodeAtDisplaySizeOptions): string {
  const fit = decodeAtDisplaySize?.fit;
  const boxRef = decodeAtDisplaySize?.boxRef;
  const displaySized = useMemo(
    () => Boolean(fit && boxRef !== undefined && src && isAppFlowyAuthenticatedFileUrl(src)),
    [boxRef, fit, src]
  );
  const fullSizeSrc = useFullSizeImage(displaySized ? undefined : src);
  const displaySizeSrc = useDisplaySizeImage(displaySized ? src : undefined, fit ?? 'cover', boxRef);

  return displaySized ? displaySizeSrc : fullSizeSrc;
}

/**
 * The original of an AppFlowy file storage image at full size, for the image
 * viewer and other surfaces that must not downscale. It goes through the same
 * in-page and on-disk caches as the thumbnails, so a file seen before opens
 * without a download, and returns '' until it is ready. Other URLs load as
 * with `useAuthenticatedImage`.
 */
export function useAuthenticatedOriginalImage(src: string | undefined): string {
  return useAuthenticatedImage(src, ORIGINAL_SIZE);
}

function useFullSizeImage(src: string | undefined): string {
  const [authenticatedSrc, setAuthenticatedSrc] = useState<string>('');
  const blobUrlRef = useRef<string>('');

  useEffect(() => {
    if (!src) {
      setAuthenticatedSrc('');
      return;
    }

    let isMounted = true;

    Log.debug('[useAuthenticatedImage] src', isAppFlowyPublicFormUploadUrl(src) ? '[public-form-attachment]' : src);
    getImageUrl(src)
      .then((url) => {
        if (isMounted) {
          setAuthenticatedSrc(url);
          blobUrlRef.current = url;
        }
      })
      .catch((error) => {
        console.error('Failed to load authenticated image:', error);
        if (isMounted) {
          setAuthenticatedSrc('');
        }
      });

    return () => {
      isMounted = false;
      // Clean up blob URL if it was created
      if (blobUrlRef.current && blobUrlRef.current.startsWith('blob:')) {
        revokeBlobUrl(blobUrlRef.current);
        blobUrlRef.current = '';
      }
    };
  }, [src]);

  // Accepted form attachments are never anonymously readable. Keep their
  // protected route out of `<img src>` while the bearer fetch is pending (or
  // when no session exists), otherwise the browser emits a guaranteed 401.
  if (src && isAppFlowyPublicFormUploadUrl(src)) return authenticatedSrc;

  return authenticatedSrc || src || '';
}

function measureDecodeBox(element: HTMLElement | null): DecodeBox {
  if (!element) return { width: null, height: null };

  // The border box in CSS pixels, unaffected by transforms such as a card's
  // hover animation, so a hover never crosses a bucket.
  return displayDecodeBox(element.offsetWidth, element.offsetHeight, window.devicePixelRatio);
}

function useDisplaySizeImage(
  src: string | undefined,
  fit: DisplayFit,
  boxRef: RefObject<HTMLElement | null> | null | undefined
): string {
  const [resolved, setResolved] = useState<{ src: string; url: string }>({ src: '', url: '' });

  useEffect(() => {
    if (!src || boxRef === undefined) return;

    let disposed = false;
    let currentKey = '';
    let pending: DisplaySizeImageHandle | null = null;
    let displayed: DisplaySizeImageHandle | null = null;
    let fallbackUrl = '';

    const show = (url: string, handle: DisplaySizeImageHandle | null) => {
      displayed?.release();
      displayed = handle;
      revokeBlobUrl(fallbackUrl);
      fallbackUrl = handle ? '' : url;
      // A retained entry can resolve to the URL already shown; skip the render.
      setResolved((current) => (current.src === src && current.url === url ? current : { src, url }));
    };

    const apply = () => {
      if (disposed) return;

      // A null ref keeps the box unbounded: the original at full size.
      const box = measureDecodeBox(boxRef?.current ?? null);
      const key = decodeBoxKey(box, fit);

      if (key === currentKey) return;
      currentKey = key;

      pending?.release();
      const handle = acquireDisplaySizeImage(src, box, fit);

      pending = handle;
      void handle.url.then(async (url) => {
        // Superseded by a later box, or unmounted: `apply` or the cleanup released it.
        if (disposed || pending !== handle) return;
        pending = null;

        if (url) {
          // The previous image stays until this one is ready, then swaps.
          show(url, handle);
          return;
        }

        // Not fetchable here (no session for a member-only file, 403, …):
        // behave exactly as the full-size path does.
        handle.release();
        const fallback = await getImageUrl(src);

        if (disposed) {
          revokeBlobUrl(fallback);
          return;
        }

        show(fallback, null);
      });
    };

    apply();

    const element = boxRef?.current ?? null;
    const observer = element && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => apply()) : null;

    observer?.observe(element as HTMLElement);
    // Browser zoom changes the device pixel ratio without resizing a fixed-size
    // box; one shared watcher serves every image. The original needs neither.
    const unsubscribeRatio = boxRef ? subscribeToDevicePixelRatio(apply) : () => undefined;

    return () => {
      disposed = true;
      observer?.disconnect();
      unsubscribeRatio();
      pending?.release();
      displayed?.release();
      revokeBlobUrl(fallbackUrl);
    };
  }, [src, fit, boxRef]);

  if (!src) return '';

  return resolved.src === src ? resolved.url : '';
}
