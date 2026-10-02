import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { WorkspaceService } from '@/application/services/domains';
import { Mention, MentionType, ViewLayout } from '@/application/types';
import { useEditorContext } from '@/components/editor/EditorContext';

/** Notify only after the caller has persisted the mention. */
export function useNotifyPersonMention() {
  const { workspaceId, viewId, mentionContext, loadViewMeta } = useEditorContext();
  const { t } = useTranslation();

  return useCallback(
    async (mention: Mention) => {
      if (mention.type !== MentionType.Person || !mention.person_id || !workspaceId) return;

      const targetViewId = mention.page_id || mentionContext?.view_id || viewId;

      if (!targetViewId) return;

      const rowId = mention.row_id || mentionContext?.row_id;
      let viewName = t('menuAppHeader.defaultNewPageName');
      let viewLayout: ViewLayout | undefined;

      try {
        const meta = await loadViewMeta?.(targetViewId);

        viewName = meta?.name || viewName;
        viewLayout = meta?.layout;
      } catch {
        // Keep the stored mention usable even when metadata is unavailable.
      }

      try {
        await WorkspaceService.updatePageMention(workspaceId, targetViewId, {
          person_id: mention.person_id,
          block_id: mention.block_id ?? null,
          row_id: rowId ?? null,
          require_notification: true,
          view_name: viewName,
          view_layout: viewLayout,
          is_row_document: Boolean(rowId),
        });
      } catch (error) {
        console.error('Failed to update page mention:', error);
      }
    },
    [loadViewMeta, mentionContext?.row_id, mentionContext?.view_id, t, viewId, workspaceId]
  );
}
