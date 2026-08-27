import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import * as Y from 'yjs';

import { useDatabaseContext } from '@/application/database-yjs';
import {
  FileMediaCell as CellType,
  FileMediaCellDataItem,
  FileMediaType,
  FileMediaUploadType,
} from '@/application/database-yjs/cell.type';
import { useUpdateCellDispatch } from '@/application/database-yjs/dispatch';
import { toFileMediaCellData } from '@/application/database-yjs/fields/media/parse';
import { getFileMediaType } from '@/application/database-yjs/fields/media/utils';
import FileDropzone from '@/components/_shared/file-dropzone/FileDropzone';
import EmbedLink from '@/components/_shared/image-upload/EmbedLink';
import { TabLabel, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

enum FileMediaCellTab {
  Upload = 'upload',
  EmbedLink = 'embedLink',
}

function FileMediaUpload({
  rowId,
  fieldId,
  cell,
  onClose,
}: {
  rowId: string;
  fieldId: string;
  cell?: CellType;
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  const [tabValue, setTabValue] = useState<string>(FileMediaCellTab.Upload);
  const [uploading, setUploading] = useState(false);

  const { uploadFile } = useDatabaseContext();

  const uploadFileRemote = useCallback(
    async (file: File) => {
      if (!uploadFile) return;

      try {
        return await uploadFile(file);
        // eslint-disable-next-line
      } catch (e: any) {
        toast.error(e.message);
        return;
      }
    },
    [uploadFile]
  );
  const updateCell = useUpdateCellDispatch(rowId, fieldId);

  const addItems = useCallback(
    (items: FileMediaCellDataItem[]) => {
      const newData = new Y.Array<string>();
      const data = toFileMediaCellData(cell?.data);

      if (data.length > 0) {
        newData.push(data.map((item) => JSON.stringify(item)));
      }

      items.forEach((item) => {
        newData.push([JSON.stringify(item)]);
      });

      updateCell(newData);
    },
    [cell?.data, updateCell]
  );

  const handleFileChange = useCallback(
    async (files: File[]) => {
      setUploading(true);
      try {
        const urls = await Promise.all(files.map(uploadFileRemote));

        if (!urls) {
          toast.error(t('grid.media.uploadError'));
          return;
        }

        const items = urls.map((url, index) => {
          const file = files[index];

          if (!url) return;
          return {
            file_type: getFileMediaType(file.name),
            id: crypto.randomUUID(),
            name: file.name,
            upload_type: FileMediaUploadType.CloudMedia,
            url: url?.toString(),
          } as FileMediaCellDataItem;
        });

        addItems(items.filter((item): item is FileMediaCellDataItem => item !== undefined));
        onClose?.();
      } finally {
        setUploading(false);
      }
    },
    [addItems, t, uploadFileRemote, onClose]
  );

  const handleInsertEmbedLink = useCallback(
    (url: string) => {
      const item = {
        file_type: FileMediaType.Link,
        id: crypto.randomUUID(),
        name: url,
        upload_type: FileMediaUploadType.NetworkMedia,
        url,
      } as FileMediaCellDataItem;

      addItems([item]);
      onClose?.();
    },
    [addItems, onClose]
  );

  const tabs = useMemo(() => {
    return [
      {
        label: t('grid.media.upload'),
        value: FileMediaCellTab.Upload,
        renderContent: () => {
          return (
            <FileDropzone
              multiple={true}
              placeholder={
                <div className={'flex items-center font-medium'}>
                  <span className={'text-sm text-text-secondary'}>{t('grid.media.dragAndDropFiles')}click to </span>
                  <span className={'text-sm text-text-action'}>{t('grid.media.browse')}</span>
                </div>
              }
              onChange={handleFileChange}
              loading={uploading}
            />
          );
        },
      },
      {
        label: t('grid.media.embedLink'),
        value: FileMediaCellTab.EmbedLink,
        renderContent: () => {
          return (
            <EmbedLink
              focused={tabValue === FileMediaCellTab.EmbedLink}
              onDone={handleInsertEmbedLink}
              placeholder={t('grid.media.networkHint')}
            />
          );
        },
      },
    ];
  }, [t, handleFileChange, uploading, tabValue, handleInsertEmbedLink]);

  return (
    <div className={'min-h-[228px] w-[360px]'}>
      <Tabs value={tabValue} onValueChange={setTabValue} className='flex w-full flex-col gap-0'>
        <TabsList className='mt-2 flex w-full flex-1 justify-start border-b border-border-primary px-1.5'>
          {tabs.map((tab) => (
            <TabsTrigger
              onMouseDown={(e) => {
                e.preventDefault();
                setTabValue(tab.value);
              }}
              key={tab.value}
              value={tab.value}
            >
              <TabLabel>{tab.label}</TabLabel>
            </TabsTrigger>
          ))}
        </TabsList>

        <div className={'p-3'}>
          {tabs.map((tab) => (
            <TabsContent key={tab.value} value={tab.value} className='flex flex-col'>
              {tab.renderContent()}
            </TabsContent>
          ))}
        </div>
      </Tabs>
    </div>
  );
}

export default FileMediaUpload;
