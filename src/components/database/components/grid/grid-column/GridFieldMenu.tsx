import { useFieldSelector, useFieldWrap } from '@/application/database-yjs';
import {
  useAddPropertyRightDispatch,
  useAddPropertyLeftDispatch,
  useHidePropertyDispatch,
  useTogglePropertyWrapDispatch,
  useDuplicatePropertyDispatch,
} from '@/application/database-yjs/dispatch';
import { YjsDatabaseKey } from '@/application/types';
import { useGridRowContext } from '@/components/database/components/grid/grid-row/GridRowContext';
import ClearCellsConfirm from '@/components/database/components/property/ClearCellsConfirm';
import DeletePropertyConfirm from '@/components/database/components/property/DeletePropertyConfirm';
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
import React, { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ReactComponent as EditIcon } from '@/assets/icons/controller.svg';
import { ReactComponent as LeftIcon } from '@/assets/icons/arrow_left.svg';
import { ReactComponent as RightIcon } from '@/assets/icons/arrow_right.svg';
import { ReactComponent as EraserIcon } from '@/assets/icons/eraser.svg';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as HideIcon } from '@/assets/icons/hide.svg';
import { ReactComponent as DuplicateIcon } from '@/assets/icons/duplicate.svg';

function GridFieldMenu ({
  fieldId,
  children,
}: {
  fieldId: string,
  children: React.ReactNode
}) {
  const { field } = useFieldSelector(fieldId);
  const isPrimary = field?.get(YjsDatabaseKey.is_primary);
  const wrap = useFieldWrap(fieldId);
  const onToggleWrap = useTogglePropertyWrapDispatch();
  const onAddPropertyLeft = useAddPropertyLeftDispatch();
  const onAddPropertyRight = useAddPropertyRightDispatch();
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [clearCellsConfirmOpen, setClearCellsConfirmOpen] = useState(false);

  const {
    isSticky,
  } = useGridRowContext();

  const {
    showStickyHeader,
    activePropertyId,
    setActivePropertyId,
  } = useGridContext();

  const onDuplicateProperty = useDuplicatePropertyDispatch();
  const onHideProperty = useHidePropertyDispatch();

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
      onHideProperty(fieldId);
    },
  }, {
    label: t('grid.field.duplicate'),
    icon: <DuplicateIcon />,
    disabled: isPrimary,
    onSelect: () => {
      onDuplicateProperty(fieldId);
    },
  }, {
    label: t('grid.field.clear'),
    icon: <EraserIcon />,
    onSelect: () => {
      setClearCellsConfirmOpen(true);
    },
  }, {
    label: t('grid.field.delete'),
    icon: <DeleteIcon />,
    disabled: isPrimary,
    onSelect: () => {
      setDeleteConfirmOpen(true);
    },
  }], [
    t,
    isPrimary,
    setActivePropertyId,
    fieldId,
    onAddPropertyLeft,
    onAddPropertyRight,
    onHideProperty,
    onDuplicateProperty,
  ]);

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
              <DropdownMenuShortcut
                onSelect={e => {
                  e.preventDefault();
                }}
                className={'flex items-center'}
              >
                <Switch
                  onClick={e => {
                    e.stopPropagation();
                  }}
                  checked={wrap}
                  onCheckedChange={e => {
                    onToggleWrap(fieldId, e);
                  }}
                />
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
      <DeletePropertyConfirm
        fieldId={fieldId}
        onClose={() => {
          setDeleteConfirmOpen(false);
        }}
        open={deleteConfirmOpen}
      />
      <ClearCellsConfirm
        fieldId={fieldId}
        onClose={() => {
          setClearCellsConfirmOpen(false);
        }}
        open={clearCellsConfirmOpen}
      />
    </>

  );
}

export default GridFieldMenu;