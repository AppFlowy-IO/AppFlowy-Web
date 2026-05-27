import LinearProgress from '@mui/material/LinearProgress';
import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as AppFlowyIcon } from '@/assets/icons/appflowy.svg';
import { ReactComponent as NotionIcon } from '@/assets/icons/notion.svg';
import { FileService } from '@/application/services/domains';
import FileDropzone from '@/components/_shared/file-dropzone/FileDropzone';
import { notify } from '@/components/_shared/notify';
import { TabPanel, ViewTab, ViewTabs } from '@/components/_shared/tabs/ViewTabs';

const ZIP_ACCEPT = '.zip,application/zip,application/x-zip,application/x-zip-compressed';

function ImporterDialogContent({ source, onSuccess }: { source?: string; onSuccess: () => void }) {
  const { t } = useTranslation();
  const [value, setValue] = React.useState<string>(source || 'notion');
  const [progress, setProgress] = React.useState<number>(0);
  const [isError, setIsError] = React.useState<boolean>(false);

  const handleUpload = useCallback(
    async (file: File) => {
      setIsError(false);
      try {
        await FileService.importFile(file, setProgress);
        onSuccess();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        notify.error(e.message);
        setIsError(true);
      }
    },
    [onSuccess]
  );

  const isUploading = !isError && progress < 1 && progress > 0;

  return (
    <div className={'flex flex-col gap-8'}>
      <ViewTabs
        className={'border-b border-border-primary'}
        onChange={(_e, newValue) => setValue(newValue)}
        value={value}
      >
        <ViewTab
          className={'flex flex-row items-center justify-center gap-1.5'}
          value={'appflowy'}
          label={t('web.importFromAppFlowy')}
          icon={<AppFlowyIcon className={'mb-0 h-4 w-4'} />}
        />
        <ViewTab
          className={'flex flex-row items-center justify-center gap-1.5'}
          value={'notion'}
          label={t('web.importFromNotion')}
          icon={<NotionIcon className={'mb-0 h-4 w-4'} />}
        />
      </ViewTabs>
      <div className={'p-2 pb-0'}>
        <TabPanel
          className={'flex min-w-[480px] max-w-full flex-col gap-2 overflow-hidden max-sm:w-full max-sm:min-w-[80vw]'}
          index={'appflowy'}
          value={value}
        >
          <FileDropzone
            accept={ZIP_ACCEPT}
            multiple={false}
            onChange={(files) => {
              if (!files.length) return;
              void handleUpload(files[0]);
            }}
            disabled={isUploading}
            placeholder={t('web.dropAppFlowyFile')}
            loading={isUploading}
          />
          {progress > 0 && (
            <LinearProgress
              variant='determinate'
              color={isError ? 'error' : progress === 1 ? 'success' : 'primary'}
              value={progress * 100}
            />
          )}
        </TabPanel>
        <TabPanel
          className={'flex min-w-[480px] max-w-full flex-col gap-2 overflow-hidden max-sm:w-full max-sm:min-w-[80vw]'}
          index={'notion'}
          value={value}
        >
          <FileDropzone
            accept={ZIP_ACCEPT}
            multiple={false}
            onChange={(files) => {
              if (!files.length) return;
              void handleUpload(files[0]);
            }}
            disabled={isUploading}
            placeholder={t('web.dropNotionFile')}
            loading={isUploading}
          />
          {progress > 0 && (
            <LinearProgress
              variant='determinate'
              color={isError ? 'error' : progress === 1 ? 'success' : 'primary'}
              value={progress * 100}
            />
          )}
        </TabPanel>
      </div>
    </div>
  );
}

export default ImporterDialogContent;
