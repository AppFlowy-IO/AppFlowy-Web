import dayjs from 'dayjs';
import * as Y from 'yjs';

import { cloneDatabaseCell } from '@/application/database-yjs/cell.clone';
import { FieldType, FilterType, isAttributionFieldType } from '@/application/database-yjs/database.type';
import { parseRelationTypeOption } from '@/application/database-yjs/fields/relation/parse';
import { RelationLimit } from '@/application/database-yjs/fields/relation/relation.type';
import {
  dateFilterFillData,
  filterFillData,
  getFilterChildren,
  normalizeFilterNode,
  relationFilterFillData,
} from '@/application/database-yjs/filter';
import { normalizeGroupIdentifiers } from '@/application/database-yjs/group';
import { applyTemplateCellsToRow, DatabaseRowTemplate } from '@/application/database-yjs/template';
import {
  FieldId,
  YDatabase,
  YDatabaseCell,
  YDatabaseCells,
  YDatabaseFilter,
  YDatabaseFilters,
  YDatabaseRow,
  YjsDatabaseKey,
} from '@/application/types';

export type NewRowCellsData = Record<
  FieldId,
  | string
  | {
      data: string;
      endTimestamp?: string;
      isRange?: boolean;
      includeTime?: boolean;
      reminderId?: string;
    }
>;

export function collectNewRowPrefillFilters(filters: YDatabaseFilters | undefined): YDatabaseFilter[] {
  if (!filters) return [];

  const leaves: YDatabaseFilter[] = [];
  const visit = (rawNode: unknown) => {
    const node = normalizeFilterNode(rawNode);

    if (!node) return;

    const rawType = node.get(YjsDatabaseKey.filter_type);
    const parsedType = Number(rawType);
    const type =
      rawType === undefined || rawType === null || !Number.isFinite(parsedType) ? FilterType.Data : parsedType;

    if (type === FilterType.Data) {
      leaves.push(node);
      return;
    }

    const children = getFilterChildren(node);

    if (type === FilterType.And) {
      children.forEach(visit);
      return;
    }

    if (type === FilterType.Or && children.length > 0) {
      visit(children[0]);
    }
  };

  filters.toArray().forEach(visit);
  return leaves;
}

/** Shared by ephemeral calendar drafts and persisted row creation. */
export function populateNewRowCells({
  row,
  database,
  filters,
  template,
  cellsData,
  initialCells,
  calendarFieldId,
}: {
  row: YDatabaseRow;
  database: YDatabase;
  filters?: YDatabaseFilters;
  template?: DatabaseRowTemplate;
  cellsData?: NewRowCellsData;
  initialCells?: YDatabaseCells;
  calendarFieldId?: string;
}) {
  const cells = row.get(YjsDatabaseKey.cells);
  const filterArray = collectNewRowPrefillFilters(filters);
  let shouldOpenRowModal = (filters?.length ?? 0) > 0;
  const relationPrefills = new Map<FieldId, string[]>();

  if (template) {
    const appliedCells = applyTemplateCellsToRow(row, database, template.defaultCells);

    // Template relation defaults join the same reciprocal-backfill queue
    // as filter prefills. A later filter prefill on the same field
    // overwrites both the cell and this queue entry, so the backfill
    // always mirrors the final cell state.
    Object.entries(appliedCells).forEach(([fieldId, value]) => {
      if (value.type === 'relation' && value.value.length > 0) {
        relationPrefills.set(fieldId, value.value);
      }
    });
  }

  filterArray.forEach((filter) => {
    const cell = new Y.Map() as YDatabaseCell;
    const fieldId = filter.get(YjsDatabaseKey.field_id);
    const field = database.get(YjsDatabaseKey.fields)?.get(fieldId);

    if (!field) {
      return;
    }

    // Desktop deliberately leaves the primary title empty when a row is
    // created under an active filter. The filtered-out row is completed
    // through the row detail page; secondary fields can still inherit
    // their filter values.
    if (field.get(YjsDatabaseKey.is_primary)) {
      return;
    }

    if (calendarFieldId === fieldId) {
      shouldOpenRowModal = true;
    }

    const type = Number(field.get(YjsDatabaseKey.type));

    if (isAttributionFieldType(type)) {
      shouldOpenRowModal = true;
      return;
    }

    if (type === FieldType.DateTime) {
      const { data, endTimestamp, isRange } = dateFilterFillData(filter);

      if (data !== null) {
        cell.set(YjsDatabaseKey.data, data);
      }

      if (endTimestamp) {
        cell.set(YjsDatabaseKey.end_timestamp, endTimestamp);
      }

      if (isRange) {
        cell.set(YjsDatabaseKey.is_range, isRange);
      }
    } else if ([FieldType.CreatedTime, FieldType.LastEditedTime].includes(type)) {
      shouldOpenRowModal = true;
      return;
    } else if (type === FieldType.Relation) {
      const rowIds = relationFilterFillData(
        String(filter.get(YjsDatabaseKey.content) ?? ''),
        Number(filter.get(YjsDatabaseKey.condition))
      );

      if (!rowIds) {
        return;
      }

      // Enforce source_limit synchronously so OneOnly relations don't
      // silently end up with multiple linked rows when the filter has
      // several values selected.
      const typeOption = parseRelationTypeOption(field);
      const limitedRowIds =
        typeOption.source_limit === RelationLimit.OneOnly && rowIds.length > 1 ? [rowIds[rowIds.length - 1]] : rowIds;

      const data = new Y.Array<string>();

      if (limitedRowIds.length > 0) {
        data.push([...limitedRowIds]);
        relationPrefills.set(fieldId, limitedRowIds);
      } else {
        // An earlier filter on this same field may have queued IDs;
        // an empty later filter must clear that queue so the backfill
        // doesn't write reciprocals to rows the source no longer links.
        relationPrefills.delete(fieldId);
      }

      cell.set(YjsDatabaseKey.data, data);
    } else {
      const data = filterFillData(filter, field);

      if (data === null) {
        return;
      }

      cell.set(YjsDatabaseKey.data, data);
    }

    cell.set(YjsDatabaseKey.created_at, String(dayjs().unix()));
    cell.set(YjsDatabaseKey.field_type, type);

    cells.set(fieldId, cell);
  });

  if (cellsData) {
    Object.entries(cellsData).forEach(([fieldId, data]) => {
      const cell = new Y.Map() as YDatabaseCell;
      const field = database.get(YjsDatabaseKey.fields)?.get(fieldId);

      if (!field) return;

      // The raw cell payload replaces whatever a template or filter
      // wrote for this field, so any queued reciprocal backfill for it
      // would no longer match the final cell state.
      relationPrefills.delete(fieldId);

      const type = Number(field.get(YjsDatabaseKey.type));

      if (isAttributionFieldType(type)) return;

      const rawData = typeof data === 'object' ? data.data : data;

      cell.set(YjsDatabaseKey.created_at, String(dayjs().unix()));
      cell.set(YjsDatabaseKey.field_type, type);

      if (type === FieldType.Relation) {
        const relationOption = parseRelationTypeOption(field);
        const identifiers = normalizeGroupIdentifiers(rawData);
        const rowIds =
          relationOption.source_limit === RelationLimit.OneOnly && identifiers.length > 1
            ? [identifiers[identifiers.length - 1]]
            : identifiers;
        const relationData = new Y.Array<string>();

        if (rowIds.length > 0) {
          relationData.push(rowIds);
          relationPrefills.set(fieldId, rowIds);
        }

        cell.set(YjsDatabaseKey.data, relationData);
      } else if (typeof data === 'object') {
        cell.set(YjsDatabaseKey.data, data.data);
        cell.set(YjsDatabaseKey.end_timestamp, data.endTimestamp);
        cell.set(YjsDatabaseKey.is_range, data.isRange);
        cell.set(YjsDatabaseKey.include_time, data.includeTime);
        cell.set(YjsDatabaseKey.reminder_id, data.reminderId);
      } else {
        cell.set(YjsDatabaseKey.data, data);
      }

      cells.set(fieldId, cell);
    });
  }

  // Draft cells override defaults as a complete snapshot, including explicit
  // empty values and nested Y.Array data used by media, people and relations.
  if (initialCells) {
    cells.clear();
    relationPrefills.clear();
    initialCells.forEach((value, fieldId) => {
      const cell = value as YDatabaseCell;
      const field = database.get(YjsDatabaseKey.fields)?.get(fieldId);

      if (!field) return;
      const type = Number(field.get(YjsDatabaseKey.type));

      if (isAttributionFieldType(type) || type === FieldType.CreatedTime || type === FieldType.LastEditedTime) return;
      cells.set(fieldId, cloneDatabaseCell(type, cell));
      if (type === FieldType.Relation) {
        const data = cell.get(YjsDatabaseKey.data);
        const ids = data instanceof Y.Array ? data.toArray() : normalizeGroupIdentifiers(data);

        if (ids.length) relationPrefills.set(fieldId, ids);
      }
    });
  }

  return { relationPrefills, shouldOpenRowModal };
}
