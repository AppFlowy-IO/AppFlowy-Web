import { debounce } from 'lodash-es';
import { type MouseEvent, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useInRouterContext, useNavigate } from 'react-router-dom';

import { AppNavigationContext } from '@/components/app/contexts/AppNavigationContext';
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
  const navigation = useContext(AppNavigationContext);
  const { t } = useTranslation();

  const openTrash = () => {
    // The app provider (and its page modal) survives workspace navigation.
    navigation?.closePageModal?.();
    navigate('/app/trash');
  };

  return <Button size='sm' onClick={openTrash}>{t('document.mention.openTrash')}</Button>;
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
  const contentRef = useRef<HTMLDivElement>(null);
  const openedByHover = useRef(false);
  const showOnHover = useMemo(() => debounce(() => {
    openedByHover.current = true;
    setCanOpenTrash(false);
    setOpen(true);
  }, 120), []);
  const hideAfterHover = useMemo(() => debounce(() => {
    // A keyboard user may still be interacting with a popup action after the
    // pointer leaves. Blur or an explicit dismissal closes that popup instead.
    if (!contentRef.current?.contains(document.activeElement)) setOpen(false);
  }, 240), []);

  useEffect(() => () => {
    showOnHover.cancel();
    hideAfterHover.cancel();
  }, [hideAfterHover, showOnHover]);

  const enterReference = (event: MouseEvent) => {
    if (event.buttons > 0) return;
    hideAfterHover.cancel();
    if (!open) showOnHover();
  };

  const leaveReference = () => {
    showOnHover.cancel();
    hideAfterHover();
  };

  const retryPage = () => {
    showOnHover.cancel();
    hideAfterHover.cancel();
    setOpen(false);
    retry();
  };

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
        showOnHover.cancel();
        hideAfterHover.cancel();
        setCanOpenTrash(false);
        setOpen(nextOpen);
      }}>
        <PopoverTrigger asChild>
          <button
            type='button'
            className='mention-unpublished min-w-0 cursor-pointer truncate font-semibold text-text-secondary underline'
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={enterReference}
            onMouseLeave={leaveReference}
            onClick={() => { openedByHover.current = false; }}
          >
            {t(labels[error])}
          </button>
        </PopoverTrigger>
        <PopoverContent
          ref={contentRef}
          role='dialog'
          aria-label={t(labels[error])}
          data-reference-page-id={pageId}
          align='start'
          className='max-w-[min(320px,90vw)] space-y-3 p-4 text-sm text-text-primary'
          onOpenAutoFocus={(event) => { if (openedByHover.current) event.preventDefault(); }}
          onCloseAutoFocus={(event) => { if (openedByHover.current) event.preventDefault(); }}
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onMouseEnter={() => hideAfterHover.cancel()}
          onMouseLeave={leaveReference}
          onFocusCapture={() => hideAfterHover.cancel()}
          onBlurCapture={leaveReference}
        >
          <p>{t(descriptions[error])}</p>
          {error === 'in_trash' && canOpenTrash && <OpenTrashButton />}
          {error === 'load_failed' && (
            <Button size='sm' disabled={loading} aria-busy={loading} onClick={retryPage}>
              {t('button.retry')}
            </Button>
          )}
        </PopoverContent>
      </Popover>
      {error === 'load_failed' && (
        <button
          type='button'
          className='ml-2 shrink-0 cursor-pointer text-text-action underline disabled:cursor-wait disabled:opacity-50'
          disabled={loading}
          aria-busy={loading}
          onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
          onClick={(event) => { event.stopPropagation(); retryPage(); }}
        >
          {t('button.retry')}
        </button>
      )}
    </>
  );
}
