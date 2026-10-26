import { useMemo, useRef } from 'react';

import { useDatabaseContextOptional } from '@/application/database-yjs';
import { FileMediaCellDataItem } from '@/application/database-yjs/cell.type';
import { useAuthenticatedImage } from '@/components/_shared/hooks/useAuthenticatedImage';
import { isAppFlowyAuthenticatedFileUrl, resolveFileUrl } from '@/utils/file-storage-url';

function PreviewImage({ file, onClick }: { file: FileMediaCellDataItem; onClick: () => void }) {
  const context = useDatabaseContextOptional();
  const workspaceId = context?.workspaceId;
  const databasePageId = context?.databasePageId;
  const imageRef = useRef<HTMLImageElement>(null);

  const thumb = useMemo(() => {
    if (!workspaceId || !databasePageId) return '';

    const fileUrl = resolveFileUrl(file.url, workspaceId, databasePageId);

    if (!fileUrl) return '';

    // AppFlowy storage ignores resize hints and the image is decoded at its
    // display size below. Hosts such as Unsplash honor these imgix-style hints.
    if (isAppFlowyAuthenticatedFileUrl(fileUrl)) return fileUrl;

    const url = new URL(fileUrl);

    url.searchParams.set('auto', 'format');
    url.searchParams.set('fit', 'crop');

    return url.toString() + '&w=240&q=80';
  }, [file.url, workspaceId, databasePageId]);

  const authenticatedThumb = useAuthenticatedImage(thumb, { fit: 'cover', boxRef: imageRef });

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={'cursor-zoom-in'}
    >
      <img
        ref={imageRef}
        src={authenticatedThumb || undefined}
        alt={file.name}
        className={
          'aspect-square h-[28px] w-[28px] min-w-[28px] overflow-hidden rounded-[4px] border border-border-primary object-cover'
        }
      />
    </div>
  );
}

export default PreviewImage;
