import { useEffect, useState } from 'react';

import { useAppView, useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { useViewActionPermissions } from '@/components/app/view-actions/useViewActionPermissions';
import { useCurrentUserOptional } from '@/components/main/app.hooks';
import { Button } from '@/components/ui/button';

import { listSavedDecks } from './presentation-client';

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
  const workspaceId = useCurrentWorkspaceId();
  const view = useAppView(permissionViewId);
  const { canRead, canWrite } = useViewActionPermissions(view, true, permissionViewId);
  const identity = `${workspaceId}:${user?.uid}:${viewId}`;
  const [result, setResult] = useState<{ identity: string; decks: SavedDeck[]; error?: string }>();
  const [reload, setReload] = useState(0);

  useEffect(() => {
    setResult(undefined);
    if (!canRead || !workspaceId) return;
    const controller = new AbortController();

    void listSavedDecks({ workspaceId, pageId: viewId }, controller.signal)
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
  }, [canRead, workspaceId, viewId, identity, reload]);
  const current = canRead && result?.identity === identity ? result : undefined;

  return (
    <div className='flex flex-col items-start gap-3 p-4'>
      <h3 className='text-sm font-medium'>A great presentation starts here.</h3>
      <p className='text-xs text-text-secondary'>
        Turn this page into a presentation. Choose a style, preview your deck, and download editable slides.
      </p>
      <Button size='sm' disabled={!canWrite || !workspaceId} onClick={() => onOpen()}>
        Create AI Slides
      </Button>
      {canRead && (
        <section className='flex w-full flex-col gap-3' aria-label='Workspace presentations'>
          <h4 className='text-sm font-medium'>Workspace presentations</h4>
          {!current && <p role='status'>Loading saved presentations…</p>}
          {current?.decks.map((deck) => (
            <div key={deck.id} className='flex flex-col gap-2'>
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
                    onClick={() => onOpen(deck, action)}
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
              <Button size='sm' variant='outline' onClick={() => setReload((value) => value + 1)}>
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
