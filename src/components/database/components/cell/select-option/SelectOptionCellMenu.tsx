import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import {
  FieldType,
  parseSelectOptionTypeOptions,
  SelectOption,
  useFieldSelector,
  useSelectFieldOptions,
} from '@/application/database-yjs';
import { SelectOptionCell as SelectOptionCellType } from '@/application/database-yjs/cell.type';
import { useAddSelectOption, useUpdateCellDispatch } from '@/application/database-yjs/dispatch';
import { getColorByOption } from '@/application/database-yjs/fields/select-option/utils';
import { YjsDatabaseKey } from '@/application/types';
import { Tag } from '@/components/_shared/tag';
import { TagsInput, Tag as TagType } from '@/components/database/components/cell/select-option/TagsInput';
import Options from '@/components/database/components/property/select/Options';
import { useGridHistoryScopeId, useRestoreGridHistoryFocus } from '@/components/database/grid/useGridContext';
import { isDatabaseHistoryHotkey } from '@/components/database/hooks/useDatabaseRowHistoryHotkeys';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

function SelectOptionCellMenu ({ open, onOpenChange, fieldId, rowId, selectOptionIds }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectOptionIds: string[];
  cell?: SelectOptionCellType;
  fieldId: string;
  rowId: string;
}) {
  const historyScopeId = useGridHistoryScopeId();
  const restoreGridHistoryFocus = useRestoreGridHistoryFocus();
  const { field, clock } = useFieldSelector(fieldId);
  const onCreateOption = useAddSelectOption(fieldId);
  const onUpdateCell = useUpdateCellDispatch(rowId, fieldId);
  const fieldType = field ? Number(field.get(YjsDatabaseKey.type)) : null;
  const isMultiple = fieldType === FieldType.MultiSelect;
  const typeOption = useMemo(() => {
    if (!field) return null;
    return parseSelectOptionTypeOptions(field);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field, clock]);
  const { t } = useTranslation();

  const [searchValue, setSearchValue] = useState<string>('');
  const [hoveredId, setHoveredId] = useState<string | undefined>(undefined);
  const options = useSelectFieldOptions(fieldId, searchValue);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hoveredIdRef = useRef<string | undefined>(undefined);
  const searchValueRef = useRef<string | null>(null);
  const createdShow = useMemo(() => {
    if (!searchValue) return false;
    return !options.some((option => option.name === searchValue));
  }, [options, searchValue]);

  useEffect(() => {
    hoveredIdRef.current = hoveredId;
    searchValueRef.current = searchValue;
  }, [hoveredId, searchValue]);

  useEffect(() => {
    if (options.length === 0) {
      if (createdShow) {
        setHoveredId('create');
      } else {
        setHoveredId(undefined);
      }
    } else {
      const firstOption = options[0];

      setHoveredId(firstOption.id);
    }
  }, [createdShow, options]);

  const tags = useMemo(() => {

    if (!typeOption) return [];

    return selectOptionIds.map((id) => {
      const option = typeOption.options?.find((option) => option?.id === id);

      if (!option) return null;
      return {
        id: option.id,
        text: option.name,
        color: option.color,
      };
    }).filter(Boolean) as TagType[];
  }, [selectOptionIds, typeOption]);

  const handleTagsChange = useCallback((newTags: TagType[]) => {
    const selectedIds = newTags.map((tag) => tag.id);
    const newData = selectedIds.join(',');

    onUpdateCell(newData);
  }, [onUpdateCell]);

  const handleSelectOption = useCallback((optionId: string) => {
    const isSelected = selectOptionIds.includes(optionId);

    if (isSelected) {
      const newSelectOptionIds = selectOptionIds.filter((id) => id !== optionId);

      onUpdateCell(newSelectOptionIds.join(','));
    } else {
      const newSelectOptionIds = isMultiple ? [...selectOptionIds, optionId] : [optionId];

      onUpdateCell(newSelectOptionIds.join(','));
    }

    setSearchValue('');
  }, [isMultiple, onUpdateCell, selectOptionIds]);

  const handleCreateOption = useCallback(() => {
    const searchValue = searchValueRef.current;

    if (!searchValue) return;
    setSearchValue('');
    const newOption: SelectOption = {
      id: searchValue,
      name: searchValue,
      color: getColorByOption(typeOption?.options || []),
    };

    onCreateOption(newOption);
    setSearchValue('');
    handleSelectOption(newOption.id);
  }, [handleSelectOption, onCreateOption, typeOption]);

  const handleEnter = useCallback(() => {
    const hoveredId = hoveredIdRef.current;

    if (!hoveredId) return;

    if (hoveredId === 'create') {
      handleCreateOption();
      return;
    }

    handleSelectOption(hoveredId);

  }, [handleCreateOption, handleSelectOption]);

  const handleArrowUp = useCallback(() => {
    const hoveredId = hoveredIdRef.current;

    if (!hoveredId) return;

    const lastOption = options[options.length - 1];

    if (hoveredId === 'create') {
      if (!lastOption) return;
      setHoveredId(lastOption.id);
      return;
    }

    const hoveredIndex = options.findIndex((option) => option.id === hoveredId);

    if (hoveredIndex === 0) {
      if (createdShow) {
        setHoveredId('create');
      } else {
        setHoveredId(lastOption.id);
      }

      return;
    }

    const previousOption = options[hoveredIndex - 1];

    if (!previousOption) return;

    const nextHoveredId = previousOption.id;

    setHoveredId(nextHoveredId);

  }, [createdShow, options]);

  const handleArrowDown = useCallback(() => {
    const hoveredId = hoveredIdRef.current;

    if (!hoveredId) return;

    const firstOption = options[0];

    if (hoveredId === 'create') {
      if (!firstOption) return;
      setHoveredId(firstOption.id);
      return;
    }

    const hoveredIndex = options.findIndex((option) => option.id === hoveredId);

    if (hoveredIndex === options.length - 1) {
      if (createdShow) {
        setHoveredId('create');
      } else {
        setHoveredId(firstOption.id);
      }

      return;
    }

    const nextOption = options[hoveredIndex + 1];

    if (!nextOption) return;

    const nextHoveredId = nextOption.id;

    setHoveredId(nextHoveredId);
  }, [createdShow, options]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isDatabaseHistoryHotkey(e.nativeEvent) || searchValue !== '') {
      e.stopPropagation();
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      handleEnter();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      handleArrowDown();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      handleArrowUp();
    }
  }, [handleArrowDown, handleArrowUp, handleEnter, searchValue]);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) restoreGridHistoryFocus?.();
    onOpenChange(nextOpen);
  }, [onOpenChange, restoreGridHistoryFocus]);

  return (
    <Popover
      modal
      open={open}
      onOpenChange={handleOpenChange}
    >
      <PopoverTrigger
        className={'absolute left-0 top-0 w-full h-full z-[-1]'}
      />
      <PopoverContent
        data-testid="select-option-menu"
        data-database-history-scope={historyScopeId}
        side={'bottom'}
        align={'start'}
        onMouseDown={(e) => {
          e.preventDefault();
        }}
        className={'max-w-[240px] overflow-hidden'}
      >
        <div className={'p-2'}>
          <TagsInput
            onWheel={e => e.stopPropagation()}
            autoFocus
            onMouseDown={e => {
              e.stopPropagation();
            }}
            className={'w-full'}
            multiple={isMultiple}
            tags={tags}
            onKeyDown={handleKeyDown}
            data-database-history-hotkeys={searchValue === '' ? 'true' : undefined}
            onTagsChange={handleTagsChange}
            inputValue={searchValue}
            onInputChange={setSearchValue}
            inputRef={inputRef}
          />

        </div>

        <Separator />
        <div className={'p-2'}>
          <Label className={'h-8'}>{t('grid.selectOption.panelTitle')}</Label>
          <Options
            fieldId={fieldId}
            selectedOptionIds={selectOptionIds}
            onSelectOption={handleSelectOption}
            hoveredId={hoveredId}
            options={options}
            onHover={setHoveredId}
          />
          {createdShow ? <div
            className={cn(
              'relative flex cursor-pointer items-center gap-[10px] rounded-300 px-2 py-1 min-h-[32px]',
              'text-sm text-text-secondary outline-hidden select-none',
              'hover:bg-fill-content-hover hover:text-text-primary',
              hoveredId === 'create' && 'bg-fill-content-hover text-text-primary',
            )}
            onMouseEnter={() => setHoveredId('create')}
            onClick={(e) => {
              e.preventDefault();
              handleCreateOption();
            }}
          >
            {t('button.create')}
            <Tag
              label={searchValue}
            />
          </div> : null}

        </div>

      </PopoverContent>
    </Popover>
  );
}

export default SelectOptionCellMenu;
