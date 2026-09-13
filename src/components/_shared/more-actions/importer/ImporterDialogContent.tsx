import LinearProgress from '@mui/material/LinearProgress';
import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { FileService } from '@/application/services/domains';
import FileDropzone from '@/components/_shared/file-dropzone/FileDropzone';
import { notify } from '@/components/_shared/notify';
import { TabPanel, ViewTab, ViewTabs } from '@/components/_shared/tabs/ViewTabs';

const ZIP_ACCEPT = '.zip,application/zip,application/x-zip,application/x-zip-compressed';

const IMPORT_SOURCES = {
  appflowy: {
    taskType: FileService.CreateImportTaskType.Workspace,
    label: 'web.importFromAppFlowy',
    placeholder: 'web.dropAppFlowyFile',
  },
  notion: {
    taskType: FileService.CreateImportTaskType.Notion,
    label: 'web.importFromNotion',
    placeholder: 'web.dropNotionFile',
  },
  confluence: {
    taskType: FileService.CreateImportTaskType.Confluence,
    label: 'web.importFromConfluence',
    placeholder: 'web.dropConfluenceFile',
  },
} as const;

type ImportSource = keyof typeof IMPORT_SOURCES;

function ImporterDialogContent({ source, onSuccess }: { source?: string; onSuccess: () => void }) {
  const { t } = useTranslation();
  const [value, setValue] = React.useState<ImportSource>(
    source === 'appflowy' || source === 'confluence' ? source : 'notion'
  );
  const [progress, setProgress] = React.useState<number>(0);
  const [isError, setIsError] = React.useState<boolean>(false);
  const [isUploading, setIsUploading] = React.useState(false);

  const handleUpload = useCallback(
    async (file: File) => {
      if (isUploading) return;
      setIsUploading(true);
      setProgress(0);
      setIsError(false);
      try {
        await FileService.importFile(file, {
          taskType: IMPORT_SOURCES[value].taskType,
          onProgress: setProgress,
        });
        onSuccess();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        notify.error(e.message);
        setIsError(true);
      } finally {
        setIsUploading(false);
      }
    },
    [isUploading, onSuccess, value]
  );

  return (
    <div className={'flex flex-col gap-8'}>
      <p className='text-sm text-text-secondary'>{t('web.importCreatesWorkspace')}</p>
      <ViewTabs
        className={'border-b border-border-primary'}
        onChange={(_e, newValue) => setValue(newValue)}
        value={value}
        variant='scrollable'
        scrollButtons='auto'
        allowScrollButtonsMobile
      >
        {Object.entries(IMPORT_SOURCES).map(([source, config]) => (
          <ViewTab key={source} value={source} label={t(config.label)} disabled={isUploading} />
        ))}
      </ViewTabs>
      <div className={'p-2 pb-0'}>
        {Object.entries(IMPORT_SOURCES).map(([source, config]) => (
          <TabPanel
            key={source}
            className={'flex min-w-[480px] max-w-full flex-col gap-2 overflow-hidden max-sm:w-full max-sm:min-w-[80vw]'}
            index={source}
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
              placeholder={t(config.placeholder)}
              loading={isUploading}
            />
            {progress > 0 && (
              <LinearProgress
                variant='determinate'
                color={isError ? 'error' : !isUploading && progress === 1 ? 'success' : 'primary'}
                value={progress * 100}
              />
            )}
          </TabPanel>
        ))}
      </div>
    </div>
  );
}

export default ImporterDialogContent;
