import { Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material';
import { format } from 'date-fns';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { DatabaseHistoryCursor, DatabaseHistoryVersion } from '@/application/database-history.type';
import { DATABASE_HISTORY_PAGE_SIZE, getDatabaseHistory } from '@/application/services/domains/database-history';
import ComponentLoading from '@/components/_shared/progress/ComponentLoading';
import {
  HistoryDateFilter,
  VersionHistoryDateFilter,
  VersionHistoryDialog,
  VersionHistoryEmptyState,
  VersionHistoryFooter,
  VersionHistoryHeader,
  VersionHistoryItem,
} from '@/components/_shared/version-history';
import { Button } from '@/components/ui/button';

import { DatabaseHistoryPreview } from './DatabaseHistoryPreviewProvider';
import { DatabaseHistoryPreviewSession, loadDatabaseHistoryPreview } from './databaseHistoryPreviewSession';
import { databaseHistoryError, useDatabaseHistoryRestore } from './useDatabaseHistoryRestore';

const HISTORY_RANGE_DAYS = { last7Days: 7, last30Days: 30, last60Days: 60 };
const RESTORE_PROGRESS: Record<string, string> = {
  queued: 'Restore queued…',
  staging_target: 'Preparing selected version…',
  target_ready: 'Selected version ready…',
  quiescing: 'Saving current database and preparing restore…',
  committing: 'Restoring database…',
  cutover_committed: 'Updating database…',
  finalizing: 'Updating database…',
  succeeded: 'Reloading database…',
};

export default function DatabaseHistoryModal({
  open, onOpenChange, workspaceId, databaseId, databasePageId, activeViewId, userId, name, onRestored,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  workspaceId: string;
  databaseId: string;
  databasePageId: string;
  activeViewId?: string;
  userId: string;
  name?: string;
  onRestored: (databaseId: string, restoreId: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const [versions, setVersions] = useState<DatabaseHistoryVersion[]>([]);
  const [selected, setSelected] = useState('');
  const [dateFilter, setDateFilter] = useState<HistoryDateFilter>('all');
  const [cursor, setCursor] = useState<DatabaseHistoryCursor>();
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<(DatabaseHistoryPreviewSession & { version: string }) | null>(null);
  const [confirmation, setConfirmation] = useState<DatabaseHistoryVersion | null>(null);
  const [refresh, setRefresh] = useState(0);
  const previousCompleted = useRef(0);
  const restore = useDatabaseHistoryRestore({ open, userId, workspaceId, databaseId, onRestored });
  const selectedVersion = useMemo(() => versions.find((version) => version.version === selected), [versions, selected]);
  // Fix the range for this list traversal, even when an older page is requested later.
  const since = useMemo(() => dateFilter === 'all' ? undefined : Date.now() - HISTORY_RANGE_DAYS[dateFilter] * 86_400_000,
    [dateFilter]);

  useEffect(() => {
    if (restore.completed === previousCompleted.current) return;
    previousCompleted.current = restore.completed;
    // Completion follows the live database reload. Leave history before a refresh
    // can select the newly saved recovery version and show pre-restore content.
    onOpenChange(false);
  }, [restore.completed, onOpenChange]);

  useEffect(() => {
    if (!open) {
      setCursor(undefined);
      return;
    }

    const controller = new AbortController();

    setLoading(true);
    setListError(null);
    if (!cursor) {
      setVersions([]);
      setSelected('');
    }

    void getDatabaseHistory(workspaceId, databaseId, { cursor, since, signal: controller.signal })
      .then((records) => {
        if (controller.signal.aborted) return;
        const active = records.filter((version) => !version.is_deleted);

        setVersions((previous) => cursor ? [...previous, ...active.filter((record) =>
          !previous.some((existing) => existing.version === record.version))] : active);
        setHasMore(records.length === DATABASE_HISTORY_PAGE_SIZE);
        if (!cursor) setSelected(active[0]?.version || '');
        // Pagination uses the final raw record, including soft-deleted versions.
        lastRecord.current = records[records.length - 1];
      })
      .catch((error) => {
        if (!controller.signal.aborted) setListError(databaseHistoryError(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open, workspaceId, databaseId, cursor, since, refresh]);

  const lastRecord = useRef<DatabaseHistoryVersion>();
  const rowCount = selectedVersion?.row_count;

  useEffect(() => {
    setPreview(null);
    setPreviewError(null);
    if (!open || !selected || rowCount === undefined) {
      setPreviewLoading(false);
      return;
    }

    const controller = new AbortController();
    let session: DatabaseHistoryPreviewSession | undefined;

    setPreviewLoading(true);
    void loadDatabaseHistoryPreview({ workspaceId, databaseId, version: selected, rowCount, signal: controller.signal })
      .then((loaded) => {
        if (controller.signal.aborted) {
          loaded.destroy();
          return;
        }

        session = loaded;
        setPreview({ ...loaded, version: selected });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setPreviewError(databaseHistoryError(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setPreviewLoading(false);
      });
    return () => {
      controller.abort();
      session?.destroy();
    };
  }, [open, workspaceId, databaseId, selected, rowCount]);

  return (
    <>
      <VersionHistoryDialog open={open} onClose={() => onOpenChange(false)} title={name || t('untitled')}
        testId='database-version-history-modal' sidebar={
          <div className='flex h-full min-h-0 flex-col'>
            <VersionHistoryHeader closeTestId='database-history-close' onClose={() => onOpenChange(false)}>
              <VersionHistoryDateFilter value={dateFilter} onChange={(filter) => {
                setCursor(undefined);
                setDateFilter(filter);
              }} />
            </VersionHistoryHeader>
            <div data-testid='database-history-list' className='min-h-0 flex-1 overflow-y-auto p-3'>
              {versions.map((version, index) => {
                const timestamp = <time dateTime={version.created_at}>{format(new Date(version.created_at), 'PPpp')}</time>;

                return (
                  <VersionHistoryItem key={version.version} id={version.version} title={timestamp}
                    selected={selected === version.version} isFirst={index === 0} isLast={index === versions.length - 1}
                    onSelect={setSelected} testId='database-history-version'>
                    {version.name && version.name !== 'Database snapshot' && version.name !== 'Before restore' && (
                      <span className='text-xs text-text-secondary'>{version.name}</span>
                    )}
                    <span className='text-xs text-text-tertiary'>
                      {t('databaseHistory.rowCount', '{{count}} rows', { count: version.row_count })}
                    </span>
                  </VersionHistoryItem>
                );
              })}
              {hasMore && <Button variant='ghost' className='w-full' disabled={loading} onClick={() => {
                const last = lastRecord.current;

                if (last) setCursor({ before_changed_at: last.changed_at, before_version: last.version });
              }}>{loading ? t('loading') : t('databaseHistory.loadOlder', 'Load older versions')}</Button>}
              {listError && <p role='alert' className='p-3 text-sm text-text-error'>{listError}</p>}
              {listError && <Button variant='ghost' onClick={() => setRefresh((value) => value + 1)}>
                {t('button.retry', 'Retry')}
              </Button>}
            </div>
            <VersionHistoryFooter disabled={!selectedVersion || restore.isRestoring || !userId}
              loading={restore.isRestoring} testId='database-history-restore'
              onRestore={() => setConfirmation(selectedVersion || null)}>
              {restore.isRestoring && <p role='status' className='text-sm text-text-secondary'>
                {t(`databaseHistory.restoreState.${restore.job?.state || 'queued'}`,
                  RESTORE_PROGRESS[restore.job?.state || 'queued'] || 'Restoring database…')}
                <span className='mt-1 block text-xs'>{t('databaseHistory.canClose', 'You can close this window. The restore will continue.')}</span>
              </p>}
              {restore.error && <p role='alert' className='text-sm text-text-error'>{restore.error}</p>}
            </VersionHistoryFooter>
          </div>
        }>
        {previewLoading || (loading && !versions.length) ? <ComponentLoading /> : previewError ? (
          <VersionHistoryEmptyState role='alert'>{previewError}</VersionHistoryEmptyState>
        ) : preview?.version === selected ? (
          <DatabaseHistoryPreview workspaceId={workspaceId} databaseId={databaseId}
            databasePageId={databasePageId} activeViewId={activeViewId} root={preview.root} rows={preview.rows} />
        ) : <VersionHistoryEmptyState>{t('databaseHistory.noVersions', 'No versions available.')}</VersionHistoryEmptyState>}
      </VersionHistoryDialog>
      <Dialog open={!!confirmation} onClose={() => setConfirmation(null)} aria-labelledby={`${titleId}-confirm`}>
        <DialogTitle id={`${titleId}-confirm`}>{t('databaseHistory.confirmTitle', 'Restore this database version?')}</DialogTitle>
        <DialogContent>
          <p className='text-sm'>{t('databaseHistory.confirmDescription',
            'This restores the whole database, including shared views and rows. Row-page document content and folder structure stay as they are. A recovery version of the current database will be saved first; if that fails, the restore will stop.')}</p>
        </DialogContent>
        <DialogActions>
          <Button variant='ghost' onClick={() => setConfirmation(null)}>{t('button.cancel')}</Button>
          <Button data-testid='database-history-confirm-restore' onClick={() => {
            if (confirmation) restore.start(confirmation.version);
            setConfirmation(null);
          }}>{t('versionHistory.restoreVersion', 'Restore version')}</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
