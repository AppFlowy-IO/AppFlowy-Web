import {
  formats,
  NumberFormat,
  parseNumberTypeOptions,
  useFieldSelector,
} from '@/application/database-yjs';
import { useUpdateNumberTypeOption } from '@/application/database-yjs/dispatch';
import {
  DropdownMenuGroup, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuItemTick,
} from '@/components/ui/dropdown-menu';
import { SearchInput } from '@/components/ui/search-input';
import React, { useMemo, useState } from 'react';
import PropertySelectTrigger from '@/components/database/components/property/PropertySelectTrigger';
import { useTranslation } from 'react-i18next';

function NumberPropertyMenuContent ({ fieldId }: {
  fieldId: string
}) {
  const { field } = useFieldSelector(fieldId);
  const { t } = useTranslation();
  const onUpdateFormat = useUpdateNumberTypeOption();

  const format = useMemo(() => (field ? parseNumberTypeOptions(field).format : NumberFormat.Num), [field]);

  const selectFormatValue = useMemo(() => {
    return formats.find((item) => item.value === format);
  }, [format]);

  const [searchValue, setSearchValue] = useState('');

  const filteredOptions = useMemo(() => {
    return formats.filter((item) => {
      return item.label.toLowerCase().includes(searchValue.toLowerCase());
    });
  }, [searchValue]);

  return (
    <>
      <PropertySelectTrigger fieldId={fieldId} />
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuLabel>{t('grid.field.numberFormat')}</DropdownMenuLabel>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {selectFormatValue?.label}
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent
              className={'max-h-[450px] max-w-[240px] pt-0 appflowy-scroller overflow-y-auto'}
            >
              <div className={'flex bg-surface-primary pt-2 sticky top-0 z-[1] flex-col'}>
                <SearchInput
                  inputRef={el => {
                    if (el) {
                      setTimeout(() => {
                        el.focus();
                      }, 100);
                    }
                  }}
                  placeholder={t('searchLabel')}
                  value={searchValue}
                  onChange={e => {
                    setSearchValue(e.target.value);
                  }}
                  onKeyDown={e => {
                    e.stopPropagation();
                  }}
                />
                <DropdownMenuSeparator />
              </div>

              {filteredOptions.map((item) => {
                return <DropdownMenuItem
                  key={item.value}
                  onSelect={() => {
                    onUpdateFormat(fieldId, item.value);
                  }}
                >
                  {item.label}
                  {item.value === format ? <DropdownMenuItemTick /> : ''}
                </DropdownMenuItem>;
              })}
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      </DropdownMenuGroup>
    </>
  );
}

export default NumberPropertyMenuContent;