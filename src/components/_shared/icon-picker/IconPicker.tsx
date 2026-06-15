import DOMPurify from 'dompurify';
import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as ShuffleIcon } from '@/assets/icons/shuffle.svg';
import IconsVirtualizer from '@/components/_shared/icon-picker/IconsVirtualizer';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/ui/search-input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { IconColors, randomColor } from '@/utils/color';
import { ICON_CATEGORY, loadIcons, randomIcon } from '@/utils/emoji';

const ICONS_PER_ROW = 9;

function IconPicker({
  onSelect,
  onEscape,
  size,
  enableColor = true,
  container,
}: {
  onSelect: (icon: { value: string; color: string; content: string }) => void;
  onEscape?: () => void;
  size?: [number, number];
  enableColor: boolean;
  container?: HTMLDivElement;
}) {
  const { t } = useTranslation();
  const [icons, setIcons] = React.useState<
    | Record<
        ICON_CATEGORY,
        {
          id: string;
          name: string;
          content: string;
          keywords: string[];
        }[]
      >
    | undefined
  >(undefined);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setTimeout(() => {
      inputRef.current?.focus();
    }, 100);
  }, []);
  const [searchValue, setSearchValue] = React.useState('');
  const filteredIcons = React.useMemo(() => {
    if (!icons) return {};
    if (!searchValue) return icons;
    const filtered = Object.fromEntries(
      Object.entries(icons).map(([category, icons]) => [
        category,
        icons.filter(
          (icon) =>
            icon.name.toLowerCase().includes(searchValue.toLowerCase()) ||
            icon.keywords.some((keyword) => keyword.toLowerCase().includes(searchValue.toLowerCase()))
        ),
      ])
    );

    return filtered;
  }, [icons, searchValue]);

  const rowData = React.useMemo(() => {
    if (!filteredIcons) return [];

    const rows: Array<{
      type: 'category' | 'icons';
      category?: string;
      icons?: Array<{
        id: string;
        name: string;
        content: string;
        keywords: string[];
        cleanSvg: string;
      }>;
    }> = [];

    Object.entries(filteredIcons).forEach(([category, icons]) => {
      if (icons.length === 0) return;

      rows.push({
        type: 'category',
        category: category.replaceAll('_', ' '),
      });

      for (let i = 0; i < icons.length; i += ICONS_PER_ROW) {
        rows.push({
          type: 'icons',
          icons: icons.slice(i, i + ICONS_PER_ROW).map((icon) => ({
            ...icon,
            cleanSvg: DOMPurify.sanitize(
              icon.content.replaceAll('black', 'currentColor').replace('<svg', '<svg width="100%" height="100%"'),
              {
                USE_PROFILES: { svg: true, svgFilters: true },
              }
            ),
          })),
        });
      }
    });

    return rows;
  }, [filteredIcons]);

  useEffect(() => {
    void loadIcons().then(setIcons);
  }, []);

  return (
    <div
      style={{
        width: size ? size[0] : undefined,
        height: size ? size[1] : undefined,
      }}
      className={'flex h-[360px] max-h-[70vh] flex-col gap-3 px-3 pb-3'}
    >
      <div className={'search-input flex items-end justify-between gap-2'}>
        <SearchInput
          value={searchValue}
          onChange={(e) => {
            setSearchValue(e.target.value);
          }}
          inputRef={inputRef}
          onKeyUp={(e) => {
            if (e.key === 'Escape' && onEscape) {
              onEscape();
            }
          }}
          autoFocus={true}
          autoCorrect={'off'}
          autoComplete={'off'}
          spellCheck={false}
          className={'search-emoji-input w-full'}
          placeholder={t('search.label')}
        />
        <div className={'flex items-center gap-1'}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={'outline'}
                size={'icon-lg'}
                onClick={async () => {
                  const icon = await randomIcon();
                  const color = randomColor(IconColors);

                  onSelect({ value: icon.id, color, content: icon.content });
                }}
              >
                <ShuffleIcon className={'h-5 w-5'} />
              </Button>
            </TooltipTrigger>
            <TooltipContent container={container}>{t('emoji.random')}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className={'flex flex-1 flex-col gap-2'}>
        <div className='flex-1'>
          <IconsVirtualizer data={rowData} onSelected={onSelect} enableColor={enableColor} container={container} />
        </div>
        <div className={'pt-2 text-xs text-text-secondary'}>
          {t('emoji.openSourceIconsFrom')}
          <a
            href={'https://www.streamlinehq.com/'}
            target={'_blank'}
            rel={'noreferrer'}
            className={'ml-1 text-text-action underline'}
          >
            Streamline
          </a>
        </div>
      </div>
    </div>
  );
}

export default IconPicker;
