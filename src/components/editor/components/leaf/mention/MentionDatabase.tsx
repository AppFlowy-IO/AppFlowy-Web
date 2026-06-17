import { type MouseEvent, useCallback, useEffect, useState } from 'react';

import { Mention, MentionType } from '@/application/types';
import { ReactComponent as RefPageIcon } from '@/assets/icons/ref_page.svg';
import { useEditorContext } from '@/components/editor/EditorContext';

function getDisplayText(mention: Mention) {
  const title = mention.data?.title;

  if (typeof title === 'string' && title.length > 0) {
    return title;
  }

  return mention.row_id ?? mention.database_row_id ?? mention.database_id ?? 'Database';
}

function MentionDatabase({ mention }: { mention: Mention }) {
  const { navigateToView, getViewIdFromDatabaseId } = useEditorContext();
  const databaseId = mention.database_id;
  const databaseViewId = mention.database_view_id || mention.page_id;
  const [resolvedViewId, setResolvedViewId] = useState<string | undefined>(databaseViewId);
  const content = getDisplayText(mention);
  const isRowMention = mention.type === MentionType.DatabaseRow || Boolean(mention.row_id || mention.database_row_id);
  const targetRowId = isRowMention ? mention.row_id ?? mention.database_row_id : undefined;
  const canNavigate = Boolean(resolvedViewId);

  useEffect(() => {
    setResolvedViewId(databaseViewId);
  }, [databaseId, databaseViewId]);

  useEffect(() => {
    if (databaseViewId || !databaseId || !getViewIdFromDatabaseId) return;

    let cancelled = false;

    void getViewIdFromDatabaseId(databaseId)
      .then((viewId) => {
        if (!cancelled) {
          setResolvedViewId(viewId ?? undefined);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResolvedViewId(undefined);
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
        void navigateToView?.(resolvedViewId, targetRowId);
      }, 0);
    },
    [navigateToView, resolvedViewId, targetRowId]
  );

  return (
    <span
      onClick={handleClick}
      className={`mention-inline select-none pr-1 underline ${canNavigate ? 'cursor-pointer' : 'cursor-default'}`}
      contentEditable={false}
      data-mention-id={targetRowId ?? databaseId}
    >
      <span className={'mention-icon'}>
        <RefPageIcon className={'h-[1.25em] w-[1.25em] text-text-primary'} />
      </span>
      <span className={'mention-content max-w-[330px] truncate opacity-80'}>{content}</span>
    </span>
  );
}

export default MentionDatabase;
