import { KeyboardEvent, ReactNode, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as AltArrowDownIcon } from '@/assets/icons/alt_arrow_down.svg';
import { ReactComponent as AltArrowRightIcon } from '@/assets/icons/alt_arrow_right.svg';
import { ReactComponent as AltArrowUpIcon } from '@/assets/icons/alt_arrow_up.svg';
import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { ReactComponent as ReplaceIcon } from '@/assets/icons/replace.svg';
import { ReactComponent as SearchIcon } from '@/assets/icons/search.svg';
import { ReactComponent as TextFormatIcon } from '@/assets/icons/text_format.svg';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { useFindReplace } from './FindReplaceContext';

function ToolbarIconButton({
  tooltip,
  onClick,
  disabled,
  active,
  testId,
  children,
}: {
  tooltip: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size={'icon-sm'}
          variant={'ghost'}
          disabled={disabled}
          data-testid={testId}
          className={cn(active && 'bg-fill-theme-select text-icon-theme-thick')}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function FindReplacePanel() {
  const { t } = useTranslation();
  const {
    showReplace,
    query,
    replaceText,
    caseSensitive,
    readOnly,
    matchCount,
    currentIndex,
    focusToken,
    setQuery,
    setReplaceText,
    setShowReplace,
    toggleCaseSensitive,
    goToNext,
    goToPrevious,
    replaceCurrent,
    replaceAll,
    close,
  } = useFindReplace();

  const findInputRef = useRef<HTMLInputElement>(null);

  // Focus & select the find field whenever the panel is (re)opened.
  useEffect(() => {
    const input = findInputRef.current;

    if (!input) return;
    input.focus();
    input.select();
  }, [focusToken]);

  const hasMatches = matchCount > 0;
  const replaceDisabled = readOnly || !hasMatches || !query;

  const matchLabel = query ? (hasMatches ? `${currentIndex + 1}/${matchCount}` : t('findAndReplace.noResult')) : '';

  const handleFindKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) {
        goToPrevious();
      } else {
        goToNext();
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  const handleReplaceKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      replaceCurrent();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  return (
    <div
      data-testid={'find-and-replace-panel'}
      className={
        // Anchored flush against the bottom of the 48px sticky header
        // (HEADER_HEIGHT in AppHeader.tsx) — no vertical gap.
        'fixed right-6 top-12 z-20 flex w-[420px] max-w-[calc(100vw-2rem)] items-start gap-1 ' +
        'rounded-b-xl border border-t-0 border-border-primary bg-surface-primary p-2 shadow-lg'
      }
      onMouseDown={(e) => e.stopPropagation()}
    >
      <ToolbarIconButton
        tooltip={showReplace ? t('findAndReplace.switchFindHint') : t('findAndReplace.switchFindAndReplaceHint')}
        testId={'find-and-replace-toggle'}
        onClick={() => setShowReplace(!showReplace)}
      >
        <AltArrowRightIcon className={cn('transition-transform', showReplace && 'rotate-90')} />
      </ToolbarIconButton>

      <div className={'flex flex-1 flex-col gap-2'}>
        {/* Find row */}
        <div className={'flex items-center gap-1'}>
          <div
            className={
              'flex h-8 flex-1 items-center gap-2 rounded-300 border border-border-primary bg-fill-content px-2 ' +
              'focus-within:border-border-theme-thick'
            }
          >
            <SearchIcon className={'h-4 w-4 shrink-0 text-icon-secondary'} />
            <input
              ref={findInputRef}
              data-testid={'find-and-replace-find-input'}
              className={'min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-tertiary'}
              placeholder={t('findAndReplace.findTextfieldHint')}
              value={query}
              spellCheck={false}
              autoComplete={'off'}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleFindKeyDown}
            />
            {matchLabel && <span className={'shrink-0 whitespace-nowrap text-xs text-text-tertiary'}>{matchLabel}</span>}
          </div>

          <ToolbarIconButton
            tooltip={t('findAndReplace.previousMatch')}
            testId={'find-and-replace-previous'}
            disabled={!hasMatches}
            onClick={goToPrevious}
          >
            <AltArrowUpIcon />
          </ToolbarIconButton>
          <ToolbarIconButton
            tooltip={t('findAndReplace.nextMatch')}
            testId={'find-and-replace-next'}
            disabled={!hasMatches}
            onClick={goToNext}
          >
            <AltArrowDownIcon />
          </ToolbarIconButton>
          <ToolbarIconButton
            tooltip={t('findAndReplace.matchCase')}
            testId={'find-and-replace-case-sensitive'}
            active={caseSensitive}
            onClick={toggleCaseSensitive}
          >
            <TextFormatIcon />
          </ToolbarIconButton>
          <ToolbarIconButton tooltip={t('findAndReplace.close')} testId={'find-and-replace-close'} onClick={close}>
            <CloseIcon />
          </ToolbarIconButton>
        </div>

        {/* Replace row */}
        {showReplace && (
          <div className={'flex items-center gap-1'}>
            <div
              className={
                'flex h-8 flex-1 items-center gap-2 rounded-300 border border-border-primary bg-fill-content px-2 ' +
                'focus-within:border-border-theme-thick'
              }
            >
              <ReplaceIcon className={'h-4 w-4 shrink-0 text-icon-secondary'} />
              <input
                data-testid={'find-and-replace-replace-input'}
                className={
                  'min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-tertiary'
                }
                placeholder={t('findAndReplace.replaceTextfieldHint')}
                value={replaceText}
                spellCheck={false}
                autoComplete={'off'}
                disabled={readOnly}
                onChange={(e) => setReplaceText(e.target.value)}
                onKeyDown={handleReplaceKeyDown}
              />
            </div>

            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={-1}>
                  <Button
                    size={'sm'}
                    variant={'outline'}
                    data-testid={'find-and-replace-replace'}
                    disabled={replaceDisabled}
                    onClick={replaceCurrent}
                  >
                    {t('findAndReplace.replace')}
                  </Button>
                </span>
              </TooltipTrigger>
              {readOnly && <TooltipContent>{t('findAndReplace.noPermissionHint')}</TooltipContent>}
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={-1}>
                  <Button
                    size={'sm'}
                    variant={'outline'}
                    data-testid={'find-and-replace-replace-all'}
                    disabled={replaceDisabled}
                    onClick={replaceAll}
                  >
                    {t('findAndReplace.replaceAll')}
                  </Button>
                </span>
              </TooltipTrigger>
              {readOnly && <TooltipContent>{t('findAndReplace.noPermissionHint')}</TooltipContent>}
            </Tooltip>
          </div>
        )}
      </div>
    </div>
  );
}

export default FindReplacePanel;
