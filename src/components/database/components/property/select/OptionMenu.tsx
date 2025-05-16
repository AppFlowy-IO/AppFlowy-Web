import { SelectOption, SelectOptionColor } from '@/application/database-yjs';
import { useDeleteSelectOption, useUpdateSelectOption } from '@/application/database-yjs/dispatch';
import { SelectOptionColorMap } from '@/components/database/components/cell/cell.const';
import {
  DropdownMenu, DropdownMenuGroup, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItemTick,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import React, { useMemo } from 'react';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { useTranslation } from 'react-i18next';

function OptionMenu ({ open, onOpenChange, option, fieldId }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  option: SelectOption;
  fieldId: string
}) {
  const { t } = useTranslation();

  const onDelete = useDeleteSelectOption(fieldId);
  const onUpdate = useUpdateSelectOption(fieldId);

  const colors = useMemo(() => {
    return [{
      label: t('grid.selectOption.purpleColor'),
      value: SelectOptionColor.Purple,
      color: SelectOptionColorMap[SelectOptionColor.Purple],
    }, {
      label: t('grid.selectOption.pinkColor'),
      value: SelectOptionColor.Pink,
      color: SelectOptionColorMap[SelectOptionColor.Pink],
    }, {
      label: t('grid.selectOption.lightPinkColor'),
      value: SelectOptionColor.LightPink,
      color: SelectOptionColorMap[SelectOptionColor.LightPink],
    }, {
      label: t('grid.selectOption.orangeColor'),
      value: SelectOptionColor.Orange,
      color: SelectOptionColorMap[SelectOptionColor.Orange],
    }, {
      label: t('grid.selectOption.yellowColor'),
      value: SelectOptionColor.Yellow,
      color: SelectOptionColorMap[SelectOptionColor.Yellow],
    }, {
      label: t('grid.selectOption.limeColor'),
      value: SelectOptionColor.Lime,
      color: SelectOptionColorMap[SelectOptionColor.Lime],
    }, {
      label: t('grid.selectOption.greenColor'),
      value: SelectOptionColor.Green,
      color: SelectOptionColorMap[SelectOptionColor.Green],
    }, {
      label: t('grid.selectOption.aquaColor'),
      value: SelectOptionColor.Aqua,
      color: SelectOptionColorMap[SelectOptionColor.Aqua],
    }, {
      label: t('grid.selectOption.blueColor'),
      value: SelectOptionColor.Blue,
      color: SelectOptionColorMap[SelectOptionColor.Blue],
    }];
  }, [t]);

  const [value, setValue] = React.useState<string>(option.name);
  const [editing, setEditing] = React.useState(false);

  const updateName = () => {
    if (value === option.name) {
      return;
    }

    onUpdate(option.id, {
      ...option,
      name: value,
    });
  };

  const inputRef = React.useRef<HTMLInputElement | null>(null);

  return (
    <DropdownMenu
      open={open}
      onOpenChange={onOpenChange}
    >
      <DropdownMenuTrigger asChild>
        <div className={'absolute z-[-1] right-0 bottom-0 w-5 h-5'} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        onClick={e => {
          e.stopPropagation();
        }}
        side={'bottom'}
        align={'start'}
      >
        <DropdownMenuGroup>
          <Input
            ref={el => {
              if (el) {
                setTimeout(() => {
                  el.focus();
                  if (!inputRef.current) {
                    el.setSelectionRange(0, el.value.length);
                    inputRef.current = el;
                  }
                }, 100);
              }

            }}
            value={value}
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                updateName();
                setEditing(false);
                onOpenChange(false);
              }
            }}
            onBlur={() => {
              updateName();
              setEditing(false);
            }}
            onFocus={() => {
              setEditing(true);
            }}
            className={'w-full mb-2'}
            onChange={e => setValue(e.target.value)}
          />
          <DropdownMenuItem
            onSelect={() => {
              onDelete(option.id);
            }}
            {...(editing ? {
              onPointerMove: e => e.preventDefault(),
              onPointerEnter: e => e.preventDefault(),
              onPointerLeave: e => e.preventDefault(),
            } : undefined)}
            className={'hover:text-text-error'}
          >
            <DeleteIcon />
            {t('grid.selectOption.deleteTag')}
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {t('grid.selectOption.colorPanelTitle')}
          </DropdownMenuLabel>
          {colors.map((color) => (
            <DropdownMenuItem
              {...(editing ? {
                onPointerMove: e => e.preventDefault(),
                onPointerEnter: e => e.preventDefault(),
                onPointerLeave: e => e.preventDefault(),
              } : undefined)}
              key={color.value}
              onSelect={(e) => {
                if (color.value === option.color) {
                  e.preventDefault();
                  return;
                }

                onUpdate(option.id, {
                  ...option,
                  color: color.value,
                });
              }}
            >
              <div
                className={'w-4 h-4 rounded-full'}
                style={{
                  backgroundColor: `var(${color.color})`,
                }}
              />
              {color.label}
              {option.color === color.value && <DropdownMenuItemTick />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default OptionMenu;