import { useMemo, useRef } from 'react';

import { FileMediaCellDataItem, FileMediaType } from '@/application/database-yjs/cell.type';
import { useAuthenticatedImage } from '@/components/_shared/hooks/useAuthenticatedImage';
import FileIcon from '@/components/database/components/cell/file-media/FileIcon';
import FileMediaMore from '@/components/database/components/cell/file-media/FileMediaMore';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

function FileMediaItem({
  file,
  onPreview,
  rowId,
  onUpdateName,
  onDelete,
}: {
  file: FileMediaCellDataItem;
  onPreview: () => void;
  rowId: string;
  onUpdateName: (name: string) => void;
  onDelete: () => void;
}) {
  const isImage = file.file_type === FileMediaType.Image;
  const imageRef = useRef<HTMLImageElement>(null);
  // The <img> fixes its own box (72 px tall), so it is measured directly.
  const authenticatedUrl = useAuthenticatedImage(isImage ? file.url : undefined, { fit: 'cover', boxRef: imageRef });

  const renderItem = useMemo(() => {
    switch (file.file_type) {
      case FileMediaType.Image:
        return (
          <img
            ref={imageRef}
            onClick={onPreview}
            src={authenticatedUrl || undefined}
            alt={file.name}
            className={
              'aspect-square h-[72px] flex-1 cursor-zoom-in overflow-hidden rounded-[4px] border border-border-primary object-cover'
            }
          />
        );
      default:
        return (
          <div className={'flex h-full flex-1 items-center gap-1 overflow-hidden text-sm  text-text-primary'}>
            <FileIcon fileType={file.file_type} />
            <Tooltip delayDuration={1000} disableHoverableContent>
              <TooltipTrigger asChild>
                <div className={'flex-1 truncate'}>{file.name || file.url}</div>
              </TooltipTrigger>
              <TooltipContent side={'bottom'}>{file.name || file.url}</TooltipContent>
            </Tooltip>
          </div>
        );
    }
  }, [onPreview, file, authenticatedUrl]);

  return (
    <div
      className={cn(
        'relative flex w-full justify-between gap-2 overflow-hidden',
        file.file_type === FileMediaType.Image ? 'items-start' : 'items-center'
      )}
    >
      {renderItem}

      <FileMediaMore file={file} rowId={rowId} onPreview={onPreview} onDelete={onDelete} onUpdateName={onUpdateName} />
    </div>
  );
}

export default FileMediaItem;
