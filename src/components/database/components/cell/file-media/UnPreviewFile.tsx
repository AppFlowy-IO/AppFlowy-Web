
import { useDatabaseContext } from '@/application/database-yjs';
import { FileMediaCellDataItem } from '@/application/database-yjs/cell.type';
import FileIcon from '@/components/database/components/cell/file-media/FileIcon';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { resolveFileUrl } from '@/utils/file-storage-url';
import { openUrl } from '@/utils/url';

function UnPreviewFile({ file }: { file: FileMediaCellDataItem }) {
  const { workspaceId, databasePageId } = useDatabaseContext();

  return (
    <Tooltip delayDuration={500} disableHoverableContent>
      <TooltipTrigger asChild>
        <Button
          size={'icon'}
          variant={'ghost'}
          className={'cursor-pointer rounded-[4px] bg-fill-content-hover text-icon-secondary'}
          onClick={(e) => {
            e.stopPropagation();
            const newUrl = resolveFileUrl(file.url, workspaceId, databasePageId);

            if (newUrl) {
              void openUrl(newUrl, '_blank');
            }
          }}
        >
          <FileIcon fileType={file.file_type} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side={'bottom'}>
        <div className={'flex gap-1.5'}>
          <span className={'h-5 w-5 min-w-5'}>
            <FileIcon fileType={file.file_type} />
          </span>

          {file.name}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export default UnPreviewFile;
