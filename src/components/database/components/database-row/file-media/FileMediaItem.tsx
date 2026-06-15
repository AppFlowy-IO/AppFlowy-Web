import { useMemo, useRef, useState } from 'react';

import { useDatabaseContext, useReadOnly } from '@/application/database-yjs';
import { FileMediaCellDataItem, FileMediaType } from '@/application/database-yjs/cell.type';
import { useAuthenticatedImage } from '@/components/_shared/hooks/useAuthenticatedImage';
import FileIcon from '@/components/database/components/cell/file-media/FileIcon';
import FileMediaMore from '@/components/database/components/cell/file-media/FileMediaMore';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { resolveFileUrl } from '@/utils/file-storage-url';
import { openUrl } from '@/utils/url';

function FileMediaItem({
  file,
  onPreview,
  showFileNames,
  rowId,
  onUpdateName,
  onDelete,
}: {
  file: FileMediaCellDataItem;
  showFileNames: boolean;
  onPreview: () => void;
  rowId: string;
  onUpdateName: (name: string) => void;
  onDelete: () => void;
}) {
  const readOnly = useReadOnly();
  const { workspaceId, databasePageId } = useDatabaseContext();

  const isImage = file.file_type === FileMediaType.Image;
  const mouseDownStartTimeRef = useRef<number | null>(null);
  const color = useMemo(() => {
    switch (file.file_type) {
      case FileMediaType.Archive:
        return 'bg-tint-red';

      case FileMediaType.Link:
        return 'bg-tint-purple';
      case FileMediaType.Audio:
        return 'bg-tint-green';
      case FileMediaType.Video:
        return 'bg-tint-blue';
      case FileMediaType.Document:
      default:
        return 'bg-tint-yellow';
    }
  }, [file.file_type]);

  const fileUrl = useMemo(() => {
    return resolveFileUrl(file.url, workspaceId, databasePageId);
  }, [file.url, workspaceId, databasePageId]);

  const authenticatedFileUrl = useAuthenticatedImage(fileUrl);

  const [hover, setHover] = useState(false);

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        // Open the file in a new tab
        if (file.file_type !== FileMediaType.Image) {
          const newUrl = resolveFileUrl(file.url, workspaceId, databasePageId);

          if (newUrl) {
            void openUrl(newUrl, '_blank');
          }
        }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={'relative flex h-full w-full flex-col overflow-hidden rounded-[6px] border border-border-primary'}
    >
      <Tooltip delayDuration={500} disableHoverableContent>
        <TooltipTrigger asChild>
          <div>
            {isImage ? (
              <div
                onMouseDown={() => {
                  mouseDownStartTimeRef.current = Date.now();
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  const mouseDownStartTime = mouseDownStartTimeRef.current;

                  mouseDownStartTimeRef.current = null;
                  if (mouseDownStartTime && Date.now() - mouseDownStartTime < 200) {
                    onPreview();
                  }
                }}
                className={'h-[70px] cursor-zoom-in overflow-hidden'}
              >
                <img
                  draggable={false}
                  src={authenticatedFileUrl}
                  alt={file.name}
                  className={'aspect-square h-full w-full overflow-hidden object-cover'}
                />
              </div>
            ) : (
              <div className={cn('flex h-[70px] w-full items-center justify-center text-icon-secondary', color)}>
                <FileIcon fileType={file.file_type} />
              </div>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side={'bottom'}>{file.name || file.url}</TooltipContent>
      </Tooltip>
      {showFileNames && (
        <div className={'flex h-7 w-full items-center bg-surface-primary px-1.5 text-xs text-text-primary'}>
          <span className={' truncate'}>{file.name || file.url}</span>
        </div>
      )}
      {!readOnly && (
        <div
          onClick={(e) => {
            e.stopPropagation();
          }}
          onMouseDown={(e) => {
            e.stopPropagation();
          }}
          style={{
            opacity: hover ? 1 : 0,
          }}
          className={'absolute right-1 top-1'}
        >
          <FileMediaMore
            file={file}
            rowId={rowId}
            onPreview={onPreview}
            onUpdateName={onUpdateName}
            onDelete={onDelete}
          />
        </div>
      )}
    </div>
  );
}

export default FileMediaItem;
