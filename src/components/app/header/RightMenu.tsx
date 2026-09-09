import { Divider, Tooltip } from '@mui/material';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import { ensureRowDocumentView, syncRowDocumentViewName } from '@/application/row-document/lifecycle';
import { useActiveRowPage } from '@/application/row-document/row-page-state';
import { isDatabaseContainer } from '@/application/view-utils';
import { findView } from '@/components/_shared/outline/utils';
import { useAppOutline, useAppView, useAppViewId, useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { ReactComponent as Logo } from '@/assets/icons/logo.svg';
import { InlineCommentToggleButton } from '@/components/inline-comment/InlineCommentToggleButton';
import { openOrDownload } from '@/utils/open_schema';

import ShareButton from 'src/components/app/share/ShareButton';

import FavoriteButton from './FavoriteButton';
import MoreActions from './MoreActions';
import { Users } from './Users';

function RightMenu() {
  const { t } = useTranslation();
  const routeViewId = useAppViewId();
  const outline = useAppOutline();
  const routeView = useAppView(routeViewId);
  const workspaceId = useCurrentWorkspaceId();
  const [searchParams] = useSearchParams();
  const hasRowPageRoute = searchParams.has('r');
  const rowPageRowId = searchParams.get('r');
  const activeRowPage = useActiveRowPage();
  const actionViewId = useMemo(() => {
    if (!routeViewId || !routeView?.parent_view_id) {
      return routeViewId;
    }

    const parentView = findView(outline || [], routeView.parent_view_id);

    return parentView && isDatabaseContainer(parentView) ? parentView.view_id : routeViewId;
  }, [outline, routeView?.parent_view_id, routeViewId]);

  // On a full-page row (?r=), the favorite action targets the row document,
  // not the containing database.
  const rowPage = rowPageRowId && activeRowPage?.rowId === rowPageRowId ? activeRowPage : null;
  const prepareRowDocumentForFavorite = useCallback(async () => {
    if (!rowPage?.documentId || !workspaceId) return;

    if (rowPage.source) {
      await ensureRowDocumentView(workspaceId, rowPage.documentId, rowPage.source);
    }

    const name = rowPage.title.trim();

    if (name) {
      await syncRowDocumentViewName(workspaceId, rowPage.documentId, name);
    }
  }, [rowPage, workspaceId]);

  // While a row route is loading, do not fall back to the containing database:
  // a click in that window would favorite the wrong object.
  const favoriteViewId = hasRowPageRoute ? rowPage?.documentId : actionViewId;

  return (
    <div className={'flex items-center gap-2'}>
      <Users viewId={routeViewId} />
      {/* Access control belongs to the database container, but Desktop publishes the active child view. */}
      {actionViewId ? (
        <ShareButton viewId={actionViewId} publishViewId={routeViewId} hidePublish={hasRowPageRoute} />
      ) : null}
      <InlineCommentToggleButton />
      {favoriteViewId && (
        <FavoriteButton viewId={favoriteViewId} beforeToggle={rowPage ? prepareRowDocumentForFavorite : undefined} />
      )}
      {actionViewId && <MoreActions viewId={actionViewId} />}

      <Divider orientation={'vertical'} className={'mx-2'} flexItem />
      <Tooltip title={t('publish.downloadApp')}>
        <button onClick={() => openOrDownload()}>
          <Logo className={'h-6 w-6'} />
        </button>
      </Tooltip>
    </div>
  );
}

export default RightMenu;
