import { useEffect, useState } from 'react';

import { useAppView, useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { useViewActionPermissions } from '@/components/app/view-actions/useViewActionPermissions';
import { useCurrentUserOptional } from '@/components/main/app.hooks';
import { Button } from '@/components/ui/button';

import { preloadPresentation } from './presentation-preload';
import { cachedSavedDecks, forgetSavedDecks, listCachedSavedDecks } from './saved-deck-cache';

import type { DeckAction, SavedDeck } from './types';

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
  const [result, setResult] = useState<{ identity: string; decks: SavedDeck[]; error?: string }>();
  const [reload, setReload] = useState(0);

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
  const open = (deck?: SavedDeck, action?: DeckAction) => {
    // The share button loads the dialog chunk; start the studio chunk alongside it.
    preloadPresentation('slides');
    onOpen(deck, action);
  };

  return (
    <div className='flex flex-col items-start gap-3 p-4'>
      <h3 className='text-sm font-medium'>A great presentation starts here.</h3>
      <p className='text-xs text-text-secondary'>
        Turn this page into a presentation. Choose a style, preview your deck, and download editable slides.
      </p>
      <Button size='sm' disabled={!canWrite || !workspaceId} onClick={() => open()}>
        Create AI Slides
      </Button>
      {canRead && (
        <section className='flex w-full flex-col gap-3' aria-label='Workspace presentations'>
          <h4 className='text-sm font-medium'>Workspace presentations</h4>
          {!current && <p role='status'>Loading saved presentations…</p>}
          {current?.decks.map((deck) => (
            <div key={deck.id} data-artifact-id={deck.id} className='flex flex-col gap-2'>
              <p className='truncate text-sm'>{deck.plan.title}</p>
              <p className='text-xs text-text-secondary'>
                {deck.plan.slides.length} slides · {deck.style.name} · {new Date(deck.createdAt).toLocaleString()}
              </p>
              <div className='flex flex-wrap gap-2'>
                {(['preview', 'present', 'download'] as const).map((action) => (
                  <Button
                    key={action}
                    size='sm'
                    variant='outline'
                    disabled={action === 'download' && !canWrite}
                    onClick={() => open(deck, action)}
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
