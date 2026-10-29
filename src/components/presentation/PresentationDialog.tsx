import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';

import { getActiveRowPage } from '@/application/row-document/row-page-state';
import { yDocToSlateContent } from '@/application/slate-yjs/utils/convert';
import { useAppOperations, useAppView, useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { useViewActionPermissions } from '@/components/app/view-actions/useViewActionPermissions';
import { revealDocumentBlock } from '@/components/editor/utils/reveal-document-block';
import { useCurrentUserOptional } from '@/components/main/app.hooks';
import { Button } from '@/components/ui/button';

import { loadSourceSnapshot } from './presentation-client';
import PresentationLoading, { MindMapLoading } from './PresentationLoading';
import PresentationShell from './PresentationShell';
import { snapshotFromSlate } from './snapshot-adapter';
import { DeckAction, Mode, PageSnapshot, SavedDeck } from './types';
import { usePresentationAccess } from './usePresentationAccess';

const PresentationStudio = lazy(() => import('./PresentationStudio'));
const DocumentPresenter = lazy(() => import('./DocumentPresenter'));

export interface PresentationSourceProps {
  viewId: string;
  title?: string;
  isRow?: boolean;
  permissionViewId?: string;
  deck?: SavedDeck;
  action?: DeckAction;
}

export default function PresentationDialog({
  viewId,
  title,
  isRow = false,
  permissionViewId = viewId,
  deck,
  action,
  mode,
  onClose,
  anchorEl,
}: PresentationSourceProps & { mode: Mode; onClose: () => void; anchorEl?: HTMLElement | null }) {
  const view = useAppView(permissionViewId);
  const sourceView = useAppView(viewId);
  const rawCover = sourceView?.extra?.cover;
  // Outline refreshes rebuild every view object. Depend on the cover's content, not its identity,
  // or each workspace change would reload an open presentation and re-resolve its sources.
  const coverJson = rawCover ? JSON.stringify(rawCover) : undefined;
  const cover = useMemo(() => (coverJson ? (JSON.parse(coverJson) as typeof rawCover) : undefined), [coverJson]);
  const workspaceId = useCurrentWorkspaceId();
  const user = useCurrentUserOptional();
  const { loadView, loadRowDocument, toView } = useAppOperations();
  const identity = `${workspaceId}:${user?.uid}:${viewId}:${mode}`;
  const [snapshotResult, setSnapshotResult] = useState<{ identity: string; value: PageSnapshot }>();
  const snapshot = snapshotResult?.identity === identity ? snapshotResult.value : undefined;
  const [error, setError] = useState('');
  const [setupPopover, setSetupPopover] = useState(mode === 'slides' && (!deck || action === 'regenerate'));
  const { canRead, canWrite, hasLoadedViewActionPermissions } = useViewActionPermissions(view, !!mode, permissionViewId);
  const access = usePresentationAccess(!!mode && mode !== 'document');

  const readLatestSnapshot = useCallback(
    async (signal?: AbortSignal) => {
      if (!canRead) throw new Error('You no longer have access to this source page.');
      if (mode !== 'document') {
        if (!workspaceId) throw new Error('Select a workspace before opening presentations.');
        const resolved = await loadSourceSnapshot(workspaceId, viewId, undefined, signal);

        return isRow ? { ...resolved, kind: 'row' as const } : resolved;
      }

      const activeRow = getActiveRowPage();
      const row = isRow && activeRow?.documentId === viewId ? activeRow : undefined;

      // An empty row has properties and a title but no document to fetch/create.
      if (row && !row.hasDocument)
        return snapshotFromSlate(
          viewId,
          title || row.title || 'Untitled',
          undefined,
          true,
          row.getProperties?.(),
          cover
        );
      const doc =
        isRow && loadRowDocument
          ? await loadRowDocument(viewId, { requireServerFetch: true, rowDocumentSource: row?.source ?? undefined })
          : await loadView(viewId, false, false);

      if (!doc) throw new Error('The document snapshot is not available.');
      const content = yDocToSlateContent(doc);

      if (!content) throw new Error('The source is still loading. Close this preview and try again.');
      return snapshotFromSlate(
        viewId,
        title || row?.title || sourceView?.name || 'Untitled',
        content,
        isRow,
        row?.getProperties?.(),
        cover
      );
    },
    [canRead, mode, workspaceId, viewId, title, sourceView?.name, cover, loadView, loadRowDocument, isRow]
  );

  useEffect(() => {
    if (!mode || !canRead) return;
    const controller = new AbortController();

    setSnapshotResult(undefined);
    setError('');
    void readLatestSnapshot(controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setSnapshotResult({ identity, value: next });
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Unable to load the source.');
      });
    return () => {
      controller.abort();
    };
  }, [mode, canRead, identity, readLatestSnapshot]);
  function close() {
    onClose();
  }

  function source(referenceId: string) {
    const location = snapshot?.serverSource?.references[referenceId]?.location;

    if (snapshot?.serverSource && !location) return;
    if (location?.kind === 'web') {
      try {
        const url = new URL(location.url);

        if (url.protocol === 'https:' || url.protocol === 'http:')
          window.open(url.href, '_blank', 'noopener,noreferrer');
      } catch {
        /* Invalid source URLs are not navigable. */
      }

      return;
    }

    const pageId = location?.pageId ?? viewId;
    const blockId =
      location && (location.kind === 'document' || location.kind === 'code')
        ? location.blockId ?? undefined
        : location
        ? undefined
        : referenceId === viewId || referenceId.startsWith('property:')
        ? undefined
        : referenceId;

    close();
    if (blockId && revealDocumentBlock(pageId, blockId)) return;
    void toView(pageId, blockId).catch(() => undefined);
  }

  return (
    <PresentationShell
      setup={setupPopover}
      preview={mode === 'slides' && !setupPopover}
      onClose={close}
      anchorEl={anchorEl}
      paperClassName={mode === 'mindmap' ? 'ps-map-preview-dialog' : undefined}
    >
      {snapshot && canRead ? (
        <Suspense
          fallback={
            mode === 'mindmap' ? (
              <MindMapLoading onClose={close} />
            ) : (
              <PresentationLoading message='Loading presentation studio…' onClose={close} />
            )
          }
        >
          {mode === 'document' ? (
            <DocumentPresenter snapshot={snapshot} onClose={close} onSource={source} />
          ) : workspaceId ? (
            <PresentationStudio
              key={identity}
              workspaceId={workspaceId}
              userId={String(user?.uid ?? '')}
              snapshot={snapshot}
              onSetupChange={setSetupPopover}
              initialMode={mode}
              presentMindMap={mode === 'mindmap'}
              canWrite={!!canWrite}
              onUpgrade={access.onUpgrade}
              canManageStyles={access.canManageStyles}
              initialDeck={deck}
              initialAction={action}
              onClose={close}
              onSource={source}
            />
          ) : null}
        </Suspense>
      ) : error || (hasLoadedViewActionPermissions && !canRead) ? (
        <div className='flex h-full flex-col items-center justify-center gap-4'>
          <p role='status'>{error || 'You no longer have access to this source page.'}</p>
          <Button onClick={close}>Back to page</Button>
        </div>
      ) : mode === 'mindmap' ? (
        <MindMapLoading onClose={close} />
      ) : (
        <PresentationLoading message='Loading authorized page snapshot…' onClose={close} />
      )}
    </PresentationShell>
  );
}
