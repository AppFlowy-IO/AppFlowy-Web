import { loadParityFixture } from '../../__tests__/dashboard-parity-helpers';
import { buildChartPanelModel, ChartPanelAction, chartPatchFor } from '../panel-model';

import { chartTypeOf, fieldTypeOf } from './fixture-helpers';

interface PanelFixture {
  models: {
    name: string;
    input: {
      chartType: string;
      xType: string | null;
      yType: string | null;
      aggregation: number;
      showTitle: boolean;
      groupBy?: boolean;
    };
    expect: { section: string; title: string; rows: { id: string; label: string; disabled?: boolean }[] }[];
  }[];
  writes: { name: string; action: Record<string, unknown>; current: Record<string, unknown>; expect: Record<string, unknown> }[];
  rowIcons: Record<string, string>;
}

const fixture = loadParityFixture<PanelFixture>('chart-panel.json');

describe('buildChartPanelModel (dashboard-parity/chart-panel.json#models)', () => {
  it.each(fixture.models.map((entry) => [entry.name, entry] as const))('%s', (_, entry) => {
    const { input } = entry;
    const model = buildChartPanelModel({
      chartType: chartTypeOf(input.chartType),
      xType: input.xType === null ? null : fieldTypeOf(input.xType),
      yType: input.yType === null ? null : fieldTypeOf(input.yType),
      aggregation: input.aggregation,
      showTitle: input.showTitle,
      groupBy: input.groupBy,
    });

    expect(
      model.map((section) => ({
        section: section.id,
        title: section.title,
        rows: section.rows.map((row) => (row.disabled ? { id: row.id, label: row.label, disabled: true } : { id: row.id, label: row.label })),
      }))
    ).toEqual(entry.expect);
  });

  it('has a logical icon for every row except the type row and the title input', () => {
    const ids = new Set(fixture.models.flatMap((entry) => entry.expect.flatMap((section) => section.rows.map((row) => row.id))));

    ids.delete('chart_type');
    ids.delete('number_title_input');
    ids.forEach((id) => expect([id, Boolean(fixture.rowIcons[id])]).toEqual([id, true]));
  });
});

describe('chartPatchFor (dashboard-parity/chart-panel.json#writes)', () => {
  it.each(fixture.writes.map((entry) => [entry.name, entry] as const))('%s', (_, entry) => {
    const action = (
      entry.action.fieldType ? { ...entry.action, fieldType: fieldTypeOf(String(entry.action.fieldType)) } : entry.action
    ) as ChartPanelAction;

    expect(chartPatchFor(action, entry.current)).toEqual(entry.expect);
  });
});
