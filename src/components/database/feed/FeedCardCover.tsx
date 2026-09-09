import { useState } from 'react';

import type { RowMeta } from '@/application/database-yjs';
import { useAuthenticatedImage } from '@/components/_shared/hooks/useAuthenticatedImage';
import { getPageCover } from '@/components/database/gallery/GalleryPreview';
import { cn } from '@/lib/utils';

import { FEED_COVER_HEIGHT } from './feed.constants';

function FeedCoverImage({ rowId, src }: { rowId: string; src: string }) {
  const authenticatedSrc = useAuthenticatedImage(src);
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

/** Desktop `FeedCard._buildCover`: a 160px strip above the card body when the row has a cover. */
export function FeedCardCover({ cover, rowId }: { cover: RowMeta['cover']; rowId: string }) {
  const value = getPageCover(cover);

  if (!value.src && !value.background) return null;

  return (
    <div
      className={cn('w-full shrink-0 overflow-hidden rounded-t-lg')}
      data-testid={`feed-card-cover-${rowId}`}
      style={{ background: value.background, height: FEED_COVER_HEIGHT }}
    >
      {value.src ? <FeedCoverImage key={value.src} rowId={rowId} src={value.src} /> : null}
    </div>
  );
}

export default FeedCardCover;
