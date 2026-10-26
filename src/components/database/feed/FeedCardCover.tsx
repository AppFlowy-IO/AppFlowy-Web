import { RefObject, useRef, useState } from 'react';

import type { RowMeta } from '@/application/database-yjs';
import { useAuthenticatedImage } from '@/components/_shared/hooks/useAuthenticatedImage';
import { getPageCover } from '@/components/database/gallery/GalleryPreview';

import { FEED_COVER_HEIGHT } from './feed.constants';

function FeedCoverImage({
  rowId,
  src,
  boxRef,
}: {
  rowId: string;
  src: string;
  boxRef: RefObject<HTMLElement | null>;
}) {
  // The strip sizes the cover (card width × 160 px), so decode to it rather than at full resolution.
  const authenticatedSrc = useAuthenticatedImage(src, { fit: 'cover', boxRef });
  const [failed, setFailed] = useState(false);

  if (!authenticatedSrc || failed) return null;

  return (
    <img
      alt=''
      className='h-full w-full object-cover'
      data-testid={`feed-card-cover-image-${rowId}`}
      draggable={false}
      onError={() => setFailed(true)}
      src={authenticatedSrc}
    />
  );
}

/** Desktop `FeedCard._buildCover`: a 160px strip above the card body; the card's 16px corners clip it. */
export function FeedCardCover({ cover, rowId }: { cover: RowMeta['cover']; rowId: string }) {
  const value = getPageCover(cover);
  const boxRef = useRef<HTMLDivElement>(null);

  if (!value.src && !value.background) return null;

  return (
    <div
      ref={boxRef}
      className='w-full shrink-0 overflow-hidden'
      data-testid={`feed-card-cover-${rowId}`}
      style={{ background: value.background, height: FEED_COVER_HEIGHT }}
    >
      {value.src ? <FeedCoverImage key={value.src} rowId={rowId} src={value.src} boxRef={boxRef} /> : null}
    </div>
  );
}

export default FeedCardCover;
