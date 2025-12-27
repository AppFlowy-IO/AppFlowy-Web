import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { View } from '@/application/types';
import LoadingDots from '@/components/_shared/LoadingDots';
import PageIcon from '@/components/_shared/view-icon/PageIcon';
import { dropdownMenuItemVariants } from '@/components/ui/dropdown-menu';
import { SearchInput } from '@/components/ui/search-input';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

function NoDatabaseSelectedContent ({ views, onSelect, loading }: {
  views: View[];
  loading: boolean;
  onSelect: (view: View) => void
}) {
  const { t } = useTranslation();
  const [searchInput, setSearchInput] = useState('');

  const filteredViews = useMemo(() => {
    if (!searchInput) return views;
    return views.filter((view) =>
      view.name.toLowerCase().includes(searchInput.toLowerCase())
    );
  }, [views, searchInput]);

  const renderView = useCallback((view: View) => {
    return <>
      <PageIcon
        className={'!w-5 !h-5 text-xl flex items-center justify-center'}
        iconSize={20}
        view={view}
      />

      <Tooltip
        disableHoverableContent
        delayDuration={1000}
      >
        <TooltipTrigger asChild>
          <div className={'flex-1 truncate'}>{view.name || t('menuAppHeader.defaultNewPageName')}</div>
        </TooltipTrigger>
        <TooltipContent side={'left'}>
          {view.name}
        </TooltipContent>
      </Tooltip>
    </>;
  }, [t]);

  return (
    <div
      className={'flex flex-col max-h-[450px] max-w-[320px] appflowy-scroller overflow-y-auto outline-none'}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className={'p-2 flex flex-col gap-2'}>
        <div className={'text-sm text-text-secondary'}>
          {t('grid.relation.relatedDatabasePlaceLabel')}
        </div>
        <SearchInput
          autoFocus
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onMouseDown={(e) => e.stopPropagation()}
          placeholder={t('grid.relation.rowSearchTextFieldPlaceholder')}
        />
      </div>

      <Separator />
      <div className={'px-2 min-h-[200px] relative py-1.5 flex flex-col'}>
        {loading &&
          <div className={'absolute flex items-center justify-center top-0 z-10 left-0 w-full h-full bg-surface-primary'}>
            <LoadingDots />
          </div>}
        {!loading && filteredViews.length === 0 && (
          <div className={'flex items-center justify-center h-full text-text-tertiary text-sm'}>
            {t('grid.relation.emptySearchResult')}
          </div>
        )}
        {filteredViews.map((view) => {
          return (
            <button
              key={view.view_id}
              type="button"
              className={dropdownMenuItemVariants({ variant: 'default' })}
              onClick={() => onSelect(view)}
            >
              {renderView(view)}
            </button>
          );
        })}
      </div>

    </div>
  );
}

export default NoDatabaseSelectedContent;