import { useEffect, useRef, useState } from 'react';

import { useAppView, useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { useViewActionPermissions } from '@/components/app/view-actions/useViewActionPermissions';
import { useCurrentUserOptional } from '@/components/main/app.hooks';
import { Button } from '@/components/ui/button';

import { loadSavedDeck } from './presentation-client';
import { preloadPresentation } from './presentation-preload';
import { cachedSavedDecks, forgetSavedDecks, listCachedSavedDecks } from './saved-deck-cache';

import type { DeckAction, SavedDeck, SavedDeckSummary } from './types';

export default function AISlidesSharePanel({
  viewId,
  permissionViewId = viewId,
  onOpen,
}: {
  viewId: string;
  title?: string;
  isRow?: boolean;
  permissionViewId?: string;
  onOpen: (deck?: SavedDeck, action?: DeckAction) => void;
}) {
  const user = useCurrentUserOptional();
  const userId = user?.uid;
  const workspaceId = useCurrentWorkspaceId();
  const view = useAppView(permissionViewId);
  const { canRead, canWrite } = useViewActionPermissions(view, true, permissionViewId);
  const identity = `${workspaceId}:${userId}:${viewId}`;
  const [result, setResult] = useState<{ identity: string; decks: SavedDeckSummary[]; error?: string }>();
  const [reload, setReload] = useState(0);
  const opening = useRef<AbortController>();
  const [selection, setSelection] = useState<{ identity: string; id: string; pending: boolean; error?: string }>();

  useEffect(() => {
    setSelection(undefined);
    return () => {
      opening.current?.abort();
      opening.current = undefined;
    };
  }, [identity, canRead]);

  useEffect(() => {
    setResult(undefined);
    if (!canRead || !workspaceId || !userId) return;
    // The panel lists the workspace catalog, not this page's decks, so any page reuses a recent list.
    const cached = cachedSavedDecks(workspaceId, userId);

    if (cached) {
      setResult({ identity, decks: cached });
      return;
    }

    const controller = new AbortController();

    void listCachedSavedDecks({ workspaceId, pageId: viewId }, userId, controller.signal)
      .then((decks) => {
        if (!controller.signal.aborted) setResult({ identity, decks });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setResult({
            identity,
            decks: [],
            error: error instanceof Error ? error.message : 'Unable to load presentations.',
          });
      });
    return () => controller.abort();
  }, [canRead, workspaceId, userId, viewId, identity, reload]);
  const current = canRead && result?.identity === identity ? result : undefined;
  const selected = canRead && selection?.identity === identity ? selection : undefined;
  const open = async (summary?: SavedDeckSummary, action?: DeckAction) => {
    if (opening.current || !workspaceId || !userId || !canRead) return;
    // The share button loads the dialog chunk; start the studio chunk alongside it.
    preloadPresentation('slides');
    if (!summary) {
      onOpen(undefined, action);
      return;
    }

    const controller = new AbortController();

    opening.current = controller;
    setSelection({ identity, id: summary.id, pending: true });
    try {
      const deck = await loadSavedDeck({ workspaceId, pageId: viewId }, summary.id, summary.version, controller.signal);

      if (!controller.signal.aborted) onOpen(deck, action);
    } catch (error) {
      if (!controller.signal.aborted)
        setSelection({ identity, id: summary.id, pending: false, error: error instanceof Error ? error.message : 'Unable to open this presentation.' });
    } finally {
      if (opening.current === controller) {
        opening.current = undefined;
        setSelection((previous) => previous && { ...previous, pending: false });
      }
    }
  };

  return (
    <div className='flex flex-col items-start gap-3 p-4'>
      <h3 className='text-sm font-medium'>A great presentation starts here.</h3>
      <p className='text-xs text-text-secondary'>
        Turn this page into a presentation. Choose a style, preview your deck, and download editable slides.
      </p>
      <Button size='sm' disabled={!canWrite || !workspaceId || selected?.pending} onClick={() => void open()}>
        Create AI Slides
      </Button>
      {canRead && (
        <section className='flex w-full flex-col gap-3' aria-label='Workspace presentations'>
          <h4 className='text-sm font-medium'>Workspace presentations</h4>
          {!current && <p role='status'>Loading saved presentations…</p>}
          {selected?.pending && <p role='status'>Opening presentation…</p>}
          {current?.decks.map((deck) => (
            <div key={deck.id} data-artifact-id={deck.id} className='flex flex-col gap-2'>
              <p className='truncate text-sm'>{deck.title ?? 'Saved presentation'}</p>
              <p className='text-xs text-text-secondary'>
                {deck.slideCount !== undefined && `${deck.slideCount} slides · `}{new Date(deck.createdAt).toLocaleString()}
              </p>
              {(deck.error || (selected?.id === deck.id && selected.error)) && (
                <p role='alert'>{(selected?.id === deck.id && selected.error) || deck.error}</p>
              )}
              <div className='flex flex-wrap gap-2'>
                {(['preview', 'present', 'download'] as const).map((action) => (
                  <Button
                    key={action}
                    size='sm'
                    variant='outline'
                    disabled={selected?.pending || (action === 'download' && !canWrite)}
                    onClick={() => void open(deck, action)}
                  >
                    {action === 'preview' ? 'Preview' : action === 'present' ? 'Present' : 'Download'}
                  </Button>
                ))}
              </div>
            </div>
          ))}
          {current && !current.error && !current.decks.length && (
            <p className='text-xs text-text-secondary'>No saved presentations yet.</p>
          )}
          {current?.error && (
            <>
              <p role='alert'>{current.error}</p>
              <Button
                size='sm'
                variant='outline'
                onClick={() => {
                  if (workspaceId && userId) forgetSavedDecks(workspaceId, userId);
                  setReload((value) => value + 1);
                }}
              >
                Retry
              </Button>
            </>
          )}
        </section>
      )}
      <p className='text-xs text-text-tertiary'>
        Shows up to 30 authorized workspace presentations. Creating slides does not publish your page.
      </p>
    </div>
  );
}
