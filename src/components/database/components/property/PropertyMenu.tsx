import { FieldType, useFieldSelector } from '@/application/database-yjs';
import {
  useDuplicatePropertyDispatch,
  useHidePropertyDispatch,
} from '@/application/database-yjs/dispatch';
import { YjsDatabaseKey } from '@/application/types';
import DeletePropertyConfirm from '@/components/database/components/property/DeletePropertyConfirm';
import PropertyProfile from '@/components/database/components/property/PropertyProfile';
import PropertySelectTrigger from '@/components/database/components/property/PropertySelectTrigger';
import TextPropertyMenuContent from '@/components/database/components/property/text/TextPropertyMenuContent';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as HideIcon } from '@/assets/icons/hide.svg';
import { ReactComponent as DuplicateIcon } from '@/assets/icons/duplicate.svg';

function PropertyMenu ({
  fieldId,
  open,
  onClose,
}: {
  fieldId: string;
  open: boolean;
  onClose?: () => void;
}) {
  const onDuplicateProperty = useDuplicatePropertyDispatch();
  const onHideProperty = useHidePropertyDispatch();
  const { field } = useFieldSelector(fieldId);
  const type = Number(field?.get(YjsDatabaseKey.type)) as unknown as FieldType;
  const isPrimary = field?.get(YjsDatabaseKey.is_primary);
  const { t } = useTranslation();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = React.useState(false);
  const operations = useMemo(() => [{
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
    label: t('grid.field.delete'),
    icon: <DeleteIcon />,
    disabled: isPrimary,
    className: 'hover:text-text-error',
    onSelect: () => {
      setDeleteConfirmOpen(true);
    },
  }], [t, isPrimary, onHideProperty, fieldId, onDuplicateProperty]);

  const propertyContent = useMemo(() => {
    switch (type) {
      case FieldType.RichText:
        return <TextPropertyMenuContent fieldId={fieldId} />;
      default:
        return <PropertySelectTrigger fieldId={fieldId} />;
    }
  }, [fieldId, type]);

  return (
    <>
      <DropdownMenu
        open={open}
        onOpenChange={status => {
          if (!status) {
            onClose?.();
          }
        }}
      >
        <DropdownMenuTrigger asChild>
          <div
            className={'absolute w-full bottom-0 left-0'}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          onCloseAutoFocus={e => e.preventDefault()}
        >
          <PropertyProfile
            className={'mb-2'}
            fieldId={fieldId}
          />
          {propertyContent}
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            {
              operations.map((operation) => (
                <DropdownMenuItem
                  onPointerMove={e => e.preventDefault()}
                  onPointerEnter={e => e.preventDefault()}
                  onPointerLeave={e => e.preventDefault()}
                  disabled={operation.disabled}
                  onSelect={operation.onSelect}
                  key={operation.label}
                  className={operation.className}
                >
                  {operation.icon}
                  {operation.label}
                </DropdownMenuItem>
              ))
            }
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <DeletePropertyConfirm
        fieldId={fieldId}
        onClose={() => {
          setDeleteConfirmOpen(false);
        }}
        open={deleteConfirmOpen}
      />
    </>

  );
}

export default PropertyMenu;