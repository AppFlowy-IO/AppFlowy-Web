import LinearProgress from '@mui/material/LinearProgress';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FileService } from '@/application/services/domains';
import FileDropzone from '@/components/_shared/file-dropzone/FileDropzone';
import { notify } from '@/components/_shared/notify';
import { TabPanel, ViewTab, ViewTabs } from '@/components/_shared/tabs/ViewTabs';
import { useWorkspaceCreationCapability } from '@/components/app/hooks/useWorkspaceCreationCapability';
import { WorkspaceCreationNotice } from '@/components/app/workspaces/WorkspaceCreationNotice';

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
  const [value, setValue] = useState<ImportSource>(source === 'appflowy' || source === 'confluence' ? source : 'notion');
  const [progress, setProgress] = useState<number>(0);
  const [isError, setIsError] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState(false);
  const [files, setFiles] = useState<Partial<Record<ImportSource, File>>>({});
  const creation = useWorkspaceCreationCapability();
  const uploadScope = useMemo(
    () => ({ key: creation.scopeKey, controller: undefined as AbortController | undefined }),
    [creation.scopeKey]
  );

  useEffect(() => () => uploadScope.controller?.abort(), [uploadScope]);

  const handleUpload = useCallback(
    async (file: File) => {
      if (isUploading || !creation.canCreate) return;
      const controller = new AbortController();

      uploadScope.controller = controller;
      setFiles((previous) => ({ ...previous, [value]: file }));
      setIsUploading(true);
      setProgress(0);
      setIsError(false);
      try {
        await FileService.importFile(file, {
          taskType: IMPORT_SOURCES[value].taskType,
          signal: controller.signal,
          onProgress: (progress) => {
            if (creation.isCurrent()) setProgress(progress);
          },
        });
        if (!creation.isCurrent()) return;
        onSuccess();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        if (!creation.isCurrent()) return;
        notify.error(e.message);
        setIsError(true);
        void creation.refresh();
      } finally {
        if (creation.isCurrent()) setIsUploading(false);
      }
    },
    [isUploading, onSuccess, value, creation, uploadScope]
  );

  return (
    <div className={'flex flex-col gap-8'}>
      <p className='text-sm text-text-secondary'>{t('web.importCreatesWorkspace')}</p>
      <WorkspaceCreationNotice capability={creation} showOwnership />
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
              disabled={isUploading || !creation.canCreate}
              placeholder={t(config.placeholder)}
              loading={isUploading}
            />
            {files[source as ImportSource] && (
              <div className='text-sm'>
                <p>{files[source as ImportSource]?.name}</p>
                {isError && (
                  <button
                    type='button'
                    disabled={isUploading || !creation.canCreate}
                    onClick={() => {
                      const file = files[source as ImportSource];

                      if (file) void handleUpload(file);
                    }}
                  >
                    {t('button.retry')}
                  </button>
                )}
              </div>
            )}
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
