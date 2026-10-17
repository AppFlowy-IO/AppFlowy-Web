import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType, FieldVisibility, useFieldSelector, useFieldVisibility } from '@/application/database-yjs';
import {
  useDuplicatePropertyDispatch,
  useHidePropertyDispatch,
  useShowPropertyDispatch,
  useSwitchPropertyType,
  useUpdatePropertyNameDispatch,
} from '@/application/database-yjs/dispatch';
import { useUpdateRelationTypeOption } from '@/application/database-yjs/dispatch/relation';
import { RelationLimit } from '@/application/database-yjs/fields/relation/relation.type';
import { YjsDatabaseKey } from '@/application/types';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as DuplicateIcon } from '@/assets/icons/duplicate.svg';
import { ReactComponent as HideIcon } from '@/assets/icons/hide.svg';
import { ReactComponent as ShowIcon } from '@/assets/icons/show.svg';
import DataTimePropertyMenuContent from '@/components/database/components/property/date/DataTimePropertyMenuContent';
import DeletePropertyConfirm from '@/components/database/components/property/DeletePropertyConfirm';
import FormulaPropertyMenuContent from '@/components/database/components/property/formula/FormulaPropertyMenuContent';
import FileMediaPropertyMenuContent from '@/components/database/components/property/media/FileMediaPropertyMenuContent';
import NumberPropertyMenuContent from '@/components/database/components/property/number/NumberPropertyMenuContent';
import {
  PropertyMenuContent,
  PropertyMenuOperation,
} from '@/components/database/components/property/PropertyMenuContent';
import PropertyProfile from '@/components/database/components/property/PropertyProfile';
import PropertySelectTrigger from '@/components/database/components/property/PropertySelectTrigger';
import RelationCreationDialog, {
  RelationCreationResult,
} from '@/components/database/components/property/relation/RelationCreationDialog';
import RelationPropertyMenuContent from '@/components/database/components/property/relation/RelationPropertyMenuContent';
import RollupPropertyMenuContent from '@/components/database/components/property/rollup/RollupPropertyMenuContent';
import SelectPropertyMenuContent from '@/components/database/components/property/select/SelectPropertyMenuContent';
import TranslatePropertyMenuContext from '@/components/database/components/property/translate/TranslatePropertyMenuContext';
import { isFieldEditingDisabled } from '@/components/database/utils/field-editing';
import { useVerificationPropertyConversion } from '@/components/page-verification/useVerificationPropertyConversion';
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Log } from '@/utils/log';

const FormulaEditorDialog = lazy(() =>
  import('@/components/database/components/property/formula/FormulaEditorDialog').then(
    ({ FormulaEditorDialog: Component }) => ({ default: Component })
  )
);

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
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [relationDialogOpen, setRelationDialogOpen] = useState(false);
  const [formulaDialogOpen, setFormulaDialogOpen] = useState(false);
  const verificationConversion = useVerificationPropertyConversion(fieldId, () => onOpenChange?.(false));
  const switchType = useSwitchPropertyType();
  const updatePropertyName = useUpdatePropertyNameDispatch(fieldId);
  const updateRelationTypeOption = useUpdateRelationTypeOption(fieldId);
  const initialRelationFieldName = field?.get(YjsDatabaseKey.name) || t('grid.field.relationFieldName');

  const handleRequestRelation = useCallback(() => {
    onOpenChange?.(false);
    setRelationDialogOpen(true);
  }, [onOpenChange]);

  // Hosts pass `onOpenChange` inline; read it through a ref so the formula
  // callback (and the menu content memoized on it) stays stable.
  const onOpenChangeRef = useRef(onOpenChange);

  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);

  // The editor is a dialog owned here, not by the menu content: the content
  // unmounts when the dropdown closes, and the dialog must outlive it.
  const handleRequestFormula = useCallback(() => {
    onOpenChangeRef.current?.(false);
    setFormulaDialogOpen(true);
  }, []);

  const handleCreateRelation = useCallback(
    async (result: RelationCreationResult) => {
      setRelationDialogOpen(false);

      try {
        if (type === FieldType.Verification) {
          if (!(await verificationConversion.convert(FieldType.Relation))) return;
        } else await switchType(fieldId, FieldType.Relation);
        updatePropertyName(result.fieldName);
        await updateRelationTypeOption({
          database_id: result.relatedDatabaseId,
          is_two_way: result.isTwoWay,
          reciprocal_field_name: result.reciprocalFieldName,
          source_limit: result.sourceLimit,
          target_limit: RelationLimit.NoLimit,
        });
      } catch (error) {
        Log.warn('[PropertyMenu] Failed to create relation field', { fieldId, error });
      }
    },
    [fieldId, switchType, updatePropertyName, updateRelationTypeOption, type, verificationConversion]
  );
  const operations = useMemo<PropertyMenuOperation[]>(
    () => [
      {
        testId: visibility === FieldVisibility.AlwaysHidden ? 'show' : 'hide',
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
        testId: 'duplicate',
        label: t('grid.field.duplicate'),
        icon: <DuplicateIcon />,
        disabled: isPrimary || type === FieldType.Verification,
        onSelect: () => {
          onDuplicateProperty(fieldId);
        },
      },
      {
        testId: 'delete',
        label: t('grid.field.delete'),
        icon: <DeleteIcon />,
        disabled: isPrimary,
        variant: 'destructive',
        onSelect: () => {
          setDeleteConfirmOpen(true);
        },
      },
    ],
    [visibility, t, isPrimary, type, onHideProperty, fieldId, onShowProperty, onDuplicateProperty]
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
      case FieldType.Media:
        return <FileMediaPropertyMenuContent {...props} />;
      case FieldType.Translate:
        return <TranslatePropertyMenuContext {...props} />;
      case FieldType.Rollup:
        return <RollupPropertyMenuContent {...props} />;
      case FieldType.Formula:
        return <FormulaPropertyMenuContent {...props} onRequestEditor={handleRequestFormula} />;
      default:
        return null;
    }
  }, [fieldId, type, handleRequestFormula]);

  if (isEditingDisabled) {
    return children ? <>{children}</> : null;
  }

  return (
    <>
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
          {children ? children : <div className={'absolute bottom-0 left-0 w-full'} />}
        </DropdownMenuTrigger>
        <PropertyMenuContent
          profile={<PropertyProfile onEnter={() => onOpenChange?.(false)} className='mb-2' fieldId={fieldId} />}
          operations={operations}
          preservePointerFocus={[FieldType.MultiSelect, FieldType.SingleSelect].includes(type)}
          typeSelector={
            isPrimary ? (
              <PropertySelectTrigger fieldId={fieldId} disabled />
            ) : (
              <PropertySelectTrigger
                fieldId={fieldId}
                onRequestRelation={handleRequestRelation}
                onRequestFormula={handleRequestFormula}
                onRequestVerification={verificationConversion.convert}
              />
            )
          }
        >
          {propertyContent}
        </PropertyMenuContent>
      </DropdownMenu>
      {verificationConversion.feedback}
      <DeletePropertyConfirm
        fieldId={fieldId}
        onClose={() => {
          setDeleteConfirmOpen(false);
        }}
        open={deleteConfirmOpen}
      />
      <RelationCreationDialog
        open={relationDialogOpen}
        fieldId={fieldId}
        initialFieldName={initialRelationFieldName}
        onOpenChange={setRelationDialogOpen}
        onCreate={handleCreateRelation}
      />
      {formulaDialogOpen ? (
        <Suspense fallback={null}>
          <FormulaEditorDialog fieldId={fieldId} open={formulaDialogOpen} onOpenChange={setFormulaDialogOpen} />
        </Suspense>
      ) : null}
    </>
  );
}

export default PropertyMenu;
