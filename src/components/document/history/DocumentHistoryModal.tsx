import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Y from 'yjs';

import { CollabVersionRecord } from '@/application/collab-version.type';
import { MentionablePerson, Types, ViewIcon, YjsEditorKey } from '@/application/types';
import ComponentLoading from '@/components/_shared/progress/ComponentLoading';
import { useAppHandlers, useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { useSubscriptionPlan } from '@/components/app/hooks/useSubscriptionPlan';
import { Editor } from '@/components/editor';
import { useCurrentUser } from '@/components/main/app.hooks';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { Log } from '@/utils/log';

import { VersionList } from './DocumentHistoryVersionList';

export function DocumentHistoryModal({
  open,
  onOpenChange,
  viewId,
  view,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  viewId: string;
  view?: {
    name: string;
    icon: ViewIcon | null;
  };
}) {
  const {
    loadMentionableUsers,
    getSubscriptions,
    getCollabHistory,
    previewCollabVersion,
    revertCollabVersion,
    ...props
  } = useAppHandlers();
  const workspaceId = useCurrentWorkspaceId();
  const currentUser = useCurrentUser();
  const { isPro } = useSubscriptionPlan(getSubscriptions);
  const { t } = useTranslation();
  const [versions, setVersions] = useState<CollabVersionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string>('');
  const [mentionables, setMentionables] = useState<MentionablePerson[]>([]);
  const [dateFilter, setDateFilter] = useState<'all' | 'last7Days' | 'last30Days' | 'last60Days'>('all');
  const [onlyShowMine, setOnlyShowMine] = useState(false);
  const previewYDocRef = useRef<Map<string, Y.Doc>>(new Map());
  const [activeDoc, setActiveDoc] = useState<Y.Doc | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);

  const visibleVersions = useMemo(() => {
    let filtered = [...versions];

    if (onlyShowMine && currentUser) {
      filtered = filtered.filter((version) => version.editors.some((editor) => editor.toString() === currentUser.uid));
    }

    const now = new Date();

    filtered = filtered.filter((version) => {
      if (dateFilter === 'all') {
        return true;
      }

      const diffTime = Math.abs(now.getTime() - version.createdAt.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (dateFilter === 'last7Days') {
        return diffDays <= 7;
      } else if (dateFilter === 'last30Days') {
        return diffDays <= 30;
      } else if (dateFilter === 'last60Days') {
        return diffDays <= 60;
      }

      return true;
    });

    if (filtered.length > 0 && !filtered.some((version) => version.versionId === selectedVersionId)) {
      setSelectedVersionId(filtered[0].versionId);
    }

    return filtered;
  }, [versions, onlyShowMine, currentUser, dateFilter, selectedVersionId]);

  const authorMap = useMemo(() => {
    const map = new Map<string, MentionablePerson>();

    mentionables.forEach((user) => {
      map.set(user.person_id, user);
    });
    return map;
  }, [mentionables]);

  const refreshVersions = useCallback(async () => {
    if (!viewId || !getCollabHistory) {
      return [];
    }

    setLoading(true);
    setError(null);
    try {
      const data = await getCollabHistory(viewId);

      setVersions(data);
      return data;
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      return [];
    } finally {
      setLoading(false);
    }
  }, [viewId, getCollabHistory]);

  const handleSetDateFilter = useCallback(
    (filter: 'all' | 'last7Days' | 'last30Days' | 'last60Days') => {
      if (dateFilter === filter) {
        return;
      }

      setDateFilter(filter);
    },
    [dateFilter]
  );

  const refreshAuthors = useCallback(async () => {
    if (!open || !loadMentionableUsers) {
      return;
    }

    try {
      const users = await loadMentionableUsers();

      setMentionables(users ?? []);
    } catch (error) {
      console.error('Failed to load mentionable users', error);
    }
  }, [loadMentionableUsers, open]);

  const handleRestore = useCallback(async () => {
    if (!viewId || !selectedVersionId || !revertCollabVersion) {
      return;
    }

    setIsRestoring(true);
    setError(null);
    try {
      void revertCollabVersion(viewId, selectedVersionId);
      previewYDocRef.current.clear();
      setActiveDoc(null);

      const updatedVersions = await refreshVersions();

      if (updatedVersions.length > 0) {
        setSelectedVersionId(updatedVersions[0].versionId);
      } else {
        setSelectedVersionId('');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      Log.error('Failed to restore document version', err);
      setError(message);
    } finally {
      setIsRestoring(false);
    }
  }, [viewId, selectedVersionId, revertCollabVersion, refreshVersions]);

  useEffect(() => {
    if (!open) {
      return;
    }

    void refreshVersions();
  }, [open, refreshVersions]);

  useEffect(() => {
    if (!open) {
      return;
    }

    void refreshAuthors();
  }, [open, refreshAuthors]);

  useEffect(() => {
    void (async () => {
      if (!selectedVersionId) {
        Log.warn('No selected version id for previewing version');
      }

      const cachedDoc = previewYDocRef.current.get(selectedVersionId);

      if (cachedDoc) {
        setActiveDoc(cachedDoc);
        return;
      }

      if (!viewId || !previewCollabVersion) {
        return;
      }

      try {
        const doc = await previewCollabVersion(viewId, selectedVersionId, Types.Document);

        //Log.debug('preview', doc?.getMap(YjsEditorKey.data_section).toJSON());

        if (!doc) {
          Log.warn('No doc received for previewing version');
          return;
        }

        previewYDocRef.current.set(selectedVersionId, doc);
        setActiveDoc(doc);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        // do nothing
      }
    })();
  }, [previewCollabVersion, selectedVersionId, viewId, workspaceId]);

  useEffect(() => {
    if (!open && visibleVersions.length > 0) {
      setSelectedVersionId(visibleVersions[0].versionId);
    }
  }, [open, visibleVersions]);

  const PreviewBody = useMemo(() => {
    if (loading) {
      return <ComponentLoading />;
    }

    if (error) {
      return <EmptyState message={error} />;
    }

    if (!activeDoc) {
      return <></>;
    }

    return (
      <div style={{ pointerEvents: 'none' }}>
        <Editor
          workspaceId={workspaceId || ''}
          viewId={viewId}
          readOnly={true}
          doc={activeDoc}
          fullWidth
          {...props}
          uploadFile={undefined}
        />
      </div>
    );
  }, [activeDoc, error, loading, props, viewId, workspaceId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="version-history-modal"
        className={cn(
          'flex !h-full !w-full rounded-2xl bg-surface-layer-02 p-0',
          '!max-h-[min(920px,_calc(100vh-160px))] !min-h-[min(689px,_calc(100vh-40px))] !min-w-[min(984px,_calc(100vw-40px))] !max-w-[min(1680px,_calc(100vw-240px))] '
        )}
        showCloseButton={false}
      >
        <div className='order-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-t-2xl md:order-1 md:rounded-l-2xl md:rounded-tr-none'>
          <DialogHeader className='border-b border-border px-6 py-4'>
            <DialogTitle>{view?.name || t('untitled')}</DialogTitle>
          </DialogHeader>
          <div className='flex-1 overflow-hidden'>{PreviewBody}</div>
        </div>
        <div className='order-1 flex w-full max-w-full flex-col rounded-r-2xl border-border-primary bg-surface-container-layer-01 md:order-2 md:w-[280px] md:border-l'>
          <VersionList
            versions={visibleVersions}
            selectedVersionId={selectedVersionId}
            onSelect={setSelectedVersionId}
            authorMap={authorMap}
            dateFilter={dateFilter}
            onlyShowMine={onlyShowMine}
            onDateFilterChange={handleSetDateFilter}
            onOnlyShowMineChange={setOnlyShowMine}
            onRestoreClicked={handleRestore}
            isRestoring={isRestoring}
            onClose={() => onOpenChange(false)}
            isPro={isPro}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EmptyState({ message }: { message: string }) {
  return <div className='flex h-full items-center justify-center text-sm text-text-tertiary'>{message}</div>;
}

export default DocumentHistoryModal;
