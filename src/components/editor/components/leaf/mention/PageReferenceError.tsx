import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useInRouterContext, useNavigate } from 'react-router-dom';

import type { EditorContextState } from '@/components/editor/EditorContext';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

import type { ReferenceError } from './usePageReferenceMetadata';

const labels = {
  not_found: 'document.mention.pageNotFound',
  deleted: 'document.mention.pageNotFound',
  in_trash: 'document.mention.pageInTrash',
  denied: 'document.mention.noAccess',
  unauthorized: 'landingPage.unauthorized.title',
  load_failed: 'document.mention.loadFailed',
} as const;

const descriptions = {
  not_found: 'document.mention.pageNotFoundDescription',
  deleted: 'document.mention.pageNotFoundDescription',
  in_trash: 'document.mention.pageInTrashDescription',
  denied: 'document.mention.noAccessDescription',
  unauthorized: 'landingPage.unauthorized.description',
  load_failed: 'document.mention.loadFailedDescription',
} as const;

function OpenTrashButton() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return <Button size='sm' onClick={() => navigate('/app/trash')}>{t('document.mention.openTrash')}</Button>;
}

export function PageReferenceError({
  pageId,
  error,
  loading,
  retry,
  loadTrashViews,
}: {
  pageId: string;
  error: ReferenceError;
  loading: boolean;
  retry: () => void;
  loadTrashViews?: EditorContextState['loadTrashViews'];
}) {
  const { t } = useTranslation();
  const inRouter = useInRouterContext();
  const [open, setOpen] = useState(false);
  const [canOpenTrash, setCanOpenTrash] = useState(false);

  useEffect(() => {
    if (!open || error !== 'in_trash' || !inRouter || !loadTrashViews) return;
    let current = true;

    // The Trash list is filtered by the server. A reference alone does not
    // establish that this viewer can open its target in Trash.
    void loadTrashViews().then((views) => {
      if (current) setCanOpenTrash(views.some((view) => view.view_id === pageId));
    }).catch(() => {
      if (current) setCanOpenTrash(false);
    });
    return () => { current = false; };
  }, [error, inRouter, loadTrashViews, open, pageId]);

  return (
    <>
      <Popover open={open} onOpenChange={(nextOpen) => {
        setCanOpenTrash(false);
        setOpen(nextOpen);
      }}>
        <PopoverTrigger asChild>
          <button
            type='button'
            className='mention-unpublished min-w-0 cursor-pointer truncate font-semibold text-text-secondary underline'
            onMouseDown={(event) => event.preventDefault()}
          >
            {t(labels[error])}
          </button>
        </PopoverTrigger>
        <PopoverContent
          role='dialog'
          aria-label={t(labels[error])}
          align='start'
          className='max-w-[min(320px,90vw)] space-y-3 p-4 text-sm text-text-primary'
          onClick={(event) => event.stopPropagation()}
        >
          <p>{t(descriptions[error])}</p>
          {error === 'in_trash' && canOpenTrash && <OpenTrashButton />}
        </PopoverContent>
      </Popover>
      {error === 'load_failed' && (
        <button
          type='button'
          className='ml-2 shrink-0 cursor-pointer text-text-action underline disabled:cursor-wait disabled:opacity-50'
          disabled={loading}
          aria-busy={loading}
          onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
          onClick={(event) => { event.stopPropagation(); retry(); }}
        >
          {t('button.retry')}
        </button>
      )}
    </>
  );
}
