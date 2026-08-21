import { type MouseEvent, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getRowDocumentSourceFromView } from '@/application/row-document/lifecycle';
import { ViewService } from '@/application/services/domains';
import { ReactComponent as RefPageIcon } from '@/assets/icons/ref_page.svg';
import { notify } from '@/components/_shared/notify';
import { useEditorContext } from '@/components/editor/EditorContext';

interface MentionDatabaseProps {
  databaseId?: string;
  databaseViewId?: string;
  rowId?: string;
  rowDocumentId?: string;
  title?: string;
}

function MentionDatabase({ databaseId, databaseViewId, rowId, rowDocumentId, title }: MentionDatabaseProps) {
  const { navigateToView, getViewIdFromDatabaseId, workspaceId } = useEditorContext();
  const { t } = useTranslation();
  // Keyed by the fallback inputs so a stale fetch result is never applied to
  // a different mention's ids.
  const fallbackKey = `${databaseId ?? ''}:${rowDocumentId ?? ''}`;
  const [fetchedView, setFetchedView] = useState<{ key: string; viewId?: string } | null>(null);
  const resolvedViewId =
    databaseViewId || (fetchedView && fetchedView.key === fallbackKey ? fetchedView.viewId : undefined);
  const content = title || rowId || databaseId || 'Database';
  const canNavigate = Boolean(resolvedViewId);

  useEffect(() => {
    if (databaseViewId || (!databaseId && !rowDocumentId)) return;

    let cancelled = false;

    const resolve = async () => {
      let viewId: string | undefined;

      if (databaseId && getViewIdFromDatabaseId) {
        try {
          viewId = (await getViewIdFromDatabaseId(databaseId)) ?? undefined;
        } catch {
          // fall through to the row-document fallback
        }
      }

      // Desktop-parity fallback: mentions written without a database view id
      // can still resolve through the materialized row-document view, whose
      // extra carries the source database_view_id.
      if (!viewId && rowDocumentId && workspaceId) {
        try {
          const view = await ViewService.get(workspaceId, rowDocumentId);

          viewId = getRowDocumentSourceFromView(view)?.database_view_id;
        } catch {
          // leave unresolved; the chip renders non-clickable
        }
      }

      if (!cancelled) {
        setFetchedView({ key: fallbackKey, viewId });
      }
    };

    void resolve();

    return () => {
      cancelled = true;
    };
  }, [databaseId, databaseViewId, fallbackKey, getViewIdFromDatabaseId, rowDocumentId, workspaceId]);

  const handleClick = useCallback(
    (event: MouseEvent<HTMLSpanElement>) => {
      event.stopPropagation();
      if (!resolvedViewId) return;

      setTimeout(() => {
        void Promise.resolve(navigateToView?.(resolvedViewId, rowId)).catch(() => {
          notify.error(t('chat.openPagePreviewFailedToast'));
        });
      }, 0);
    },
    [navigateToView, resolvedViewId, rowId, t]
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
