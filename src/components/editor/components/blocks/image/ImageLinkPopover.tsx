import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as CheckIcon } from '@/assets/icons/check.svg';
import { ReactComponent as EarthIcon } from '@/assets/icons/earth.svg';
import { Popover } from '@/components/_shared/popover';
import PageIcon from '@/components/_shared/view-icon/PageIcon';
import { useEditorContext } from '@/components/editor/EditorContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { imageLink, imageURL } from './image-data';
import { ImageMenuRow } from './ImageIcons';
import { ImageLinkPage, useImageLinkPages } from './useImageLinkPages';

export default function ImageLinkPopover({
  value,
  anchor,
  onChange,
  onClose,
}: {
  value?: string;
  anchor: HTMLElement;
  onChange: (value: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { workspaceId } = useEditorContext();
  const initialLink = imageLink(value);
  const [input, setInput] = useState(initialLink?.is_page_link ? '' : initialLink?.url || '');
  const [selected, setSelected] = useState(0);
  const [invalid, setInvalid] = useState(false);
  const query = input.trim();
  const url =
    imageURL(query) || (!query.includes(':') && query.includes('.') ? imageURL(`https://${query}`) : undefined);
  const { pages, loading, failed } = useImageLinkPages(query, !!url);
  const external = !!query && !loading && !failed && !pages.length;
  const count = external ? 1 : pages.length;
  const active = Math.min(selected, Math.max(0, count - 1));
  const listId = useId();
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, pages]);

  const save = (link: string) => {
    onChange(link);
    onClose();
  };

  const savePage = (page: ImageLinkPage) =>
    save(
      JSON.stringify({
        is_page_link: true,
        page_id: page.view_id,
        url: new URL(`/app/${workspaceId}/${page.view_id}`, window.location.origin).href,
      })
    );
  const saveURL = () => {
    if (url) save(JSON.stringify({ is_page_link: false, url }));
    else setInvalid(true);
  };

  const rowClass = 'h-8 w-full min-w-0 justify-start gap-2 rounded-lg px-2 py-1.5 text-sm font-normal leading-5';

  return (
    <Popover
      open
      anchorEl={anchor}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      transformOrigin={{ vertical: -4, horizontal: 'center' }}
      marginThreshold={16}
      PaperProps={{
        className: '!rounded-xl !bg-surface-layer-04 !shadow-menu ring-1 ring-inset ring-border-primary',
      }}
    >
      <div
        className='flex max-h-[calc(100dvh-36px)] w-[400px] max-w-[calc(100vw-32px)] flex-col py-3'
        data-testid='image-link-popover'
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <form
          className='shrink-0 px-3'
          onSubmit={(event) => {
            event.preventDefault();
            if (loading || failed) return;
            if (pages[active]) savePage(pages[active]);
            else if (query) saveURL();
          }}
        >
          <Input
            autoFocus
            className='h-8 w-full rounded-lg px-2 py-1.5 leading-5'
            value={input}
            role='combobox'
            aria-autocomplete='list'
            aria-expanded={count > 0}
            aria-controls={listId}
            aria-activedescendant={count ? `${listId}-${active}` : undefined}
            aria-invalid={invalid || undefined}
            onChange={(event) => {
              setInput(event.target.value);
              setSelected(0);
              setInvalid(false);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || !['ArrowDown', 'ArrowUp'].includes(event.key) || !count) return;
              event.preventDefault();
              setSelected((active + (event.key === 'ArrowDown' ? 1 : -1) + count) % count);
            }}
            aria-label={t('web.imageBlock.linkPlaceholder')}
            placeholder={t('web.imageBlock.linkPlaceholder')}
          />
          {invalid && (
            <div role='alert' className='px-2 py-2 text-sm text-text-error'>
              {t('document.plugins.file.networkUrlInvalid')}
            </div>
          )}
        </form>
        <div className='mt-2 min-h-0 overflow-y-auto px-3'>
          {!query && pages.length > 0 && (
            <div className='px-2 py-1.5 text-xs font-semibold leading-4 text-text-tertiary'>
              {t('inlineActions.recentPages')}
            </div>
          )}
          {loading && (
            <div role='status' className='px-2 py-1.5 text-sm text-text-tertiary'>
              {t('loading')}
            </div>
          )}
          {failed && (
            <div role='alert' className='px-2 py-1.5 text-sm text-text-tertiary'>
              {t('document.mobilePageSelector.failedToLoad')}
            </div>
          )}
          <div id={listId} ref={list} role='listbox' aria-label={t('web.imageBlock.pages')}>
            {pages.map((page, index) => (
              <Button
                key={page.view_id}
                id={`${listId}-${index}`}
                type='button'
                role='option'
                aria-selected={active === index}
                tabIndex={-1}
                variant='ghost'
                className={`${rowClass} ${active === index ? 'bg-fill-content-hover' : ''}`}
                onMouseMove={() => setSelected(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => savePage(page)}
              >
                <span className='flex h-5 w-5 shrink-0 items-center justify-center' data-testid='image-link-page-icon'>
                  <PageIcon view={page} className='h-5 w-5 text-xl leading-5 text-icon-primary' iconSize={20} />
                </span>
                <span className='min-w-0 flex-1 truncate text-left'>
                  {page.name || t('menuAppHeader.defaultNewPageName')}
                </span>
                {initialLink?.page_id === page.view_id && (
                  <CheckIcon aria-hidden='true' className='h-5 w-5 text-text-action' />
                )}
              </Button>
            ))}
            {external && (
              <Button
                id={`${listId}-0`}
                type='button'
                role='option'
                aria-selected
                tabIndex={-1}
                variant='ghost'
                className={`${rowClass} bg-fill-content-hover`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={saveURL}
              >
                <EarthIcon className='h-5 w-5 text-icon-primary' />
                <span className='min-w-0 flex-1 truncate text-left'>{query}</span>
              </Button>
            )}
          </div>
        </div>
        {value && (
          <div className='mt-2 shrink-0 border-t border-border-primary px-3 pt-2'>
            <ImageMenuRow icon='delete' danger onClick={() => save('')}>
              {t('web.imageBlock.removeLink')}
            </ImageMenuRow>
          </div>
        )}
      </div>
    </Popover>
  );
}
