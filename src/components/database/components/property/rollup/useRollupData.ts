import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useDatabase, useDatabaseContext } from '@/application/database-yjs/context';
import { CalculationType, FieldType, RollupDisplayMode } from '@/application/database-yjs/database.type';
import { useUpdateRollupTypeOption } from '@/application/database-yjs/dispatch';
import { parseRelationTypeOption } from '@/application/database-yjs/fields/relation/parse';
import { parseRollupTypeOption, parseRollupVisualizationOption } from '@/application/database-yjs/fields/rollup/parse';
import { RollupShowAsType } from '@/application/database-yjs/fields/rollup/rollup.type';
import { parseSelectOptionTypeOptions } from '@/application/database-yjs/fields/select-option/parse';
import { useFieldSelector } from '@/application/database-yjs/selector';
import { YDatabaseField, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import { getAvailableRollupCalculations } from './utils';

export type RelationFieldOption = {
  id: string;
  name: string;
  databaseId: string;
};

export type TargetFieldOption = {
  id: string;
  name: string;
  type: FieldType;
  field: YDatabaseField;
};

function readTargetFields(doc: YDoc | null): TargetFieldOption[] {
  if (!doc) return [];

  const sharedRoot = doc.getMap(YjsEditorKey.data_section);
  const relatedDatabase = sharedRoot?.get(YjsEditorKey.database);
  const fields = relatedDatabase?.get(YjsDatabaseKey.fields);

  if (!fields) return [];

  const options: TargetFieldOption[] = [];

  fields.forEach((field: YDatabaseField, id: string) => {
    options.push({
      id,
      name: field.get(YjsDatabaseKey.name) || '',
      type: Number(field.get(YjsDatabaseKey.type)) as FieldType,
      field,
    });
  });

  return options;
}

export function useRollupData(fieldId: string) {
  const database = useDatabase();
  const { field, clock } = useFieldSelector(fieldId);
  const { loadView, getViewIdFromDatabaseId } = useDatabaseContext();
  const updateRollupTypeOption = useUpdateRollupTypeOption(fieldId);

  const rollupOption = useMemo(() => {
    const parsed = field ? parseRollupTypeOption(field) : null;

    // The Y.Map reference is stable, so the selector clock is part of the snapshot.
    void clock;

    return {
      relation_field_id: parsed?.relation_field_id ?? '',
      target_field_id: parsed?.target_field_id ?? '',
      calculation_type: parsed?.calculation_type === undefined ? CalculationType.Count : parsed.calculation_type,
      show_as: parsed?.show_as === undefined ? RollupDisplayMode.Calculated : parsed.show_as,
      condition_value: parsed?.condition_value ?? '',
      visualization: parseRollupVisualizationOption(parsed),
    };
  }, [field, clock]);

  const [relationFields, setRelationFields] = useState<RelationFieldOption[]>([]);
  const [relatedFields, setRelatedFields] = useState<TargetFieldOption[]>([]);
  const [loadingRelated, setLoadingRelated] = useState(false);
  const relationSelectionRequest = useRef(0);
  const relatedDocPromises = useRef(new Map<string, Promise<YDoc | null>>());

  useEffect(() => {
    const fields = database?.get(YjsDatabaseKey.fields);

    if (!fields) {
      setRelationFields([]);
      return;
    }

    const updateFields = () => {
      const options: RelationFieldOption[] = [];

      fields.forEach((relationField, id) => {
        if (Number(relationField.get(YjsDatabaseKey.type)) !== FieldType.Relation) return;

        options.push({
          id,
          name: relationField.get(YjsDatabaseKey.name) || '',
          databaseId: parseRelationTypeOption(relationField)?.database_id ?? '',
        });
      });
      setRelationFields(options);
    };

    updateFields();
    fields.observeDeep(updateFields);
    return () => {
      fields.unobserveDeep(updateFields);
    };
  }, [database]);

  const relatedDatabaseId =
    relationFields.find((relation) => relation.id === rollupOption.relation_field_id)?.databaseId ?? '';

  const loadRelatedDoc = useCallback(
    (databaseId: string) => {
      const cached = relatedDocPromises.current.get(databaseId);

      if (cached) return cached;

      const promise = (async () => {
        const viewId = await getViewIdFromDatabaseId?.(databaseId);

        return viewId ? (await loadView?.(viewId)) ?? null : null;
      })();

      relatedDocPromises.current.set(databaseId, promise);
      void promise.then(
        (doc) => {
          if (!doc && relatedDocPromises.current.get(databaseId) === promise) {
            relatedDocPromises.current.delete(databaseId);
          }
        },
        () => {
          if (relatedDocPromises.current.get(databaseId) === promise) {
            relatedDocPromises.current.delete(databaseId);
          }
        }
      );
      return promise;
    },
    [getViewIdFromDatabaseId, loadView]
  );

  useEffect(() => {
    let cancelled = false;
    let stopObserving: (() => void) | undefined;

    if (!relatedDatabaseId) {
      setRelatedFields((current) => (current.length === 0 ? current : []));
      setLoadingRelated(false);
      return;
    }

    setRelatedFields((current) => (current.length === 0 ? current : []));
    setLoadingRelated(true);
    void loadRelatedDoc(relatedDatabaseId)
      .then((doc) => {
        if (cancelled) return;

        const sharedRoot = doc?.getMap(YjsEditorKey.data_section);
        const relatedDatabase = sharedRoot?.get(YjsEditorKey.database);
        const fields = relatedDatabase?.get(YjsDatabaseKey.fields);

        if (!doc || !fields) {
          setRelatedFields([]);
          return;
        }

        const updateRelatedFields = () => setRelatedFields(readTargetFields(doc));

        updateRelatedFields();
        fields.observeDeep(updateRelatedFields);
        stopObserving = () => fields.unobserveDeep(updateRelatedFields);
      })
      .catch(() => {
        if (!cancelled) {
          relatedDocPromises.current.delete(relatedDatabaseId);
          setRelatedFields([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingRelated(false);
      });

    return () => {
      cancelled = true;
      stopObserving?.();
    };
  }, [loadRelatedDoc, relatedDatabaseId]);

  const targetField = relatedFields.find((target) => target.id === rollupOption.target_field_id);
  const availableCalculations = useMemo(() => getAvailableRollupCalculations(targetField?.type), [targetField?.type]);

  // Keep imported/remote options valid even when another client changes the target.
  useEffect(() => {
    if (targetField?.type === undefined) return;
    if (availableCalculations.includes(rollupOption.calculation_type as CalculationType)) return;

    updateRollupTypeOption({ calculation_type: CalculationType.Count, condition_value: '' });
  }, [availableCalculations, rollupOption.calculation_type, targetField?.type, updateRollupTypeOption]);

  useEffect(() => {
    if (rollupOption.calculation_type === CalculationType.CountValue || !rollupOption.condition_value) return;

    updateRollupTypeOption({ condition_value: '' });
  }, [rollupOption.calculation_type, rollupOption.condition_value, updateRollupTypeOption]);

  const selectRelationField = useCallback(
    async (relation: RelationFieldOption) => {
      const request = relationSelectionRequest.current + 1;

      relationSelectionRequest.current = request;
      updateRollupTypeOption({
        relation_field_id: relation.id,
        target_field_id: '',
        calculation_type: CalculationType.Count,
        show_as: RollupDisplayMode.Calculated,
        condition_value: '',
        visualization_type: RollupShowAsType.Number,
      });

      if (!relation.databaseId) return;

      try {
        const doc = await loadRelatedDoc(relation.databaseId);
        const firstTarget = readTargetFields(doc)[0];
        const latestOption = parseRollupTypeOption(field);

        if (
          relationSelectionRequest.current !== request ||
          latestOption?.relation_field_id !== relation.id ||
          latestOption.target_field_id ||
          !firstTarget
        ) {
          return;
        }

        updateRollupTypeOption({
          target_field_id: firstTarget.id,
          calculation_type: CalculationType.Count,
          condition_value: '',
        });
      } catch {
        relatedDocPromises.current.delete(relation.databaseId);
      }
    },
    [field, loadRelatedDoc, updateRollupTypeOption]
  );

  const selectTargetField = useCallback(
    (target: TargetFieldOption) => {
      relationSelectionRequest.current += 1;
      const currentCalculation = rollupOption.calculation_type as CalculationType;
      const nextCalculation = getAvailableRollupCalculations(target.type).includes(currentCalculation)
        ? currentCalculation
        : CalculationType.Count;

      updateRollupTypeOption({
        target_field_id: target.id,
        calculation_type: nextCalculation,
        condition_value: '',
        ...(target.type === FieldType.Number ? {} : { visualization_type: RollupShowAsType.Number }),
      });
    },
    [rollupOption.calculation_type, updateRollupTypeOption]
  );

  const selectOptions = useMemo(() => {
    if (!targetField || ![FieldType.SingleSelect, FieldType.MultiSelect].includes(targetField.type)) return [];

    return parseSelectOptionTypeOptions(targetField.field)?.options || [];
  }, [targetField]);

  return {
    rollupOption,
    relationFields,
    relatedFields,
    targetField,
    selectOptions,
    loadingRelated,
    selectRelationField,
    selectTargetField,
    updateRollupTypeOption,
  };
}
