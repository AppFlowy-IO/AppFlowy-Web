import { Tooltip } from '@mui/material';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { PageService } from '@/application/services/domains';
import { ReactComponent as FilledStarIcon } from '@/assets/icons/filled_star.svg';
import { ReactComponent as StarIcon } from '@/assets/icons/star.svg';
import { useAppFavorites, useCurrentWorkspaceId, useRefreshOutline } from '@/components/app/app.hooks';
import { Button } from '@/components/ui/button';

// Matches the desktop behavior: a newly favorited view is auto-pinned only
// while there are fewer than this many pinned favorites.
const MAX_AUTO_PINNED_FAVORITES = 3;

export function FavoriteButton({ viewId }: { viewId: string }) {
  const { t } = useTranslation();
  const workspaceId = useCurrentWorkspaceId();
  const { favoriteViews, loadFavoriteViews } = useAppFavorites();
  const refreshOutline = useRefreshOutline();
  const [submitting, setSubmitting] = useState(false);

  // Cheap derivations over a small favorites list — computed during render
  // rather than memoized (see rerender-simple-expression-in-memo).
  const isFavorite = !!favoriteViews?.some((view) => view.view_id === viewId);
  const pinnedCount = favoriteViews?.filter((view) => view.extra?.is_pinned).length ?? 0;

  const handleToggle = useCallback(async () => {
    if (!workspaceId || submitting) return;
    const next = !isFavorite;

    setSubmitting(true);
    try {
      await PageService.favorite(workspaceId, viewId, next, next && pinnedCount < MAX_AUTO_PINNED_FAVORITES);
      await loadFavoriteViews?.();
      void refreshOutline?.();
      toast.success(next ? t('button.favoriteSuccessfully') : t('button.unfavoriteSuccessfully'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSubmitting(false);
    }
  }, [workspaceId, submitting, isFavorite, viewId, pinnedCount, loadFavoriteViews, refreshOutline, t]);

  return (
    <Tooltip title={isFavorite ? t('disclosureAction.unfavorite') : t('disclosureAction.favorite')}>
      <Button
        data-testid={'favorite-button'}
        aria-pressed={isFavorite}
        size={'icon'}
        variant={'ghost'}
        className={'text-icon-secondary'}
        disabled={submitting}
        onClick={handleToggle}
      >
        {isFavorite ? <FilledStarIcon /> : <StarIcon />}
      </Button>
    </Tooltip>
  );
}

export default FavoriteButton;
