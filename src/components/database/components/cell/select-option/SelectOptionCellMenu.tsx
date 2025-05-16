import {
  FieldType,
  parseSelectOptionTypeOptions,
  SelectOption,
  useFieldSelector,
  useSelectFieldOptions,
} from '@/application/database-yjs';
import { SelectOptionCell as SelectOptionCellType } from '@/application/database-yjs/cell.type';
import { useAddSelectOption, useUpdateCellDispatch } from '@/application/database-yjs/dispatch';
import { getColorByFirstChar } from '@/application/database-yjs/fields/select-option/utils';
import { YjsDatabaseKey } from '@/application/types';
import { Tag } from '@/components/_shared/tag';
import { SelectOptionColorMap } from '@/components/database/components/cell/cell.const';

import { TagsInput } from '@/components/database/components/cell/select-option/TagsInput';
import Options from '@/components/database/components/property/select/Options';

import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

function SelectOptionCellMenu ({ open, onOpenChange, cell, fieldId, rowId }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cell?: SelectOptionCellType;
  fieldId: string;
  rowId: string;
}) {
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
  const selectOptionIds = useMemo(() => cell?.data.split(',') || [], [cell]);
  const [searchValue, setSearchValue] = useState<string>('');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const options = useSelectFieldOptions(fieldId, searchValue);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hoveredIdRef = useRef<string | null>(null);
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
        setHoveredId(null);
      }
    } else {
      const firstOption = options[0];

      setHoveredId(firstOption.id);
    }
  }, [createdShow, options]);

  const tags = useMemo(() => {

    if (!typeOption) return [];

    return selectOptionIds.map((id) => {
      const option = typeOption.options?.find((option) => option.id === id);

      if (!option) return null;
      return {
        id: option.id,
        text: option.name,
        color: option.color,
      };
    }).filter(Boolean) as Tag[];
  }, [selectOptionIds, typeOption]);

  const handleTagsChange = useCallback((newTags: Tag[]) => {
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
      const newSelectOptionIds = [...selectOptionIds, optionId];

      onUpdateCell(newSelectOptionIds.join(','));
    }
  }, [onUpdateCell, selectOptionIds]);

  const handleCreateOption = useCallback(() => {
    const searchValue = searchValueRef.current;
    const newOption: SelectOption = {
      id: searchValue,
      name: searchValue,
      color: getColorByFirstChar(searchValue),
    };

    onCreateOption(newOption);
    setSearchValue('');
    handleSelectOption(newOption.id);
  }, [handleSelectOption, onCreateOption]);

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

    const nextHoveredId = options[hoveredIndex - 1].id;

    setHoveredId(nextHoveredId);

  }, [createdShow, options]);

  const handleArrowDown = useCallback(() => {
    const hoveredId = hoveredIdRef.current;

    if (!hoveredId) return;

    const firstOption = options[0];

    if (hoveredId === 'create') {
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

    const nextHoveredId = options[hoveredIndex + 1].id;

    setHoveredId(nextHoveredId);
  }, [createdShow, options]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation();
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
  }, [handleArrowDown, handleArrowUp, handleEnter]);

  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
    >
      <PopoverTrigger
        className={'absolute left-0 top-0 w-full h-full z-[-1]'}
      />
      <PopoverContent
        onMouseDown={(e) => {
          e.preventDefault();
        }}
        className={'max-w-[240px] overflow-hidden'}
      >
        <div className={'p-2'}>
          <TagsInput
            autoFocus
            onMouseDown={e => {
              e.stopPropagation();
            }}
            className={'w-full'}
            multiple={isMultiple}
            tags={tags}
            onKeyDown={handleKeyDown}
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
            searchValue={searchValue}
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
              color={SelectOptionColorMap[getColorByFirstChar(searchValue)]}
              label={searchValue}
            />
          </div> : null}

        </div>

      </PopoverContent>
    </Popover>
  );
}

export default SelectOptionCellMenu;