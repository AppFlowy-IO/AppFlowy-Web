import React, { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType, useFieldSelector, useFieldWrap } from '@/application/database-yjs';
import {
  useAddPropertyLeftDispatch,
  useAddPropertyRightDispatch,
  useDuplicatePropertyDispatch,
  useHidePropertyDispatch,
  useTogglePropertyWrapDispatch,
} from '@/application/database-yjs/dispatch';
import { YjsDatabaseKey } from '@/application/types';
import { ReactComponent as LeftIcon } from '@/assets/icons/arrow_left.svg';
import { ReactComponent as RightIcon } from '@/assets/icons/arrow_right.svg';
import { ReactComponent as EditIcon } from '@/assets/icons/controller.svg';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as DuplicateIcon } from '@/assets/icons/duplicate.svg';
import { ReactComponent as EraserIcon } from '@/assets/icons/eraser.svg';
import { ReactComponent as HideIcon } from '@/assets/icons/hide.svg';
import ClearCellsConfirm from '@/components/database/components/property/ClearCellsConfirm';
import DeletePropertyConfirm from '@/components/database/components/property/DeletePropertyConfirm';
import PropertyMenu from '@/components/database/components/property/PropertyMenu';
import PropertyProfile from '@/components/database/components/property/PropertyProfile';
import { isFieldEditingDisabled } from '@/components/database/utils/field-editing';
import { useGridContext } from '@/components/database/grid/useGridContext';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';

type FieldOperation = {
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  variant?: 'destructive';
};

function GridFieldMenu({
  fieldId,
  children,
  menuOpen,
  setMenuOpen,
}: {
  fieldId: string;
  children: React.ReactNode;
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
}) {
  const { field } = useFieldSelector(fieldId);
  const isPrimary = field?.get(YjsDatabaseKey.is_primary);
  const type = Number(field?.get(YjsDatabaseKey.type)) as FieldType;
  const isEditingDisabled = isFieldEditingDisabled(type);
  const wrap = useFieldWrap(fieldId);
  const onToggleWrap = useTogglePropertyWrapDispatch();
  const onAddPropertyLeft = useAddPropertyLeftDispatch();
  const onAddPropertyRight = useAddPropertyRightDispatch();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [clearCellsConfirmOpen, setClearCellsConfirmOpen] = useState(false);

  const { activePropertyId, setActivePropertyId } = useGridContext();

  const onDuplicateProperty = useDuplicatePropertyDispatch();
  const onHideProperty = useHidePropertyDispatch();

  const { t } = useTranslation();

  const operations = useMemo<FieldOperation[]>(() => {
    const items: FieldOperation[] = [];

    if (!isEditingDisabled) {
      items.push({
        label: t('grid.field.editProperty'),
        icon: <EditIcon />,
        onSelect: () => {
          setActivePropertyId(fieldId);
          setMenuOpen(false);
        },
      });
    }

    items.push(
      {
        label: t('grid.field.insertLeft'),
        icon: <LeftIcon />,
        onSelect: () => {
          const id = onAddPropertyLeft(fieldId);

          setActivePropertyId(id);
        },
      },
      {
        label: t('grid.field.insertRight'),
        icon: <RightIcon />,
        onSelect: () => {
          const id = onAddPropertyRight(fieldId);

          setActivePropertyId(id);
        },
      },
      {
        label: t('grid.field.hide'),
        icon: <HideIcon />,
        onSelect: () => {
          onHideProperty(fieldId);
        },
      },
      {
        label: t('grid.field.duplicate'),
        icon: <DuplicateIcon />,
        disabled: isPrimary,
        onSelect: () => {
          onDuplicateProperty(fieldId);
        },
      },
      {
        label: t('grid.field.clear'),
        icon: <EraserIcon />,
        onSelect: () => {
          setClearCellsConfirmOpen(true);
        },
      },
      {
        label: t('grid.field.delete'),
        icon: <DeleteIcon />,
        variant: 'destructive',
        disabled: isPrimary,
        onSelect: () => {
          setDeleteConfirmOpen(true);
        },
      }
    );

    return items;
  }, [
    t,
    isPrimary,
    setActivePropertyId,
    fieldId,
    setMenuOpen,
    onAddPropertyLeft,
    onAddPropertyRight,
    onHideProperty,
    onDuplicateProperty,
    isEditingDisabled,
  ]);

  const secondItemRef = useRef<HTMLDivElement | null>(null);

  return (
    <>
      {children}
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button tabIndex={-1} className={'pointer-events-none absolute left-0 right-0 top-0 z-[-1] opacity-0'} />
        </DropdownMenuTrigger>
        <DropdownMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
          {!isEditingDisabled && (
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
          )}
          <DropdownMenuGroup>
            {operations.map((operation, index) => (
              <DropdownMenuItem
                data-testid={operation.label === t('grid.field.editProperty') ? 'grid-field-edit-property' : undefined}
                onPointerMove={(e) => e.preventDefault()}
                onPointerEnter={(e) => e.preventDefault()}
                onPointerLeave={(e) => e.preventDefault()}
                ref={index === 0 ? secondItemRef : undefined}
                disabled={operation.disabled}
                onSelect={operation.onSelect}
                key={operation.label}
                variant={operation.variant}
              >
                {operation.icon}
                {operation.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              onPointerMove={(e) => e.preventDefault()}
              onPointerEnter={(e) => e.preventDefault()}
              onPointerLeave={(e) => e.preventDefault()}
              onSelect={(e) => {
                e.preventDefault();
                onToggleWrap(fieldId, !wrap);
              }}
            >
              {t('grid.field.wrapCellContent')}
              <DropdownMenuShortcut
                onSelect={(e) => {
                  e.preventDefault();
                }}
                className={'flex items-center'}
              >
                <Switch
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                  checked={wrap}
                  onCheckedChange={(e) => {
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
        onOpenChange={(status) => {
          if (!status) {
            setActivePropertyId(undefined);
          }
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
