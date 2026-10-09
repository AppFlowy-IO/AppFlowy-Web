/** Shared mocks of the chart settings panel tests: the chart setting, the fields and the writer. */
import { DEFAULT_CHART_EXTENDED_SETTINGS } from '@/application/database-yjs/chart-extended-settings';
import { ChartAggregationType, ChartLayoutSettings, ChartType } from '@/application/database-yjs/chart.type';
import { DateGroupCondition, FieldType } from '@/application/database-yjs/database.type';

export interface PanelProperty {
  id: string;
  name: string;
  type: FieldType;
  visible: boolean;
}

export const PANEL_PROPERTIES: PanelProperty[] = [
  { id: 'name', name: 'Name', type: FieldType.RichText, visible: true },
  { id: 'status', name: 'Status', type: FieldType.SingleSelect, visible: true },
  { id: 'estimate', name: 'Estimate', type: FieldType.Number, visible: true },
  { id: 'due', name: 'Due', type: FieldType.DateTime, visible: true },
  { id: 'urgent', name: 'Urgent', type: FieldType.Checkbox, visible: true },
  { id: 'formula', name: 'Formula', type: FieldType.Formula, visible: true },
];

export function chartSettings(overrides: Partial<ChartLayoutSettings> = {}): ChartLayoutSettings {
  return {
    chartType: ChartType.Bar,
    xFieldId: 'status',
    showEmptyValues: true,
    aggregationType: ChartAggregationType.Count,
    cumulative: false,
    dateCondition: DateGroupCondition.Month,
    numberFormat: 'auto',
    titleText: '',
    ...overrides,
    extended: { ...DEFAULT_CHART_EXTENDED_SETTINGS, ...overrides.extended },
  };
}

/** The visible section titles and, per title, the row labels of the panel's root page. */
export function readPanelSections(panel: HTMLElement) {
  return Array.from(panel.querySelectorAll<HTMLElement>('[data-testid^="chart-settings-section-"]')).map((section) => ({
    id: section.getAttribute('data-testid')?.replace('chart-settings-section-', ''),
    title: section.getAttribute('data-section-title') ?? '',
    rows: Array.from(section.querySelectorAll<HTMLElement>('[data-row-id]')).map((row) => row.getAttribute('data-row-id')),
    labels: Array.from(section.querySelectorAll<HTMLElement>('[data-row-id] > span.flex-1')).map((label) => label.textContent),
  }));
}
