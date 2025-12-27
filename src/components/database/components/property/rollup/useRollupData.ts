import { useEffect, useMemo, useState } from 'react';

import {
  CalculationType,
  FieldType,
  RollupDisplayMode,
  parseRelationTypeOption,
  parseRollupTypeOption,
  parseSelectOptionTypeOptions,
  useDatabase,
  useDatabaseContext,
  useFieldSelector,
} from '@/application/database-yjs';
import { useUpdateRollupTypeOption } from '@/application/database-yjs/dispatch';
import { YDatabaseField, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import { getAvailableRollupCalculations } from './utils';

export type RelationFieldOption = {
  id: string;
  name: string;
};

export type TargetFieldOption = {
  id: string;
  name: string;
  type: FieldType;
  field: YDatabaseField;
};

export function useRollupData(fieldId: string) {
  const database = useDatabase();
  const { field, clock } = useFieldSelector(fieldId);
  const { loadView, getViewIdFromDatabaseId } = useDatabaseContext();
  const updateRollupTypeOption = useUpdateRollupTypeOption(fieldId);

  const rollupOption = useMemo(() => {
    const parsed = field ? parseRollupTypeOption(field) : null;

    // Recompute when the field clock updates even if the field reference is stable.
    void clock;

    return {
      relation_field_id: parsed?.relation_field_id ?? '',
      target_field_id: parsed?.target_field_id ?? '',
      calculation_type:
        parsed?.calculation_type === undefined ? CalculationType.Count : parsed?.calculation_type,
      show_as: parsed?.show_as === undefined ? RollupDisplayMode.Calculated : parsed?.show_as,
      condition_value: parsed?.condition_value ?? '',
    };
  }, [field, clock]);

  const [relationFields, setRelationFields] = useState<RelationFieldOption[]>([]);
  const [relatedFields, setRelatedFields] = useState<TargetFieldOption[]>([]);
  const [loadingRelated, setLoadingRelated] = useState(false);
  const [relatedDoc, setRelatedDoc] = useState<YDoc | null>(null);

  useEffect(() => {
    const fields = database?.get(YjsDatabaseKey.fields);

    if (!fields) {
      setRelationFields([]);
      return;
    }

    const updateFields = () => {
      const options: RelationFieldOption[] = [];

      fields.forEach((field, id) => {
        if (Number(field.get(YjsDatabaseKey.type)) === FieldType.Relation) {
          options.push({ id, name: field.get(YjsDatabaseKey.name) || '' });
        }
      });
      setRelationFields(options);
    };

    updateFields();
    fields.observeDeep(updateFields);
    return () => {
      fields.unobserveDeep(updateFields);
    };
  }, [database]);

  const relationField = useMemo(() => {
    const fields = database?.get(YjsDatabaseKey.fields);

    if (!fields || !rollupOption.relation_field_id) return undefined;
    return fields.get(rollupOption.relation_field_id);
  }, [database, rollupOption.relation_field_id]);

  const relatedDatabaseId = useMemo(() => {
    return relationField ? parseRelationTypeOption(relationField)?.database_id ?? '' : '';
  }, [relationField]);

  useEffect(() => {
    let cancelled = false;

    if (!relatedDatabaseId) {
      setRelatedDoc(null);
      setRelatedFields([]);
      return;
    }

    void (async () => {
      setLoadingRelated(true);
      try {
        const viewId = await getViewIdFromDatabaseId?.(relatedDatabaseId);

        if (!viewId) {
          setRelatedDoc(null);
          setRelatedFields([]);
          return;
        }

        const doc = await loadView?.(viewId);

        if (!doc) {
          setRelatedDoc(null);
          setRelatedFields([]);
          return;
        }

        if (!cancelled) {
          setRelatedDoc(doc);
        }
      } catch (error) {
        if (!cancelled) {
          setRelatedDoc(null);
          setRelatedFields([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingRelated(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [relatedDatabaseId, getViewIdFromDatabaseId, loadView]);

  useEffect(() => {
    if (!relatedDoc) {
      setRelatedFields([]);
      return;
    }

    const sharedRoot = relatedDoc.getMap(YjsEditorKey.data_section);
    const relatedDatabase = sharedRoot?.get(YjsEditorKey.database);
    const fields = relatedDatabase?.get(YjsDatabaseKey.fields);

    if (!fields) {
      setRelatedFields([]);
      return;
    }

    const updateRelatedFields = () => {
      const options: TargetFieldOption[] = [];

      fields.forEach((field: YDatabaseField, id: string) => {
        options.push({
          id,
          name: field.get(YjsDatabaseKey.name) || '',
          type: Number(field.get(YjsDatabaseKey.type)) as FieldType,
          field,
        });
      });
      setRelatedFields(options);
    };

    updateRelatedFields();
    fields.observeDeep(updateRelatedFields);
    return () => {
      fields.unobserveDeep(updateRelatedFields);
    };
  }, [relatedDoc]);

  const targetField = useMemo(
    () => relatedFields.find((field) => field.id === rollupOption.target_field_id),
    [relatedFields, rollupOption.target_field_id]
  );

  const availableCalculations = useMemo(
    () => getAvailableRollupCalculations(targetField?.type),
    [targetField?.type]
  );

  useEffect(() => {
    if (!targetField?.type) return;
    if (!availableCalculations.includes(rollupOption.calculation_type as CalculationType)) {
      updateRollupTypeOption({
        calculation_type: CalculationType.Count,
        condition_value: '',
      });
    }
  }, [availableCalculations, rollupOption.calculation_type, targetField?.type, updateRollupTypeOption]);

  useEffect(() => {
    if (rollupOption.calculation_type !== CalculationType.CountValue && rollupOption.condition_value) {
      updateRollupTypeOption({ condition_value: '' });
    }
  }, [rollupOption.calculation_type, rollupOption.condition_value, updateRollupTypeOption]);

  const selectOptions = useMemo(() => {
    if (!targetField) return [];
    if (![FieldType.SingleSelect, FieldType.MultiSelect].includes(targetField.type)) {
      return [];
    }

    return parseSelectOptionTypeOptions(targetField.field)?.options || [];
  }, [targetField]);

  return {
    rollupOption,
    relationFields,
    relatedFields,
    targetField,
    selectOptions,
    loadingRelated,
    updateRollupTypeOption,
  };
}
