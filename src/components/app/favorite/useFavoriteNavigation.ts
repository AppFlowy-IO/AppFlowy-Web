import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { getRowDocumentSourceFromView } from '@/application/row-document/lifecycle';
import { ViewService } from '@/application/services/domains';
import { View } from '@/application/types';
import { isDatabaseContainer } from '@/application/view-utils';
import { useCurrentWorkspaceIdOptional, useToView } from '@/components/app/app.hooks';
import { DATABASE_TAB_VIEW_ID_QUERY_PARAM } from '@/components/app/hooks/resolveSidebarSelectedViewId';
import { Log } from '@/utils/log';

/**
 * Favorite row documents are orphaned views, so they must be routed through
 * their containing database instead of being opened as standalone documents.
 */
export function useFavoriteNavigation(favoriteViews?: View[]) {
  const toView = useToView();
  const navigate = useNavigate();
  const workspaceId = useCurrentWorkspaceIdOptional();

  return useCallback(
    async (targetViewId: string) => {
      const view = favoriteViews?.find((item) => item.view_id === targetViewId);
      const rowDocumentSource = getRowDocumentSourceFromView(view);

      if (!rowDocumentSource) {
        await toView(targetViewId);
        return;
      }

      const { database_view_id, row_id } = rowDocumentSource;

      if (workspaceId) {
        try {
          const concreteView = await ViewService.get(workspaceId, database_view_id);
          const parentId = concreteView?.parent_view_id;
          const parent = parentId && parentId !== database_view_id ? await ViewService.get(workspaceId, parentId) : null;

          if (parent && isDatabaseContainer(parent)) {
            navigate(
              `/app/${workspaceId}/${parent.view_id}?${DATABASE_TAB_VIEW_ID_QUERY_PARAM}=${database_view_id}&r=${row_id}`
            );
            return;
          }
        } catch (e) {
          Log.debug('[Favorite] failed to resolve container for row-page favorite', { targetViewId, error: e });
        }
      }

      await toView(database_view_id, row_id);
    },
    [favoriteViews, navigate, toView, workspaceId]
  );
}
