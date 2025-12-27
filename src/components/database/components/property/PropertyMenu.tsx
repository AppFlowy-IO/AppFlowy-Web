import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType, FieldVisibility, useFieldSelector, useFieldVisibility } from '@/application/database-yjs';
import {
  useDuplicatePropertyDispatch,
  useHidePropertyDispatch,
  useShowPropertyDispatch,
} from '@/application/database-yjs/dispatch';
import { YjsDatabaseKey } from '@/application/types';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as DuplicateIcon } from '@/assets/icons/duplicate.svg';
import { ReactComponent as HideIcon } from '@/assets/icons/hide.svg';
import { ReactComponent as ShowIcon } from '@/assets/icons/show.svg';
import DataTimePropertyMenuContent from '@/components/database/components/property/date/DataTimePropertyMenuContent';
import DeletePropertyConfirm from '@/components/database/components/property/DeletePropertyConfirm';
import FileMediaPropertyMenuContent from '@/components/database/components/property/media/FileMediaPropertyMenuContent';
import NumberPropertyMenuContent from '@/components/database/components/property/number/NumberPropertyMenuContent';
import PropertyProfile from '@/components/database/components/property/PropertyProfile';
import PropertySelectTrigger from '@/components/database/components/property/PropertySelectTrigger';
import RelationPropertyMenuContent from '@/components/database/components/property/relation/RelationPropertyMenuContent';
import RollupPropertyMenuContent from '@/components/database/components/property/rollup/RollupPropertyMenuContent';
import SelectPropertyMenuContent from '@/components/database/components/property/select/SelectPropertyMenuContent';
import TranslatePropertyMenuContext from '@/components/database/components/property/translate/TranslatePropertyMenuContext';
import { isFieldEditingDisabled } from '@/components/database/utils/field-editing';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

function PropertyMenu({
  fieldId,
  open,
  onOpenChange,
  children,
}: {
  fieldId: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
}) {
  const onDuplicateProperty = useDuplicatePropertyDispatch();
  const visibility = useFieldVisibility(fieldId);
  const onHideProperty = useHidePropertyDispatch();
  const onShowProperty = useShowPropertyDispatch();
  const { field } = useFieldSelector(fieldId);
  const type = Number(field?.get(YjsDatabaseKey.type)) as unknown as FieldType;
  const isEditingDisabled = isFieldEditingDisabled(type);
  const isPrimary = field?.get(YjsDatabaseKey.is_primary);
  const { t } = useTranslation();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = React.useState(false);
  const operations = useMemo(
    () => [
      {
        label: visibility === FieldVisibility.AlwaysHidden ? t('grid.field.show') : t('grid.field.hide'),
        icon: visibility === FieldVisibility.AlwaysHidden ? <ShowIcon /> : <HideIcon />,
        onSelect: () => {
          if (visibility === FieldVisibility.AlwaysHidden) {
            onShowProperty(fieldId);
            return;
          }

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
        label: t('grid.field.delete'),
        icon: <DeleteIcon />,
        disabled: isPrimary,
        variant: 'destructive',
        onSelect: () => {
          setDeleteConfirmOpen(true);
        },
      },
    ],
    [visibility, t, isPrimary, onHideProperty, fieldId, onShowProperty, onDuplicateProperty]
  );

  const propertyContent = useMemo(() => {
    const props = {
      fieldId,
    };

    switch (type) {
      case FieldType.Number:
        return <NumberPropertyMenuContent {...props} />;
      case FieldType.SingleSelect:
      case FieldType.MultiSelect:
        return <SelectPropertyMenuContent {...props} />;
      case FieldType.DateTime:
        return <DataTimePropertyMenuContent {...props} />;
      case FieldType.CreatedTime:
      case FieldType.LastEditedTime:
        return <DataTimePropertyMenuContent {...props} enableInclusivitiesTime={true} />;
      case FieldType.Relation:
        return <RelationPropertyMenuContent {...props} />;
      case FieldType.FileMedia:
        return <FileMediaPropertyMenuContent {...props} />;
      case FieldType.AITranslations:
        return <TranslatePropertyMenuContext {...props} />;
      case FieldType.Rollup:
        return <RollupPropertyMenuContent {...props} />;
      default:
        return null;
    }
  }, [fieldId, type]);

  if (isEditingDisabled) {
    return children ? <>{children}</> : null;
  }

  return (
    <>
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
          {children ? children : <div className={'absolute bottom-0 left-0 w-full'} />}
        </DropdownMenuTrigger>
        <DropdownMenuContent side={'bottom'} align={'start'} onCloseAutoFocus={(e) => e.preventDefault()}>
          <PropertyProfile onEnter={() => onOpenChange?.(false)} className={'mb-2'} fieldId={fieldId} />
          {isPrimary ? (
            <Tooltip disableHoverableContent>
              <TooltipTrigger asChild>
                <div>
                  <PropertySelectTrigger fieldId={fieldId} disabled />
                </div>
              </TooltipTrigger>
              <TooltipContent side={'bottom'}>{t('grid.field.switchPrimaryFieldTooltip')}</TooltipContent>
            </Tooltip>
          ) : (
            <PropertySelectTrigger fieldId={fieldId} />
          )}

          {propertyContent}
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            {operations.map((operation) => (
              <DropdownMenuItem
                disabled={operation.disabled}
                onSelect={operation.onSelect}
                key={operation.label}
                variant={operation.variant as 'destructive' | undefined}
                {...([FieldType.MultiSelect, FieldType.SingleSelect].includes(type)
                  ? {
                      onPointerMove: (e) => e.preventDefault(),
                      onPointerEnter: (e) => e.preventDefault(),
                      onPointerLeave: (e) => e.preventDefault(),
                    }
                  : undefined)}
              >
                {operation.icon}
                {operation.label}
              </DropdownMenuItem>
            ))}
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
