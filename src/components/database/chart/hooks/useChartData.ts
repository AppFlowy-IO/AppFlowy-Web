import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  useDatabaseContext,
  useDatabaseFields,
  useRowDocMap,
  useRowOrdersSelector,
} from '@/application/database-yjs';
import {
  ChartAggregationType,
  ChartDataItem,
  ChartLayoutSettings,
  EMPTY_VALUE_COLOR,
  isGroupableFieldType,
} from '@/application/database-yjs/chart.type';
import { FieldType } from '@/application/database-yjs/database.type';
import { parseSelectOptionTypeOptions, SelectOption } from '@/application/database-yjs/fields';
import { getCellData } from '@/application/database-yjs/const';
import { YjsDatabaseKey, YjsEditorKey, YDatabaseField, YDatabaseRow, RowId, YDoc } from '@/application/types';
import { useChartColors } from './useChartColors';

interface GroupedData {
  label: string;
  optionId?: string;
  rowIds: RowId[];
  isEmptyCategory: boolean;
}

/**
 * Get cell value for grouping (x-axis field)
 */
function getCellGroupValue(
  rowId: string,
  fieldId: string,
  fieldType: FieldType,
  rowMetas: Record<RowId, YDoc>
): string[] {
  // Debug: trace through the data access chain
  const rowDoc = rowMetas[rowId];
  const dataSection = rowDoc?.getMap(YjsEditorKey.data_section);
  const databaseRow = dataSection?.get(YjsEditorKey.database_row) as YDatabaseRow | undefined;
  const cells = databaseRow?.get(YjsDatabaseKey.cells);
  const cell = cells?.get(fieldId);
  const data = cell?.get(YjsDatabaseKey.data);

  switch (fieldType) {
    case FieldType.SingleSelect: {
      if (typeof data === 'string' && data.length > 0) {
        // SingleSelect stores a single option ID
        return [data];
      }
      return [];
    }
    case FieldType.MultiSelect: {
      if (typeof data === 'string' && data.length > 0) {
        // MultiSelect stores comma-separated option IDs
        return data.split(',').filter(Boolean);
      }
      return [];
    }
    case FieldType.Checkbox: {
      // Checkbox stores 'Yes' or 'No' (or empty)
      if (data === 'Yes' || data === true) {
        return ['Checked'];
      }
      return ['Unchecked'];
    }
    default:
      return [];
  }
}

/**
 * Get numeric value for aggregation (y-axis field)
 */
function getCellNumericValue(
  rowId: string,
  fieldId: string,
  rowMetas: Record<RowId, YDoc>
): number | null {
  const data = getCellData(rowId, fieldId, rowMetas);

  if (data === null || data === undefined || data === '') {
    return null;
  }

  const num = typeof data === 'number' ? data : parseFloat(String(data));
  return isNaN(num) || !isFinite(num) ? null : num;
}

/**
 * Compute aggregation on an array of values
 */
function computeAggregation(
  values: number[],
  aggregationType: ChartAggregationType
): number {
  if (values.length === 0) {
    return 0;
  }

  switch (aggregationType) {
    case ChartAggregationType.Count:
      return values.length;
    case ChartAggregationType.Sum:
      return values.reduce((acc, val) => acc + val, 0);
    case ChartAggregationType.Average:
      return values.reduce((acc, val) => acc + val, 0) / values.length;
    case ChartAggregationType.Min:
      return Math.min(...values);
    case ChartAggregationType.Max:
      return Math.max(...values);
    default:
      return values.length;
  }
}

export interface UseChartDataOptions {
  settings: ChartLayoutSettings | null;
}

export interface GroupableField {
  id: string;
  name: string;
  type: FieldType;
}

export interface UseChartDataReturn {
  chartData: ChartDataItem[];
  isLoading: boolean;
  xAxisField: YDatabaseField | null;
  selectOptions: SelectOption[];
  fieldType: FieldType | null;
  /** All fields that can be used for grouping (SingleSelect, MultiSelect, Checkbox) */
  groupableFields: GroupableField[];
  /** Whether there are any groupable fields in the database */
  hasGroupableFields: boolean;
}

/**
 * Hook for computing chart data from database rows
 * Groups rows by x-axis field and applies aggregation
 */
export function useChartData({ settings }: UseChartDataOptions): UseChartDataReturn {
  const fields = useDatabaseFields();
  const rowOrders = useRowOrdersSelector();
  const rowMetas = useRowDocMap();
  const { ensureRowDoc } = useDatabaseContext();

  const [isLoading, setIsLoading] = useState(true);
  const [chartData, setChartData] = useState<ChartDataItem[]>([]);
  const [rowsLoaded, setRowsLoaded] = useState(false);
  const loadedRowIdsRef = useRef<Set<string>>(new Set());

  // Load all row documents when rowOrders change
  useEffect(() => {
    if (!rowOrders || rowOrders.length === 0 || !ensureRowDoc) {
      setRowsLoaded(true);
      return;
    }

    // Find rows that haven't been loaded yet
    const rowsToLoad = rowOrders.filter(row => !loadedRowIdsRef.current.has(row.id));

    if (rowsToLoad.length === 0) {
      // All rows already loaded
      setRowsLoaded(true);
      return;
    }

    setRowsLoaded(false);

    const loadAllRows = async () => {
      // Load all row documents in parallel
      const loadPromises = rowsToLoad.map(row => {
        loadedRowIdsRef.current.add(row.id);
        return ensureRowDoc(row.id);
      });
      await Promise.all(loadPromises);
      setRowsLoaded(true);
    };

    void loadAllRows();
  }, [rowOrders, ensureRowDoc]);

  // Check if rowMetas is actually populated after loading
  const rowMetasReady = useMemo(() => {
    if (!rowOrders || rowOrders.length === 0) return true;
    if (!rowMetas) return false;

    // Check if at least some row docs are available
    const rowMetasCount = Object.keys(rowMetas).length;
    return rowMetasCount > 0;
  }, [rowOrders, rowMetas]);

  // Find all groupable fields (SingleSelect, MultiSelect, Checkbox)
  const groupableFields = useMemo<GroupableField[]>(() => {
    if (!fields) return [];
    const result: GroupableField[] = [];
    fields.forEach((field, fieldId) => {
      const fieldType = Number(field.get(YjsDatabaseKey.type)) as FieldType;
      if (isGroupableFieldType(fieldType)) {
        result.push({
          id: fieldId,
          name: String(field.get(YjsDatabaseKey.name) || ''),
          type: fieldType,
        });
      }
    });
    return result;
  }, [fields]);

  const hasGroupableFields = groupableFields.length > 0;

  // Resolve x-axis field: use settings.xFieldId if valid, otherwise auto-select first groupable field
  const resolvedXFieldId = useMemo(() => {
    if (!hasGroupableFields) return null;

    // Check if settings.xFieldId is valid (exists and is groupable)
    if (settings?.xFieldId) {
      const isValidGroupableField = groupableFields.some(f => f.id === settings.xFieldId);
      if (isValidGroupableField) {
        return settings.xFieldId;
      }
    }

    // Auto-select first groupable field (same as Flutter behavior)
    return groupableFields[0].id;
  }, [settings?.xFieldId, groupableFields, hasGroupableFields]);

  // Get x-axis field using resolved field ID
  const xAxisField = useMemo(() => {
    if (!resolvedXFieldId || !fields) return null;
    return fields.get(resolvedXFieldId) ?? null;
  }, [resolvedXFieldId, fields]);

  // Get field type
  const fieldType = useMemo(() => {
    if (!xAxisField) return null;
    return Number(xAxisField.get(YjsDatabaseKey.type)) as FieldType;
  }, [xAxisField]);

  // Parse select options from field type options
  const selectOptions = useMemo(() => {
    if (!xAxisField) return [];
    if (fieldType !== FieldType.SingleSelect && fieldType !== FieldType.MultiSelect) {
      return [];
    }
    return parseSelectOptionTypeOptions(xAxisField)?.options ?? [];
  }, [xAxisField, fieldType]);

  // Get colors for the chart
  const { getColorForCategory, emptyColor } = useChartColors({
    fieldType,
    selectOptions,
  });

  // Build option ID to name map
  const optionIdToName = useMemo(() => {
    const map = new Map<string, string>();
    selectOptions.forEach((opt) => {
      map.set(opt.id, opt.name);
    });
    return map;
  }, [selectOptions]);

  // Compute chart data when dependencies change
  const computeChartData = useCallback(() => {
    if (!rowOrders || !rowMetas || !xAxisField || !resolvedXFieldId) {
      setChartData([]);
      setIsLoading(false);
      return;
    }

    const xFieldType = fieldType;
    const { yFieldId, aggregationType, showEmptyValues = true } = settings ?? {
      aggregationType: ChartAggregationType.Count,
    };

    if (!xFieldType) {
      setChartData([]);
      setIsLoading(false);
      return;
    }

    // Group rows by x-axis field value
    const groups = new Map<string, GroupedData>();
    const emptyGroup: GroupedData = {
      label: `No ${xAxisField.get(YjsDatabaseKey.name) || 'Value'}`,
      rowIds: [],
      isEmptyCategory: true,
    };

    rowOrders.forEach((row) => {
      const rowId = row.id;
      const groupValues = getCellGroupValue(rowId, resolvedXFieldId, xFieldType, rowMetas);

      if (groupValues.length === 0) {
        // Row has no value for this field - add to empty group
        emptyGroup.rowIds.push(rowId);
      } else {
        // For each group value (MultiSelect can have multiple)
        groupValues.forEach((value) => {
          let label = value;
          let optionId: string | undefined;

          // For select fields, map option ID to name
          if (xFieldType === FieldType.SingleSelect || xFieldType === FieldType.MultiSelect) {
            optionId = value;
            label = optionIdToName.get(value) || value;
          }

          if (!groups.has(label)) {
            groups.set(label, {
              label,
              optionId,
              rowIds: [],
              isEmptyCategory: false,
            });
          }

          groups.get(label)!.rowIds.push(rowId);
        });
      }
    });

    // Add empty group if it has rows and showEmptyValues is true
    if (showEmptyValues && emptyGroup.rowIds.length > 0) {
      groups.set(emptyGroup.label, emptyGroup);
    }

    // Compute aggregation for each group
    const data: ChartDataItem[] = [];
    let colorIndex = 0;

    groups.forEach((group) => {
      let value: number;

      if (aggregationType === ChartAggregationType.Count) {
        // Count: just count the rows
        value = group.rowIds.length;
      } else if (yFieldId) {
        // Sum/Average/Min/Max: aggregate y-field values
        const numericValues = group.rowIds
          .map((rowId) => getCellNumericValue(rowId, yFieldId, rowMetas))
          .filter((v): v is number => v !== null);

        value = computeAggregation(numericValues, aggregationType);
      } else {
        // No y-field specified, use count
        value = group.rowIds.length;
      }

      const color = group.isEmptyCategory
        ? emptyColor
        : getColorForCategory(group.label, group.optionId, colorIndex);

      data.push({
        label: group.label,
        value,
        rowIds: group.rowIds,
        color,
        isEmptyCategory: group.isEmptyCategory,
      });

      if (!group.isEmptyCategory) {
        colorIndex++;
      }
    });

    // Sort data: alphabetically, with empty category last
    data.sort((a, b) => {
      if (a.isEmptyCategory) return 1;
      if (b.isEmptyCategory) return -1;
      return a.label.localeCompare(b.label);
    });

    setChartData(data);
    setIsLoading(false);
  }, [settings, resolvedXFieldId, rowOrders, rowMetas, xAxisField, fieldType, optionIdToName, getColorForCategory, emptyColor]);

  // Recompute when data changes and rows are loaded
  useEffect(() => {
    // Don't compute until rows are loaded and rowMetas is ready
    if (!rowsLoaded || !rowMetasReady) {
      setIsLoading(true);
      return;
    }

    setIsLoading(true);
    // Debounce the computation slightly to avoid rapid updates
    const timer = setTimeout(() => {
      computeChartData();
    }, 100);

    return () => clearTimeout(timer);
  }, [computeChartData, rowsLoaded, rowMetasReady]);

  return {
    chartData,
    isLoading,
    xAxisField,
    selectOptions,
    fieldType,
    groupableFields,
    hasGroupableFields,
  };
}

export default useChartData;
