import { loadParityFixture } from '@/application/database-yjs/__tests__/dashboard-parity-helpers';
import { DashboardRow } from '@/application/database-yjs/dashboard.type';
import { FieldType } from '@/application/database-yjs/database.type';

import { buildGlobalFilterPickerModel, countWidgetsByDatabase, GlobalFilterPickerMode } from '../global-filter.picker';

/** `dashboard-parity/gfilter-picker.json` (WP08 §1.2), shared with desktop. */
interface PickerFixture {
  scenarios: {
    name: string;
    sources: { databaseId: string; name: string; fields: { id: string; name: string; type: FieldType }[] }[];
    rows: { database_id: string; view_id: string }[][];
    cases: {
      name: string;
      mode: GlobalFilterPickerMode;
      can_edit: boolean;
      query: string;
      expanded: string[];
      fieldType?: FieldType;
      excludeDatabaseIds?: string[];
      expected: {
        flat: boolean;
        groups: { databaseId: string; viewCount: number; fieldIds: string[]; more: number }[];
        showFooter: boolean;
        empty: boolean;
      };
    }[];
  }[];
}

const { scenarios } = loadParityFixture<PickerFixture>('gfilter-picker.json');

function rowsOf(rows: PickerFixture['scenarios'][number]['rows']): DashboardRow[] {
  return rows.map((widgets, index) => ({
    id: `r${index}`,
    height: 360,
    widgets: widgets.map((widget, column) => ({
      id: `${index}-${column}`,
      databaseId: widget.database_id,
      viewId: widget.view_id,
      width: 12 / widgets.length,
    })),
  }));
}

describe('the global filter picker (dashboard-parity/gfilter-picker.json)', () => {
  describe.each(scenarios.map((scenario) => [scenario.name, scenario] as const))('%s', (_name, scenario) => {
    const rows = rowsOf(scenario.rows);

    it.each(scenario.cases.map((entry) => [entry.name, entry] as const))('%s', (_case, entry) => {
      const model = buildGlobalFilterPickerModel({
        sources: scenario.sources,
        rows,
        query: entry.query,
        expanded: entry.expanded,
        mode: entry.mode,
        fieldType: entry.fieldType,
        excludeDatabaseIds: entry.excludeDatabaseIds,
        canEdit: entry.can_edit,
      });

      expect({
        flat: model.flat,
        groups: model.groups.map((group) => ({
          databaseId: group.databaseId,
          viewCount: group.viewCount,
          fieldIds: group.fields.map((field) => field.id),
          more: group.moreCount,
        })),
        showFooter: model.showFooter,
        empty: model.empty,
      }).toEqual(entry.expected);
    });
  });

  it('counts widgets per database in the order they appear', () => {
    const counts = countWidgetsByDatabase(rowsOf(scenarios[1].rows));

    expect([...counts.entries()]).toEqual([
      ['db-projects', 1],
      ['db-tasks', 2],
      ['db-unloaded', 1],
      ['db-archive', 1],
      ['db-notes', 1],
    ]);
  });
});
