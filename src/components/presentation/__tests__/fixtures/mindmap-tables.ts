import type { MindMap, PageSnapshot, SourceBlock } from '../../types';

export function tableBlock(values: string[][], headerRow = true, headerColumn = true): SourceBlock {
  return {
    id: 'table',
    type: 'simple_table',
    text: '',
    table: { headerRow, headerColumn, columnWidths: [100, 100, 200] },
    children: values.map((row, r) => ({
      id: `row-${r}`,
      type: 'simple_table_row',
      text: '',
      children: row.map((text, c) => ({
        id: `cell-${r}-${c}`,
        type: 'simple_table_cell',
        text: '',
        children: [{ id: `text-${r}-${c}`, type: 'paragraph', text, children: [] }],
      })),
    })),
  };
}

export const METRICS_SOURCE: PageSnapshot = {
  pageId: 'metrics-page',
  title: 'AI research',
  kind: 'document',
  revision: 'metrics-v1',
  blocks: [
    { id: 'section', type: 'heading', level: 1, text: 'Key findings at a glance', children: [] },
    tableBlock([
      ['Metric', 'Reported figure', 'Definition and period'],
      ['Inference cost reduction', '286×', 'GPT-3.5-level MMLU performance, November 2022–October 2024'],
      ['Organizational AI adoption', '88%', 'Organizations using AI in at least one function, 2025'],
      ['Open issues', '0', ''],
    ]),
  ],
  properties: [],
  warnings: [],
};

/** Fixed renderer input; structural-map generation is owned and tested by Cloud. */
export const METRICS_MAP: MindMap = {
  schemaVersion: 1,
  nodes: [
    { id: 'root', parentId: null, label: 'AI research', summary: '', sourceIds: ['metrics-page'] },
    { id: 'section', parentId: 'root', label: 'Key findings at a glance', summary: '', sourceIds: ['section'] },
    {
      id: 'inference',
      parentId: 'section',
      label: 'Inference cost reduction',
      summary:
        'Metric: Inference cost reduction\nReported figure: 286×\nDefinition and period: GPT-3.5-level MMLU performance, November 2022–October 2024',
      sourceIds: ['table', 'row-1', 'text-1-0', 'text-1-1', 'text-1-2'],
    },
    {
      id: 'adoption',
      parentId: 'section',
      label: 'Organizational AI adoption',
      summary:
        'Metric: Organizational AI adoption\nReported figure: 88%\nDefinition and period: Organizations using AI in at least one function, 2025',
      sourceIds: ['table', 'row-2', 'text-2-0', 'text-2-1', 'text-2-2'],
    },
    {
      id: 'issues',
      parentId: 'section',
      label: 'Open issues',
      summary: 'Metric: Open issues\nReported figure: 0\nDefinition and period: Not provided',
      sourceIds: ['table', 'row-3', 'text-3-0', 'text-3-1', 'text-3-2'],
    },
  ],
  warnings: [],
};
