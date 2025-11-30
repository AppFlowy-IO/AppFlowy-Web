import React, { Suspense, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useDatabaseContext, useFieldSelector } from '@/application/database-yjs';
import {
  CellProps,
  FileMediaCell as FileMediaCellType, FileMediaCellData, FileMediaCellDataItem,
  FileMediaType,
} from '@/application/database-yjs/cell.type';
import { useUpdateCellDispatch } from '@/application/database-yjs/dispatch';
import {
  deleteFile,
  parseFileMediaTypeOptions,
  parseToFilesMediaCellData,
  updateFileName,
} from '@/application/database-yjs/fields/media/parse';
import { ReactComponent as AddIcon } from '@/assets/icons/plus.svg';
import { GalleryPreview } from '@/components/_shared/gallery-preview';
import FileMediaCellMenu from '@/components/database/components/cell/file-media/FileMediaCellMenu';
import FileMediaGrid from '@/components/database/components/database-row/file-media/FileMediaGrid';
import FileMediaItem from '@/components/database/components/database-row/file-media/FileMediaItem';
import { cn } from '@/lib/utils';

export function FileMediaCell ({
  cell,
  style,
  fieldId,
  rowId,
  readOnly,
}: CellProps<FileMediaCellType>) {
  const value = cell?.data;
  const { t } = useTranslation();
  const { field, clock } = useFieldSelector(fieldId);
  const { workspaceId, databasePageId } = useDatabaseContext();
  const typeOption = useMemo(() => {
    if (!field) return null;
    return parseFileMediaTypeOptions(field);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field, clock]);
  const showFileNames = typeOption?.hide_file_names !== true;
  const [editing, setEditing] = React.useState(false);
  const [openPreview, setOpenPreview] = React.useState(false);
  const previewIndexRef = React.useRef(0);
  const photos = useMemo(() => {
    return value?.filter(item => {
      return item.file_type === FileMediaType.Image && item.url;
    }).map(image => {
      return {
        src: image.url,
      };
    }) || [];
  }, [value]);

  const images = useMemo(() => {
    return value?.filter(item => item.file_type === FileMediaType.Image && item.url) || [];
  }, [value]);

  const handlePreview = useCallback((index: number) => {
    previewIndexRef.current = index;
    setOpenPreview(true);
  }, []);

  const updateCell = useUpdateCellDispatch(rowId, fieldId);

  const reorderAction = useCallback(({
    newData,
  }: {
    newData: FileMediaCellData
  }) => {
    const newItems = parseToFilesMediaCellData(newData);

    updateCell(newItems);
  }, [updateCell]);

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

  const renderChildren = useMemo(() => {
    const length = value?.length || 0;

    if (!value || length === 0) {
      return null;
    }

    return <FileMediaGrid
      items={value}
      reorderAction={reorderAction}
      itemHeight={showFileNames ? 98 : 70}
      renderItem={(file) => {
        return <FileMediaItem
          rowId={rowId}
          onDelete={() => {
            onDelete(file.id);
          }}
          onUpdateName={(name) => {
            onUpdateName(file, name);
          }}
          showFileNames={showFileNames}
          file={file}
          onPreview={() => {
            const index = images.findIndex(item => item.id === file.id);

            if (index === -1) {
              return;
            }

            handlePreview(index);
          }}
        />;
      }}
    />;
  }, [value, reorderAction, showFileNames, rowId, onDelete, onUpdateName, images, handlePreview]);
  const mouseDownStartTimeRef = useRef<number | null>(null);

  return (
    <div
      draggable={false}
      onMouseDown={() => {
        mouseDownStartTimeRef.current = Date.now();
      }}
      onClick={e => {
        if (readOnly) return;
        e.stopPropagation();
        const mouseDownStartTime = mouseDownStartTimeRef.current;

        mouseDownStartTimeRef.current = null;
        if (mouseDownStartTime && Date.now() - mouseDownStartTime < 200) {
          setEditing(true);
        }
      }}
      className={'h-full w-full'}
    >
      {value && value.length > 0 && <div
        style={style}
        className={cn('flex pb-2 w-full items-center gap-1.5 flex-wrap', 'cursor-pointer')}
      >
        {renderChildren}
      </div>}

      {!readOnly ? <div className={cn('flex text-text-secondary items-center gap-1.5')}>
        <AddIcon className={'w-5 h-5'} />
        {t('grid.media.addFileOrMedia')}
      </div> : null}

      {editing && <FileMediaCellMenu
        open={editing}
        onOpenChange={setEditing}
        fieldId={fieldId}
        cell={cell}
        rowId={rowId}
        onPreview={handlePreview}
        showUpload={true}
      />}
      {openPreview && <Suspense><GalleryPreview
        workspaceId={workspaceId}
        viewId={databasePageId}
        images={photos}
        previewIndex={previewIndexRef.current}
        open={openPreview}
        onClose={() => {
          setOpenPreview(false);
        }}
      /></Suspense>}
    </div>
  );
}

export default FileMediaCell;