import { Check } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as SearchIcon } from '@/assets/icons/search.svg';

import { codeLanguageLabel, filterCodeLanguages, normalizeCodeLanguage } from './constants';

/** Search keeps focus in the combobox; arrows wrap only through the filtered results. */
export function CodeLanguageMenu({ language, onSelect }: { language: string; onSelect: (language: string) => void }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const options = useMemo(() => filterCodeLanguages(search), [search]);
  const [active, setActive] = useState(() =>
    Math.max(
      0,
      options.findIndex((item) => item.id === normalizeCodeLanguage(language))
    )
  );
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const selected = options[active];

  useEffect(() => {
    const row = list.current?.children[active] as HTMLElement | undefined;

    if (row && list.current) {
      const parent = list.current;

      if (row.offsetTop < parent.scrollTop) parent.scrollTop = row.offsetTop;
      else if (row.offsetTop + row.offsetHeight > parent.scrollTop + parent.clientHeight)
        parent.scrollTop = row.offsetTop + row.offsetHeight - parent.clientHeight;
    }
  }, [active, search]);

  return (
    <div className='code-language-menu' data-testid='code-language-menu'>
      <div className='code-language-search'>
        <SearchIcon aria-hidden />
        <input
          autoFocus
          role='combobox'
          aria-expanded
          aria-controls={id}
          aria-autocomplete='list'
          aria-activedescendant={selected ? `${id}-${selected.id}` : undefined}
          aria-label={t('document.codeBlock.searchLanguageHint', { defaultValue: 'Search for a language' })}
          placeholder={t('document.codeBlock.searchLanguageHint', { defaultValue: 'Search for a language' })}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              event.stopPropagation();
              if (options.length)
                setActive((value) => (value + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
            } else if (event.key === 'Enter') {
              event.preventDefault();
              event.stopPropagation();
              if (selected) onSelect(selected.id);
            }
          }}
        />
      </div>
      <div
        id={id}
        ref={list}
        role='listbox'
        aria-label={t('document.plugins.optionAction.codeLanguage', { defaultValue: 'Language' })}
        className='code-language-list'
      >
        {options.map((option, index) => (
          <button
            key={option.id}
            id={`${id}-${option.id}`}
            type='button'
            role='option'
            aria-selected={option.id === normalizeCodeLanguage(language)}
            tabIndex={-1}
            className={`code-menu-row ${index === active ? 'is-active' : ''}`}
            onMouseDown={(event) => event.preventDefault()}
            onMouseMove={() => setActive(index)}
            onClick={() => onSelect(option.id)}
          >
            <span>
              {option.id === 'auto'
                ? t('document.codeBlock.language.auto', { defaultValue: 'Auto' })
                : codeLanguageLabel(option.id)}
            </span>
            {option.id === normalizeCodeLanguage(language) && (
              <Check size={20} className='ml-auto text-icon-info-thick' />
            )}
          </button>
        ))}
        {!options.length && (
          <p role='status' className='px-2 py-3 text-sm text-text-secondary'>
            {t('findAndReplace.noResults', { defaultValue: 'No results' })}
          </p>
        )}
      </div>
    </div>
  );
}
