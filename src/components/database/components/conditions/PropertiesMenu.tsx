import { FieldType, usePropertiesSelector } from '@/application/database-yjs';
import { useNavigationKey } from '@/components/database/components/conditions/useNavigationKey';
import { FieldDisplay } from '@/components/database/components/field';
import {
  dropdownMenuItemVariants,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SearchInput } from '@/components/ui/search-input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import React, { useMemo, useState } from 'react';

function PropertiesMenu ({ open, onSelect, onOpenChange, searchPlaceholder, filteredOut, children }: {
  onSelect: (id: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  searchPlaceholder?: string;
  filteredOut?: string[];
  children?: React.ReactNode;
}) {
  const { properties } = usePropertiesSelector(true);
  const [searchInput, setSearchInput] = useState('');

  const filteredProperties = useMemo(() => {
    return properties.filter(property => {
      if (filteredOut?.includes(property.id)) {
        return false;
      }

      if ([
        FieldType.Relation,
        FieldType.AISummaries,
        FieldType.AITranslations,
        FieldType.FileMedia,
      ].includes(property.type)) {
        return false;
      }

      return property.name.toLowerCase().includes(searchInput.toLowerCase());
    });
  }, [searchInput, properties, filteredOut]);

  const [element, setElement] = useState<HTMLElement | null>(null);

  const {
    selectedId,
    setSelectedId,
  } = useNavigationKey({
    element,
    onToggleItemId: onSelect,
  });

  return (
    <Popover
      modal
      open={open}
      onOpenChange={onOpenChange}
    >
      <PopoverTrigger
        asChild={!children}
        className={cn(filteredProperties.length === 0 && filteredOut ? 'invisible' : 'visible', 'h-7')}
        disabled={filteredProperties.length === 0}
      >
        {children || <div className={'absolute top-0 left-0 w-full h-full z-[-1]'} />}
      </PopoverTrigger>
      <PopoverContent
        className={'p-2'}
        onClick={e => {
          e.stopPropagation();
        }}
        onCloseAutoFocus={e => e.preventDefault()}
      >
        <div ref={setElement}>
          <SearchInput
            placeholder={searchPlaceholder}
            className={'w-full mb-2'}
            value={searchInput}
            onChange={e => {
              setSearchInput(e.target.value);
            }}
          />
          <div className={'flex flex-col max-h-[320px] appflowy-scroller overflow-hidden overflow-y-auto '}>
            {filteredProperties.map(property => (
              <div
                data-item-id={property.id}
                className={cn(dropdownMenuItemVariants({ variant: 'default' }), selectedId === property.id && 'bg-fill-content-hover')}
                key={property.id}
                onClick={() => {
                  onSelect?.(property.id);
                  onOpenChange?.(false);
                }}
                onMouseEnter={() => setSelectedId(property.id)}
              >
                <Tooltip delayDuration={1000}>
                  <TooltipTrigger>
                    <FieldDisplay
                      className={'gap-[10px] max-w-[180px] truncate [&_svg]:text-icon-secondary [&_.custom-icon_svg]:w-4 [&_.custom-icon_svg]:h-4  flex-1'}
                      fieldId={property.id}
                    />
                  </TooltipTrigger>
                  <TooltipContent side={'right'}>
                    {property.name}
                  </TooltipContent>
                </Tooltip>
              </div>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default PropertiesMenu;