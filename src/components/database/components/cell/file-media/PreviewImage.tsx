import { useMemo } from 'react';

import { useDatabaseContext } from '@/application/database-yjs';
import { FileMediaCellDataItem } from '@/application/database-yjs/cell.type';
import { useAuthenticatedImage } from '@/components/_shared/hooks/useAuthenticatedImage';
import { getFileUrl, isFileURL } from '@/utils/file-storage-url';

function PreviewImage({ file, onClick }: { file: FileMediaCellDataItem; onClick: () => void }) {
  const { workspaceId, databasePageId } = useDatabaseContext();

  const thumb = useMemo(() => {
    let fileUrl = file.url;

    if (!fileUrl) return '';
    if (!isFileURL(fileUrl)) {
      fileUrl = getFileUrl(workspaceId, databasePageId, file.url);
    }

    const url = new URL(fileUrl);

    url.searchParams.set('auto', 'format');
    url.searchParams.set('fit', 'crop');

    return url.toString() + '&w=240&q=80';
  }, [file.url, workspaceId, databasePageId]);

  const authenticatedThumb = useAuthenticatedImage(thumb);

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={'cursor-zoom-in'}
    >
      <img
        src={authenticatedThumb}
        alt={file.name}
        className={
          'aspect-square h-[28px] w-[28px] min-w-[28px] overflow-hidden rounded-[4px] border border-border-primary object-cover'
        }
      />
    </div>
  );
}

export default PreviewImage;
