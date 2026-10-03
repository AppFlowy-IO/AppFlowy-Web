import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { WorkspaceService } from '@/application/services/domains';
import { Mention, MentionType, ViewLayout } from '@/application/types';
import { notify } from '@/components/_shared/notify';
import { useEditorContext } from '@/components/editor/EditorContext';
import { useCurrentUserOptional } from '@/components/main/app.hooks';

import { getSendMentionNotification } from './mention-notification-preference';

export interface CellMentionTarget {
  viewId: string;
  rowId: string;
  rowTitle: string;
}

export function mentionNotificationTitle(title: string, placeholder: string): string {
  const text = title.replace(/\r\n|\r|\n/g, ' ').trim();

  if (!text) return placeholder;
  if (text.length <= 256) return text;
  let prefix = '';

  for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
    if (prefix.length + segment.length > 255) break;
    prefix += segment;
  }

  return `${prefix}…`;
}

/** Notify only after the caller has persisted the mention. */
export function useNotifyPersonMention() {
  const { workspaceId, viewId, mentionContext, loadViewMeta } = useEditorContext();
  const { t } = useTranslation();
  const currentUserId = useCurrentUserOptional()?.uuid;

  return useCallback(
    async (
      mention: Mention,
      requireNotification = getSendMentionNotification(),
      cell?: CellMentionTarget
    ): Promise<boolean> => {
      if (mention.type !== MentionType.Person || !mention.person_id || !workspaceId || !currentUserId) return false;
      if (mention.person_id.trim().toLowerCase() === currentUserId.trim().toLowerCase()) return false;

      const targetViewId = cell?.viewId || mention.page_id || mentionContext?.view_id || viewId;

      if (!targetViewId) return false;

      const rowId = cell?.rowId || mention.row_id || mentionContext?.row_id;
      let viewName = t('menuAppHeader.defaultNewPageName');
      let viewLayout: ViewLayout | undefined;

      try {
        const meta = await loadViewMeta?.(targetViewId);

        viewName = meta?.name || viewName;
        viewLayout = meta?.layout;
      } catch {
        // Keep the stored mention usable even when metadata is unavailable.
      }

      if (cell) viewName = mentionNotificationTitle(cell.rowTitle, t('menuAppHeader.defaultNewPageName'));

      try {
        await WorkspaceService.updatePageMention(workspaceId, targetViewId, {
          person_id: mention.person_id,
          block_id: cell ? null : mention.block_id || null,
          row_id: rowId ?? null,
          require_notification: requireNotification,
          view_name: viewName,
          view_layout: viewLayout,
          is_row_document: cell ? false : Boolean(rowId),
        });
        return true;
      } catch (error) {
        console.error('Failed to update page mention:', error);
        if (requireNotification)
          notify.error(
            t('document.mentionMenu.notifedToFailed', 'Unable to send the notification due to network error')
          );
        return false;
      }
    },
    [currentUserId, loadViewMeta, mentionContext?.row_id, mentionContext?.view_id, t, viewId, workspaceId]
  );
}
