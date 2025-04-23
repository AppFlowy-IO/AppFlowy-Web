import { useFieldSelector } from '@/application/database-yjs';
import {
  useDeletePropertyDispatch,
  useAddPropertyRightDispatch,
  useAddPropertyLeftDispatch,
} from '@/application/database-yjs/dispatch';
import { YjsDatabaseKey } from '@/application/types';
import { useGridRowContext } from '@/components/database/components/grid/grid-row/GridRowContext';
import PropertyMenu from '@/components/database/components/property/PropertyMenu';
import PropertyProfile from '@/components/database/components/property/PropertyProfile';
import { useGridContext } from '@/components/database/grid/useGridContext';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import React, { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ReactComponent as EditIcon } from '@/assets/icons/controller.svg';
import { ReactComponent as LeftIcon } from '@/assets/icons/arrow_left.svg';
import { ReactComponent as RightIcon } from '@/assets/icons/arrow_right.svg';
import { ReactComponent as EraserIcon } from '@/assets/icons/eraser.svg';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as HideIcon } from '@/assets/icons/hide.svg';
import { ReactComponent as DuplicateIcon } from '@/assets/icons/copy.svg';

function GridFieldMenu ({
  fieldId,
  children,
}: {
  fieldId: string,
  children: React.ReactNode

}) {
  const { field } = useFieldSelector(fieldId);
  const isPrimary = field?.get(YjsDatabaseKey.is_primary);
  const onAddPropertyLeft = useAddPropertyLeftDispatch();
  const onAddPropertyRight = useAddPropertyRightDispatch();
  const [menuOpen, setMenuOpen] = React.useState(false);

  const {
    isSticky,
  } = useGridRowContext();

  const {
    showStickyHeader,
    activePropertyId,
    setActivePropertyId,
  } = useGridContext();

  const onDeleteProperty = useDeletePropertyDispatch();

  const { t } = useTranslation();

  const operations = useMemo(() => [{
    label: t('grid.field.editProperty'),
    icon: <EditIcon />,
    onSelect: () => {
      setActivePropertyId(fieldId);
      setMenuOpen(false);
    },
  }, {
    label: t('grid.field.insertLeft'),
    icon: <LeftIcon />,
    onSelect: () => {
      const id = onAddPropertyLeft(fieldId);

      setActivePropertyId(id);
    },
  }, {
    label: t('grid.field.insertRight'),
    icon: <RightIcon />,
    onSelect: () => {
      const id = onAddPropertyRight(fieldId);

      setActivePropertyId(id);
    },
  }, {
    label: t('grid.field.hide'),
    icon: <HideIcon />,
    onSelect: () => {
      //
    },
  }, {
    label: t('grid.field.duplicate'),
    icon: <DuplicateIcon />,
    disabled: isPrimary,
    onSelect: () => {
      //
    },
  }, {
    label: t('grid.field.clear'),
    icon: <EraserIcon />,
    onSelect: () => {
      //
    },
  }, {
    label: t('grid.field.delete'),
    icon: <DeleteIcon />,
    disabled: isPrimary,
    onSelect: () => {
      onDeleteProperty(fieldId);
    },
  }], [t, isPrimary, onAddPropertyLeft, fieldId, setActivePropertyId, onAddPropertyRight, onDeleteProperty]);

  const secondItemRef = useRef<HTMLDivElement | null>(null);

  if ((isSticky && !showStickyHeader) || (!isSticky && showStickyHeader)) {
    return null;
  }

  return (
    <>
      <DropdownMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
      >
        <DropdownMenuTrigger asChild>
          {children}

        </DropdownMenuTrigger>
        <DropdownMenuContent
          onCloseAutoFocus={e => e.preventDefault()}
        >
          <PropertyProfile
            className={'mb-2'}
            fieldId={fieldId}
            onNext={() => {
              secondItemRef.current?.focus();
            }}
            onEnter={() => {
              setMenuOpen(false);
            }}
          />
          <DropdownMenuGroup>
            {
              operations.map((operation, index) => (
                <DropdownMenuItem
                  onPointerMove={e => e.preventDefault()}
                  onPointerEnter={e => e.preventDefault()}
                  onPointerLeave={e => e.preventDefault()}
                  ref={index === 0 ? secondItemRef : undefined}
                  disabled={operation.disabled}
                  onSelect={operation.onSelect}
                  key={operation.label}
                >
                  {operation.icon}
                  {operation.label}
                </DropdownMenuItem>
              ))
            }
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              onPointerMove={e => e.preventDefault()}
              onPointerEnter={e => e.preventDefault()}
              onPointerLeave={e => e.preventDefault()}
            >
              {t('grid.field.wrapCellContent')}
              <DropdownMenuShortcut className={'flex items-center'}>
                <Switch />
              </DropdownMenuShortcut>

            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <PropertyMenu
        open={activePropertyId === fieldId}
        onClose={() => {
          setActivePropertyId(undefined);
        }}
        fieldId={fieldId}
      />
    </>

  );
}

export default GridFieldMenu;