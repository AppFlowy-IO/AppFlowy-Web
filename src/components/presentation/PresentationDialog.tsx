import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getActiveRowPage } from '@/application/row-document/row-page-state';
import { yDocToSlateContent } from '@/application/slate-yjs/utils/convert';
import { useAppOperations, useAppView, useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { useViewActionPermissions } from '@/components/app/view-actions/useViewActionPermissions';
import { revealDocumentBlock } from '@/components/editor/utils/reveal-document-block';
import { useCurrentUserOptional } from '@/components/main/app.hooks';
import { Button } from '@/components/ui/button';

import { loadSourceSnapshot } from './presentation-client';
import { loadDocumentPresenter, loadPresentationStudio } from './presentation-preload';
import PresentationLoading, { MindMapLoading } from './PresentationLoading';
import PresentationShell from './PresentationShell';
import { forgetSavedDecks } from './saved-deck-cache';
import { snapshotFromSlate } from './snapshot-adapter';
import { DeckAction, Mode, PageSnapshot, SavedDeck, SourceProperty } from './types';
import { usePresentationAccess } from './usePresentationAccess';

import type { Element as SlateElement } from 'slate';

const PresentationStudio = lazy(loadPresentationStudio);
const DocumentPresenter = lazy(loadDocumentPresenter);

/**
 * AI modes present the server's resolved source. Document mode reads its content once; the
 * title and cover stay live, so a rename never reloads or remounts an open presentation.
 */
type SourceRead =
  | { kind: 'server'; snapshot: PageSnapshot }
  | { kind: 'document'; content?: SlateElement; rowTitle?: string; properties?: SourceProperty[] };

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
  const sourceReaders = useRef({ loadView, loadRowDocument });

  sourceReaders.current = { loadView, loadRowDocument };
  const identity = `${workspaceId}:${user?.uid}:${viewId}:${mode}`;
  const [readResult, setReadResult] = useState<{ identity: string; value: SourceRead }>();
  const read = readResult?.identity === identity ? readResult.value : undefined;
  const name = sourceView?.name;
  const sourceTitle = useRef(title || name || 'Untitled');

  sourceTitle.current = title || name || 'Untitled';
  const snapshot = useMemo(
    () =>
      read?.kind === 'document'
        ? snapshotFromSlate(
            viewId,
            // An empty row takes its title from the row, never from a view name.
            title || read.rowTitle || (read.content && name) || 'Untitled',
            read.content,
            isRow,
            read.properties,
            cover
          )
        : read?.snapshot,
    [read, viewId, title, name, isRow, cover]
  );
  const [error, setError] = useState('');
  const [setupPopover, setSetupPopover] = useState(false);
  const { canRead, canWrite, hasLoadedViewActionPermissions } = useViewActionPermissions(view, !!mode, permissionViewId);
  // Only onUpgrade and canManageStyles are used here; the studio reads presentation status itself.
  const access = usePresentationAccess(false);

  const readSource = useCallback(
    async (signal?: AbortSignal): Promise<SourceRead> => {
      if (!canRead) throw new Error('You no longer have access to this source page.');
      if (mode === 'slides') {
        // Saved decks carry their own scene. Prepare current evidence only in the setup panel.
        return {
          kind: 'server',
          snapshot: {
            pageId: viewId,
            title: sourceTitle.current,
            kind: isRow ? 'row' : 'document',
            revision: '',
            blocks: [],
            properties: [],
            warnings: [],
          },
        };
      }

      if (mode !== 'document') {
        if (!workspaceId) throw new Error('Select a workspace before opening presentations.');
        const resolved = await loadSourceSnapshot(workspaceId, viewId, undefined, signal);

        return { kind: 'server', snapshot: isRow ? { ...resolved, kind: 'row' as const } : resolved };
      }

      const activeRow = getActiveRowPage();
      const row = isRow && activeRow?.documentId === viewId ? activeRow : undefined;
      const readers = sourceReaders.current;

      // An empty row has properties and a title but no document to fetch/create.
      if (row && !row.hasDocument) return { kind: 'document', rowTitle: row.title, properties: row.getProperties?.() };
      const doc =
        isRow && readers.loadRowDocument
          ? await readers.loadRowDocument(viewId, {
              requireServerFetch: true,
              rowDocumentSource: row?.source ?? undefined,
            })
          : await readers.loadView(viewId, false, false);

      if (!doc) throw new Error('The document snapshot is not available.');
      const content = yDocToSlateContent(doc);

      if (!content) throw new Error('The source is still loading. Close this preview and try again.');
      return { kind: 'document', content, rowTitle: row?.title, properties: row?.getProperties?.() };
    },
    // Reader callbacks can change as background database rows load. Only the selected source
    // changes this read; callback churn must not cancel and restart expensive preparation.
    [canRead, mode, workspaceId, viewId, isRow]
  );

  useEffect(() => {
    if (!mode || !canRead) return;
    const controller = new AbortController();

    // A refresh for the same identity keeps presenting the previous source until the new one arrives.
    setError('');
    void readSource(controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setReadResult({ identity, value: next });
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setReadResult(undefined);
        setError(e instanceof Error ? e.message : 'Unable to load the source.');
      });
    return () => {
      controller.abort();
    };
  }, [mode, canRead, identity, readSource]);

  useEffect(() => {
    const userId = user?.uid;

    if (mode === 'document' || !workspaceId || !userId) return;
    // The studio can generate decks; the Share panel must list them on its next visit.
    return () => forgetSavedDecks(workspaceId, userId);
  }, [mode, workspaceId, user?.uid]);
  function close() {
    onClose();
  }

  function source(referenceId: string, resolved = snapshot) {
    const location = resolved?.serverSource?.references[referenceId]?.location;

    if (resolved?.serverSource && !location) return;
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

    if (location?.kind === 'database_cell') {
      // Database IDs are not navigable view IDs. Use the authorized prepared view and let
      // the normal database navigation open the row via its row parameter.
      const database = resolved?.serverSource?.databaseViews.find((candidate) =>
        candidate.databaseId === location.databaseId && candidate.rows.some((row) =>
          row.rowId === location.rowId && row.cells[location.fieldId]?.sourceId === referenceId));

      if (!database) return;
      close();
      void toView(database.viewId, location.rowId).catch(() => undefined);
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
      preview={mode === 'slides'}
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
              <PresentationLoading message='Loading presentation…' />
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
        <PresentationLoading message='Loading presentation…' onClose={mode === 'slides' ? undefined : close} />
      )}
    </PresentationShell>
  );
}
