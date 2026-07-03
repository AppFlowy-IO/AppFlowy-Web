import { Tooltip } from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { PageService } from '@/application/services/domains';
import { ReactComponent as FilledStarIcon } from '@/assets/icons/filled_star.svg';
import { ReactComponent as StarIcon } from '@/assets/icons/star.svg';
import { useAppFavorites, useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { Button } from '@/components/ui/button';

export function FavoriteButton({ viewId }: { viewId: string }) {
  const { t } = useTranslation();
  const workspaceId = useCurrentWorkspaceId();
  const { favoriteViews, loadFavoriteViews } = useAppFavorites();
  const [submitting, setSubmitting] = useState(false);
  // Holds the toggled value while a request is in flight so the icon flips
  // immediately; reset to null once the server state (favoriteViews) catches up.
  const [optimisticFavorite, setOptimisticFavorite] = useState<boolean | null>(null);

  // `favoriteViews` is undefined until the list has been fetched. It is loaded
  // lazily by the sidebar's Favorites section, which may not be mounted (e.g.
  // collapsed/hidden sidebar) — so the button can't rely on it being populated.
  // Self-load when unknown so the real favorite state is always available here.
  const favoritesLoaded = favoriteViews !== undefined;

  useEffect(() => {
    if (!favoritesLoaded) void loadFavoriteViews?.();
  }, [favoritesLoaded, loadFavoriteViews]);

  // Cheap derivations over a small favorites list — computed during render
  // rather than memoized (see rerender-simple-expression-in-memo).
  const serverFavorite = !!favoriteViews?.some((view) => view.view_id === viewId);
  const isFavorite = optimisticFavorite ?? serverFavorite;

  const handleToggle = useCallback(async () => {
    // Don't toggle against unknown state: undefined favorites would read as
    // "not favorited" and wrongly re-favorite an already-favorited page.
    if (!workspaceId || !favoritesLoaded) return;
    const next = !isFavorite;

    setSubmitting(true);
    setOptimisticFavorite(next);
    try {
      await PageService.favorite(workspaceId, viewId, next, next);
      // Refresh only the favorites list — favoriting doesn't change the outline
      // tree, so a full outline reload would be wasted work.
      await loadFavoriteViews?.();
      toast.success(next ? t('button.favoriteSuccessfully') : t('button.unfavoriteSuccessfully'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      toast.error(e?.message ?? t('error.generalError'));
    } finally {
      // Drop the optimistic override; render falls back to the refreshed server state.
      setOptimisticFavorite(null);
      setSubmitting(false);
    }
  }, [workspaceId, favoritesLoaded, isFavorite, viewId, loadFavoriteViews, t]);

  return (
    <Tooltip title={isFavorite ? t('disclosureAction.unfavorite') : t('disclosureAction.favorite')}>
      <Button
        data-testid={'favorite-button'}
        aria-pressed={isFavorite}
        aria-label={isFavorite ? t('disclosureAction.unfavorite') : t('disclosureAction.favorite')}
        size={'icon'}
        variant={'ghost'}
        className={'text-icon-secondary'}
        disabled={submitting || !favoritesLoaded}
        onClick={handleToggle}
      >
        {isFavorite ? <FilledStarIcon /> : <StarIcon />}
      </Button>
    </Tooltip>
  );
}

export default FavoriteButton;
