import React, { Suspense, useCallback, useMemo } from 'react';

import { useDatabaseContext } from '@/application/database-yjs';
import {
  CellProps,
  FileMediaCell as FileMediaCellType,
  FileMediaCellDataItem,
  FileMediaType,
} from '@/application/database-yjs/cell.type';
import { GalleryPreview } from '@/components/_shared/gallery-preview';
import FileMediaCellMenu from '@/components/database/components/cell/file-media/FileMediaCellMenu';
import PreviewImage from '@/components/database/components/cell/file-media/PreviewImage';
import UnPreviewFile from '@/components/database/components/cell/file-media/UnPreviewFile';
import { cn } from '@/lib/utils';

export function FileMediaCell({
  cell,
  style,
  placeholder,
  editing,
  setEditing,
  wrap,
  fieldId,
  rowId,
  readOnly,
}: CellProps<FileMediaCellType>) {
  const value = cell?.data;
  const { workspaceId, databasePageId } = useDatabaseContext();
  const [openPreview, setOpenPreview] = React.useState(false);
  const previewIndexRef = React.useRef(0);
  const photos = useMemo(() => {
    return (
      value
        ?.filter((item) => {
          return item.file_type === FileMediaType.Image && item.url;
        })
        .map((image) => {
          return {
            src: image.url,
          };
        }) || []
    );
  }, [value]);

  const images = useMemo(() => {
    return value?.filter((item) => item.file_type === FileMediaType.Image && item.url) || [];
  }, [value]);

  const handlePreview = useCallback((index: number) => {
    previewIndexRef.current = index;
    setOpenPreview(true);
  }, []);

  const renderItem = useCallback(
    (file: FileMediaCellDataItem) => {
      switch (file.file_type) {
        case FileMediaType.Image:
          return (
            <PreviewImage
              key={file.id}
              file={file}
              onClick={() => {
                const index = images.findIndex((item) => item.id === file.id);

                if (index === -1) {
                  return;
                }

                handlePreview(index);
              }}
            />
          );
        default:
          return <UnPreviewFile key={file.id} file={file} />;
      }
    },
    [handlePreview, images]
  );

  const renderChildren = useMemo(() => {
    const length = value?.length || 0;

    if (length === 0) {
      return placeholder || null;
    }

    return value?.map(renderItem);
  }, [placeholder, renderItem, value]);

  return (
    <div
      style={style}
      className={cn(
        'flex items-center gap-1.5',
        readOnly ? 'cursor-text' : 'cursor-pointer',
        !value || (value?.length === 0 && 'text-text-tertiary'),
        wrap ? 'flex-wrap' : 'appflowy-hidden-scroller w-full flex-nowrap overflow-x-auto overflow-y-hidden'
      )}
    >
      {renderChildren}
      {editing && (
        <FileMediaCellMenu
          open={editing}
          onOpenChange={setEditing}
          fieldId={fieldId}
          cell={cell}
          rowId={rowId}
          onPreview={handlePreview}
          showUpload={!value || value.length === 0}
        />
      )}
      {openPreview && (
        <Suspense>
          <GalleryPreview
            workspaceId={workspaceId}
            viewId={databasePageId}
            images={photos}
            previewIndex={previewIndexRef.current}
            open={openPreview}
            onClose={() => {
              setOpenPreview(false);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}

export default FileMediaCell;
