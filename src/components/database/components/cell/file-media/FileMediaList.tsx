import { useCallback, useMemo, useState } from 'react';

import { useReadOnly } from '@/application/database-yjs';
import {
  FileMediaCell as CellType,
  FileMediaCellData,
  FileMediaCellDataItem, FileMediaType,
} from '@/application/database-yjs/cell.type';
import { useUpdateCellDispatch } from '@/application/database-yjs/dispatch';
import { deleteFile, parseToFilesMediaCellData, updateFileName } from '@/application/database-yjs/fields/media/parse';
import { ReactComponent as DragIcon } from '@/assets/icons/drag.svg';
import FileMediaItem from '@/components/database/components/cell/file-media/FileMediaItem';
import DragItem from '@/components/database/components/drag-and-drop/DragItem';
import { DragContext, useDragContextValue } from '@/components/database/components/drag-and-drop/useDragContext';
import { dropdownMenuItemVariants } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

function FileMediaListItem({
  file,
  images,
  rowId,
  onUpdateName,
  onDelete,
  onPreview,
}: {
  file: FileMediaCellDataItem;
  images: FileMediaCellDataItem[];
  rowId: string;
  onUpdateName: (file: FileMediaCellDataItem, name: string) => void;
  onDelete: (fileId: string) => void;
  onPreview: (index: number) => void;
}) {
  const handleUpdateName = useCallback((name: string) => {
    onUpdateName(file, name);
  }, [file, onUpdateName]);

  const handleDelete = useCallback(() => {
    onDelete(file.id);
  }, [file.id, onDelete]);

  const handlePreview = useCallback(() => {
    const index = images.findIndex(item => item.id === file.id);

    if (index === -1) return;
    onPreview(index);
  }, [file.id, images, onPreview]);

  return (
    <FileMediaItem
      onUpdateName={handleUpdateName}
      onDelete={handleDelete}
      onPreview={handlePreview}
      file={file}
      rowId={rowId}
    />
  );
}

function FileMediaList ({
  cell,
  fieldId,
  rowId,
  onPreview,
}: {
  cell?: CellType;
  fieldId: string;
  rowId: string;
  onPreview: (index: number) => void;
}) {
  const readOnly = useReadOnly();
  const data = useMemo(() => cell?.data?.filter((item => item !== null)) || [], [cell?.data]);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const updateCell = useUpdateCellDispatch(rowId, fieldId);

  const reorderAction = useCallback(({
    newData,
  }: {
    newData: FileMediaCellData
  }) => {
    const newItems = parseToFilesMediaCellData(newData);

    updateCell(newItems);
  }, [updateCell]);
  const contextValue = useDragContextValue({
    enabled: !readOnly,
    data,
    container,
    reorderAction,
  });

  const onUpdateName = useCallback((file: FileMediaCellDataItem, name: string) => {
    const newData = updateFileName({
      data: cell?.data,
      fileId: file.id,
      newName: name,
    });

    updateCell(newData);
  }, [cell?.data, updateCell]);

  const onDelete = useCallback((fileId: string) => {
    const newData = deleteFile({
      data: cell?.data,
      fileId,
    });

    updateCell(newData);
  }, [cell?.data, updateCell]);

  const images = useMemo(() => {
    return data.filter(item => item.file_type === FileMediaType.Image && item.url);
  }, [data]);

  return (
    <div
      ref={setContainer}
      className={'flex flex-col gap-1 p-2 w-full overflow-hidden'}
    >
      <DragContext.Provider value={contextValue}>
        {data.map((file) => {
          return (
            <div
              key={file.id}
              className={cn(dropdownMenuItemVariants({ variant: 'default' }), 'w-full overflow-hidden h-fit')}
            >
              <DragItem

                id={file.id}
                className={'items-start w-full overflow-hidden'}
                dragIcon={<div className={'w-6 h-6 flex items-center justify-center'}>
                  <DragIcon className={'w-5 h-5 text-text-secondary'} />
                </div>}
              >
                <FileMediaListItem
                  file={file}
                  images={images}
                  rowId={rowId}
                  onUpdateName={onUpdateName}
                  onDelete={onDelete}
                  onPreview={onPreview}
                />
              </DragItem>
            </div>
          );
        })}
      </DragContext.Provider>

    </div>
  );
}

export default FileMediaList;