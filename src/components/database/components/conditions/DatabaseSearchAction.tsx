import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { ReactComponent as SearchIcon } from '@/assets/icons/search.svg';
import { useDatabaseSearch } from '@/components/database/components/conditions/DatabaseSearchContext';
import { Button } from '@/components/ui/button';
import { preventTooltipOnFocus, Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/** The committed query follows the typing after this pause (both clients). */
export const DATABASE_SEARCH_DEBOUNCE_MS = 300;

export type DatabaseSearchActionVariant = 'toolbar' | 'widget';

/**
 * The Search control of a database toolbar (`toolbar`) or of a dashboard
 * widget header (`widget`, WP09 §1.2): a button that expands in place into a
 * search field. Typing commits the trimmed query after 300 ms; Escape or the
 * clear button clears and collapses; leaving an empty field collapses it,
 * while a query keeps it open. The field container carries
 * `data-search-active` while expanded, which keeps a widget's tools shown.
 */
export function DatabaseSearchAction({
  variant = 'toolbar',
  compact = true,
}: {
  variant?: DatabaseSearchActionVariant;
  /** Toolbar only: the small button of a compact toolbar (Gallery, Feed); a full-size one otherwise. */
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const { query, setQuery, clearToken, focusSearchToken } = useDatabaseSearch();
  const [expanded, setExpanded] = useState(() => Boolean(query));
  const [inputValue, setInputValue] = useState(query);
  const [handledClearToken, setHandledClearToken] = useState(clearToken);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const handledFocusTokenRef = useRef(focusSearchToken);
  const widget = variant === 'widget';

  // "Clear search", or Edit mode, cleared the query: reset the field and collapse it.
  if (handledClearToken !== clearToken) {
    setHandledClearToken(clearToken);
    setInputValue('');
    setExpanded(false);
  }

  useEffect(() => {
    if (!expanded) return;

    const timeout = window.setTimeout(() => setQuery(inputValue.trim()), DATABASE_SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timeout);
  }, [expanded, inputValue, setQuery]);

  // The focus returns to the Search button once the field has collapsed.
  useEffect(() => {
    if (expanded || handledFocusTokenRef.current === focusSearchToken) return;
    handledFocusTokenRef.current = focusSearchToken;
    buttonRef.current?.focus();
  }, [expanded, focusSearchToken]);

  const closeSearch = () => {
    setInputValue('');
    setQuery('');
    setExpanded(false);
  };

  if (!expanded) {
    return (
      <Tooltip disableHoverableContent={widget}>
        <TooltipTrigger asChild onFocus={widget ? preventTooltipOnFocus : undefined}>
          <Button
            aria-label={t('search.label')}
            className={cn(widget && '!rounded-200 text-dash-tool-icon [&_svg]:h-4 [&_svg]:w-4')}
            data-parity-id={widget ? 'dash-widget-tool-search' : undefined}
            data-testid='database-actions-search'
            onClick={(event) => {
              event.stopPropagation();
              setExpanded(true);
            }}
            ref={buttonRef}
            size={widget || compact ? 'icon-sm' : 'icon'}
            type='button'
            variant='ghost'
          >
            <SearchIcon
              aria-hidden='true'
              className={widget ? 'h-4 w-4' : 'h-5 w-5'}
              data-parity-id={widget ? 'dash-widget-tool-search__icon' : undefined}
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('search.label')}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div
      className={cn(
        'flex h-6 items-center gap-1 border border-border-primary bg-fill-content px-1.5 text-sm leading-5 transition-[width,opacity] duration-150 ease-in-out motion-reduce:transition-none',
        widget
          ? 'w-[min(200px,45cqw)] max-w-[45%] rounded-200 supports-[width:1cqw]:max-w-none'
          : 'w-[200px] rounded-300'
      )}
      // The typed text is the committed query (the debounce has elapsed): tests wait on it.
      data-committed={inputValue.trim() === query ? 'true' : 'false'}
      data-parity-id={widget ? 'dash-widget-search-field' : undefined}
      data-search-active='true'
      data-testid='database-actions-search-field'
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null) && !inputValue.trim()) {
          closeSearch();
        }
      }}
      onClick={(event) => event.stopPropagation()}
      role='search'
    >
      <SearchIcon
        aria-hidden='true'
        className={cn('shrink-0 text-icon-secondary', widget ? 'h-3 w-3' : 'h-4 w-4')}
        data-parity-id={widget ? 'dash-widget-search-field__icon' : undefined}
      />
      <input
        aria-label={t('search.label')}
        autoFocus
        className='h-full min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-tertiary'
        data-testid='database-actions-search-input'
        onChange={(event) => setInputValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;

          event.preventDefault();
          event.stopPropagation();
          closeSearch();
        }}
        placeholder={t('databaseSearch.placeholder')}
        enterKeyHint='search'
        type='text'
        value={inputValue}
      />
      {inputValue ? (
        <Button
          aria-label={t('button.clear')}
          className={cn('rounded-200 p-0 text-icon-secondary', widget ? 'h-4 w-4' : 'h-5 w-5')}
          data-testid='database-actions-search-clear'
          onClick={closeSearch}
          size='icon-sm'
          type='button'
          variant='ghost'
        >
          <CloseIcon aria-hidden='true' className={widget ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
        </Button>
      ) : null}
    </div>
  );
}

export default DatabaseSearchAction;
