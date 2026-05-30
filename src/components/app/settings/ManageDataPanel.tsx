import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { ExportService, FileService } from '@/application/services/domains';
import { ReactComponent as HelpIcon } from '@/assets/icons/help.svg';
import { useCurrentWorkspaceId, useUserWorkspaceInfo } from '@/components/app/app.hooks';
import { useCurrentUser } from '@/components/main/app.hooks';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getErrorMessage } from '@/utils/errors';
import { openUrl } from '@/utils/url';

const ZIP_ACCEPT = '.zip,application/zip,application/x-zip,application/x-zip-compressed';

const IMPORT_GUIDE_URL = 'https://appflowy.com/guide/import-from-AppFlowy';
const BACKUP_GUIDE_URL = 'https://appflowy.com/guide/back-up-your-data';

export function ManageDataPanel() {
  const { t } = useTranslation();
  const currentWorkspaceId = useCurrentWorkspaceId();
  const userWorkspaceInfo = useUserWorkspaceInfo();
  const currentUser = useCurrentUser();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [backingUp, setBackingUp] = useState(false);

  const isOwner = useMemo(() => {
    const workspace = userWorkspaceInfo?.workspaces.find((w) => w.id === currentWorkspaceId);

    return workspace?.owner?.uid.toString() === currentUser?.uid.toString();
  }, [userWorkspaceInfo?.workspaces, currentWorkspaceId, currentUser?.uid]);

  const handleImport = useCallback(
    async (file: File) => {
      setImporting(true);
      try {
        await FileService.importFile(file, () => {
          /* progress is surfaced via the in-progress state */
        });
        toast.success(t('settings.manageData.importWorkspace.success'));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        toast.error(getErrorMessage(e) || t('settings.manageData.importWorkspace.failed'));
      } finally {
        setImporting(false);
      }
    },
    [t]
  );

  const onFilePicked = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];

      event.target.value = '';
      if (file) void handleImport(file);
    },
    [handleImport]
  );

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleBackup = useCallback(async () => {
    if (!currentWorkspaceId) return;
    setBackingUp(true);
    try {
      await ExportService.exportWorkspace(currentWorkspaceId);
      toast.success(t('settings.manageData.backupWorkspace.started'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      toast.error(getErrorMessage(e) || t('settings.manageData.backupWorkspace.failed'));
    } finally {
      setBackingUp(false);
    }
  }, [currentWorkspaceId, t]);

  const handleBackupClick = useCallback(() => {
    void handleBackup();
  }, [handleBackup]);

  return (
    <div className='flex h-full min-h-0 flex-1 flex-col overflow-hidden'>
      <div className='border-b border-border-primary px-8 py-5'>
        <h2 className='text-xl font-semibold text-text-primary'>{t('settings.manageData.title')}</h2>
        <p className='mt-1 text-sm text-text-secondary'>{t('settings.manageData.description')}</p>
      </div>

      <div className='appflowy-scroller flex-1 overflow-y-auto px-8 py-6'>
        {/* Import your workspace */}
        <section className='flex items-center justify-between gap-4 py-4'>
          <div className='min-w-0'>
            <div className='flex items-center gap-1.5'>
              <h3 className='text-base font-semibold text-text-primary'>
                {t('settings.manageData.importWorkspace.title')}
              </h3>
              <HelpTip url={IMPORT_GUIDE_URL} />
            </div>
            <p className='mt-1 text-sm text-text-secondary'>{t('settings.manageData.importWorkspace.tooltip')}</p>
          </div>
          <Button
            variant='default'
            size='lg'
            data-testid='manage-data-import'
            loading={importing}
            disabled={importing}
            onClick={handleImportClick}
          >
            {t('settings.manageData.importWorkspace.button')}
          </Button>
          <input
            ref={fileInputRef}
            type='file'
            accept={ZIP_ACCEPT}
            className='hidden'
            data-testid='manage-data-import-input'
            onChange={onFilePicked}
          />
        </section>

        {/* Backup your workspace — owner only */}
        {isOwner && <div className='border-b border-border-primary' />}
        {isOwner && (
          <section className='flex items-center justify-between gap-4 py-4'>
            <div className='min-w-0'>
              <div className='flex items-center gap-1.5'>
                <h3 className='text-base font-semibold text-text-primary'>
                  {t('settings.manageData.backupWorkspace.title')}
                </h3>
                <HelpTip url={BACKUP_GUIDE_URL} />
              </div>
              <p className='mt-1 text-sm text-text-secondary'>{t('settings.manageData.backupWorkspace.tooltip')}</p>
            </div>
            <Button
              variant='default'
              size='lg'
              data-testid='manage-data-backup'
              loading={backingUp}
              disabled={backingUp}
              onClick={handleBackupClick}
            >
              {t('settings.manageData.backupWorkspace.button')}
            </Button>
          </section>
        )}
      </div>
    </div>
  );
}

function HelpTip({ url }: { url: string }) {
  const { t } = useTranslation();
  const handleClick = useCallback(() => {
    void openUrl(url, '_blank');
  }, [url]);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span onClick={handleClick} className='cursor-pointer text-icon-secondary hover:text-icon-primary'>
          <HelpIcon className='h-4 w-4' />
        </span>
      </TooltipTrigger>
      <TooltipContent>{t('workspace.learnMore')}</TooltipContent>
    </Tooltip>
  );
}

export default ManageDataPanel;
