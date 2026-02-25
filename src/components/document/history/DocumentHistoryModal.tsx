import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Y from 'yjs';

import { CollabVersionRecord } from '@/application/collab-version.type';
import { Types, ViewIcon } from '@/application/types';
import ComponentLoading from '@/components/_shared/progress/ComponentLoading';
import { useAppHandlers, useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { useSubscriptionPlan } from '@/components/app/hooks/useSubscriptionPlan';
import { Editor } from '@/components/editor';
import { EditorContextState } from '@/components/editor/EditorContext';
import { useCurrentUser } from '@/components/main/app.hooks';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { Log } from '@/utils/log';

import { VersionList } from './DocumentHistoryVersionList';

type VersionPreviewBodyProps = {
  loading: boolean;
  error: string | null;
  activeDoc: Y.Doc | null;
  workspaceId?: string;
  viewId: string;
} & Partial<Omit<EditorContextState, 'workspaceId' | 'viewId' | 'readOnly'>>;

const VersionPreviewBody = memo(function VersionPreviewBody({
  loading,
  error,
  activeDoc,
  workspaceId,
  viewId,
  ...editorProps
}: VersionPreviewBodyProps) {
  if (loading) {
    return <ComponentLoading />;
  }

  if (error) {
    return <EmptyState message={error} />;
  }

  if (!activeDoc) {
    return null;
  }

  return (
    <div style={{ pointerEvents: 'none' }}>
      <Editor
        workspaceId={workspaceId || ''}
        viewId={viewId}
        readOnly
        doc={activeDoc}
        fullWidth
        {...editorProps}
        uploadFile={undefined}
      />
    </div>
  );
});

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
  const [dateFilter, setDateFilter] = useState<'all' | 'last7Days' | 'last30Days' | 'last60Days'>('all');
  const [onlyShowMine, setOnlyShowMine] = useState(false);
  const previewYDocRef = useRef<Map<string, Y.Doc>>(new Map());
  const [activeDoc, setActiveDoc] = useState<Y.Doc | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const selectedVersionIdRef = useRef(selectedVersionId);
  const activeViewIdRef = useRef(viewId);

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

    return filtered;
  }, [versions, onlyShowMine, currentUser, dateFilter]);

  const refreshVersions = useCallback(async () => {
    if (!viewId || !getCollabHistory) {
      return [];
    }

    const requestViewId = viewId;

    setLoading(true);
    setError(null);
    try {
      const data = await getCollabHistory(requestViewId);

      if (activeViewIdRef.current !== requestViewId) {
        return [];
      }

      setVersions(data);
      return data;
    } catch (error) {
      if (activeViewIdRef.current !== requestViewId) {
        return [];
      }

      setError(error instanceof Error ? error.message : String(error));
      return [];
    } finally {
      if (activeViewIdRef.current === requestViewId) {
        setLoading(false);
      }
    }
  }, [viewId, getCollabHistory]);

  const handleSetDateFilter = useCallback((filter: 'all' | 'last7Days' | 'last30Days' | 'last60Days') => {
    setDateFilter(filter);
  }, []);

  const clearPreviewDocs = useCallback(() => {
    previewYDocRef.current.forEach((doc) => {
      doc.destroy();
    });
    previewYDocRef.current.clear();
  }, []);

  const handleRestore = useCallback(async () => {
    const versionId = selectedVersionIdRef.current;

    if (!viewId || !versionId || !revertCollabVersion) {
      return;
    }

    setIsRestoring(true);
    setError(null);
    try {
      await revertCollabVersion(viewId, versionId);
      setActiveDoc(null);
      clearPreviewDocs();

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
  }, [viewId, revertCollabVersion, refreshVersions, clearPreviewDocs]);

  const handleClose = useCallback(() => onOpenChange(false), [onOpenChange]);

  useEffect(() => {
    if (!open) {
      return;
    }

    void refreshVersions();
  }, [open, refreshVersions]);

  selectedVersionIdRef.current = selectedVersionId;

  useEffect(() => {
    activeViewIdRef.current = viewId;
  }, [viewId]);

  useEffect(() => {
    if (visibleVersions.length === 0) {
      if (selectedVersionIdRef.current) {
        setSelectedVersionId('');
      }

      return;
    }

    if (!visibleVersions.some((v) => v.versionId === selectedVersionIdRef.current)) {
      setSelectedVersionId(visibleVersions[0].versionId);
    }
  }, [visibleVersions]);

  useEffect(() => {
    if (!open) {
      setActiveDoc(null);
      clearPreviewDocs();
      return;
    }

    if (!selectedVersionId || !viewId || !previewCollabVersion) {
      setActiveDoc(null);
      return;
    }

    let cancelled = false;
    const previewVersionId = selectedVersionId;
    const cachedDoc = previewYDocRef.current.get(previewVersionId);

    if (cachedDoc) {
      setActiveDoc(cachedDoc);
      return;
    }

    void (async () => {
      try {
        const doc = await previewCollabVersion(viewId, previewVersionId, Types.Document);

        if (!doc) {
          return;
        }

        if (cancelled) {
          doc.destroy();
          return;
        }

        previewYDocRef.current.set(previewVersionId, doc);
        setActiveDoc(doc);
      } catch (error) {
        if (!cancelled) {
          Log.warn('Failed to preview document version', error);
          setActiveDoc(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, previewCollabVersion, selectedVersionId, viewId, clearPreviewDocs]);

  useEffect(() => {
    activeViewIdRef.current = viewId;
    setVersions([]);
    setSelectedVersionId('');
    setError(null);
    setLoading(open);
    setActiveDoc(null);
    clearPreviewDocs();
  }, [viewId, open, clearPreviewDocs]);

  useEffect(() => {
    return () => {
      clearPreviewDocs();
    };
  }, [clearPreviewDocs]);

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
          <div className='flex-1 overflow-hidden'>
            <VersionPreviewBody
              loading={loading}
              error={error}
              activeDoc={activeDoc}
              workspaceId={workspaceId}
              viewId={viewId}
              {...(props as Partial<Omit<EditorContextState, 'workspaceId' | 'viewId' | 'readOnly'>>)}
            />
          </div>
        </div>
        <div className='order-1 flex w-full max-w-full flex-col rounded-r-2xl border-border-primary bg-surface-container-layer-01 md:order-2 md:w-[280px] md:border-l'>
          <VersionList
            versions={visibleVersions}
            selectedVersionId={selectedVersionId}
            onSelect={setSelectedVersionId}
            dateFilter={dateFilter}
            onlyShowMine={onlyShowMine}
            onDateFilterChange={handleSetDateFilter}
            onOnlyShowMineChange={setOnlyShowMine}
            onRestoreClicked={handleRestore}
            isRestoring={isRestoring}
            onClose={handleClose}
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
