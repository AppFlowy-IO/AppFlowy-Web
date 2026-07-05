import { type MouseEvent, useCallback, useEffect, useState } from 'react';

import { ReactComponent as RefPageIcon } from '@/assets/icons/ref_page.svg';
import { useEditorContext } from '@/components/editor/EditorContext';

interface MentionDatabaseProps {
  databaseId?: string;
  databaseViewId?: string;
  rowId?: string;
  title?: string;
}

function MentionDatabase({ databaseId, databaseViewId, rowId, title }: MentionDatabaseProps) {
  const { navigateToView, getViewIdFromDatabaseId } = useEditorContext();
  // Keyed by databaseId so a stale fetch result is never applied to a
  // different database's mention.
  const [fetchedView, setFetchedView] = useState<{ databaseId: string; viewId?: string } | null>(null);
  const resolvedViewId =
    databaseViewId || (fetchedView && fetchedView.databaseId === databaseId ? fetchedView.viewId : undefined);
  const content = title || rowId || databaseId || 'Database';
  const canNavigate = Boolean(resolvedViewId);

  useEffect(() => {
    if (databaseViewId || !databaseId || !getViewIdFromDatabaseId) return;

    let cancelled = false;

    void getViewIdFromDatabaseId(databaseId)
      .then((viewId) => {
        if (!cancelled) {
          setFetchedView({ databaseId, viewId: viewId ?? undefined });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFetchedView({ databaseId, viewId: undefined });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [databaseId, databaseViewId, getViewIdFromDatabaseId]);

  const handleClick = useCallback(
    (event: MouseEvent<HTMLSpanElement>) => {
      event.stopPropagation();
      if (!resolvedViewId) return;

      setTimeout(() => {
        void navigateToView?.(resolvedViewId, rowId);
      }, 0);
    },
    [navigateToView, resolvedViewId, rowId]
  );

  return (
    <span
      onClick={handleClick}
      className={`mention-inline select-none pr-1 underline ${canNavigate ? 'cursor-pointer' : 'cursor-default'}`}
      contentEditable={false}
      data-mention-id={rowId ?? databaseId}
    >
      <span className={'mention-icon'}>
        <RefPageIcon className={'h-[1.25em] w-[1.25em] text-text-primary'} />
      </span>
      <span className={'mention-content max-w-[330px] truncate opacity-80'}>{content}</span>
    </span>
  );
}

export default MentionDatabase;
