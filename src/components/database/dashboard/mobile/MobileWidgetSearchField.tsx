import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { ReactComponent as SearchIcon } from '@/assets/icons/search.svg';
import { DATABASE_SEARCH_DEBOUNCE_MS } from '@/components/database/components/conditions/DatabaseSearchAction';
import { useDatabaseSearch } from '@/components/database/components/conditions/DatabaseSearchContext';
import { cn } from '@/lib/utils';

import { useWidgetContext } from '../WidgetContext';

import { MOBILE_TOOL_HIT_AREA_CLASS } from './constants';

/**
 * The phone's widget search (WP14 §1.4.5): WP09's search in a field that
 * takes the header's width in place of the title. 32px tall, a 16px glyph,
 * 16px text (no zoom on iOS) and a clear button. Typing commits the trimmed
 * query after 300 ms; Escape, the clear button or leaving it empty clears the
 * search and gives the title back, while a query keeps it open. It is never a
 * sheet: the keyboard would hide the results.
 */
export function MobileWidgetSearchField({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { setSearchActive } = useWidgetContext();
  const { query, setQuery, clearToken } = useDatabaseSearch();
  const [inputValue, setInputValue] = useState(query);
  const handledClearTokenRef = useRef(clearToken);

  // "Clear search" (the empty state) cleared the query: give the title back.
  useEffect(() => {
    if (handledClearTokenRef.current === clearToken) return;
    handledClearTokenRef.current = clearToken;
    setInputValue('');
    setSearchActive(false);
  }, [clearToken, setSearchActive]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setQuery(inputValue.trim()), DATABASE_SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timeout);
  }, [inputValue, setQuery]);

  const closeSearch = () => {
    setInputValue('');
    setQuery('');
    setSearchActive(false);
  };

  return (
    <div
      className={cn(
        'flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-200 border border-border-primary bg-fill-content px-2',
        className
      )}
      // The typed text is the committed query (the debounce has elapsed): tests wait on it.
      data-committed={inputValue.trim() === query ? 'true' : 'false'}
      data-mobile='true'
      data-search-active='true'
      data-testid='database-actions-search-field'
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null) && !inputValue.trim()) closeSearch();
      }}
      onClick={(event) => event.stopPropagation()}
      role='search'
    >
      <SearchIcon aria-hidden='true' className='h-4 w-4 shrink-0 text-icon-secondary' />
      <input
        aria-label={t('search.label')}
        autoFocus
        className='h-full min-w-0 flex-1 bg-transparent text-base leading-6 text-text-primary outline-none placeholder:text-text-tertiary'
        data-testid='database-actions-search-input'
        enterKeyHint='search'
        onChange={(event) => setInputValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;

          event.preventDefault();
          event.stopPropagation();
          closeSearch();
        }}
        placeholder={t('databaseSearch.placeholder')}
        type='text'
        value={inputValue}
      />
      {inputValue ? (
        <button
          aria-label={t('button.clear')}
          className={cn(
            'relative flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-icon-secondary',
            MOBILE_TOOL_HIT_AREA_CLASS
          )}
          data-testid='database-actions-search-clear'
          onClick={closeSearch}
          type='button'
        >
          <CloseIcon aria-hidden='true' className='h-4 w-4' />
        </button>
      ) : null}
    </div>
  );
}

export default MobileWidgetSearchField;
