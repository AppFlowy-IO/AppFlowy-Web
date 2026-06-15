import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { Filter, RelationFilterCondition, useReadOnly } from '@/application/database-yjs';
import { useUpdateFilter } from '@/application/database-yjs/dispatch';
import RelationCellMenuContent from '@/components/database/components/cell/relation/RelationCellMenuContent';
import FieldMenuTitle from '@/components/database/components/filters/filter-menu/FieldMenuTitle';
import RelationFilterConditionsSelect from '@/components/database/components/filters/filter-menu/RelationFilterConditionsSelect';
import { useRelationData } from '@/components/database/components/property/relation/useRelationData';
import { Progress } from '@/components/ui/progress';

function parseRelationFilterRowIds(content: string | undefined) {
  if (!content) return [];

  try {
    const parsed = JSON.parse(content);

    return Array.isArray(parsed) ? parsed.map((id) => String(id)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function RelationFilterMenu({ filter }: { filter: Filter }) {
  const { t } = useTranslation();
  const readOnly = useReadOnly();
  const updateFilter = useUpdateFilter();
  const showPicker = [
    RelationFilterCondition.RelationContains,
    RelationFilterCondition.RelationDoesNotContain,
  ].includes(filter.condition);
  const selectedRowIds = useMemo(() => parseRelationFilterRowIds(filter.content), [filter.content]);
  const { loading, selectedView, relatedDatabaseId } = useRelationData(filter.fieldId, { enabled: showPicker });

  const updateSelectedRowIds = useCallback(
    (rowIds: string[]) => {
      if (readOnly) return;
      updateFilter({
        filterId: filter.id,
        fieldId: filter.fieldId,
        content: JSON.stringify(rowIds),
      });
    },
    [filter.fieldId, filter.id, readOnly, updateFilter]
  );

  const handleAddRelationRowId = useCallback(
    (rowId: string) => {
      if (selectedRowIds.includes(rowId)) return;
      updateSelectedRowIds([...selectedRowIds, rowId]);
    },
    [selectedRowIds, updateSelectedRowIds]
  );

  const handleRemoveRelationRowId = useCallback(
    (rowId: string) => {
      updateSelectedRowIds(selectedRowIds.filter((id) => id !== rowId));
    },
    [selectedRowIds, updateSelectedRowIds]
  );

  return (
    <div className="flex flex-col gap-2" data-testid="relation-filter">
      <FieldMenuTitle
        filterId={filter.id}
        fieldId={filter.fieldId}
        renderConditionSelect={<RelationFilterConditionsSelect filter={filter} />}
      />
      {showPicker ? (
        loading || !selectedView || !relatedDatabaseId ? (
          <div className="flex min-h-[100px] items-center justify-center">
            {loading ? <Progress variant="primary" /> : t('grid.relation.inRelatedDatabase')}
          </div>
        ) : (
          <RelationCellMenuContent
            relationRowIds={selectedRowIds}
            selectedView={selectedView}
            relatedDatabaseId={relatedDatabaseId}
            loading={loading}
            onAddRelationRowId={handleAddRelationRowId}
            onRemoveRelationRowId={handleRemoveRelationRowId}
          />
        )
      ) : null}
    </div>
  );
}

export default RelationFilterMenu;
