import { createRoot } from 'react-dom/client';

import { useAppThemeMode } from '@/components/main/useAppThemeMode';
import DocumentPresenter from '@/components/presentation/DocumentPresenter';
import { parseMarkdown } from '@/components/presentation/source';
import type { SourceBlock } from '@/components/presentation/types';

import '@/styles/global.css';

// Native table blocks cannot be entered through the lab's plain Markdown editor.
const source = parseMarkdown(
  [
    '## Timeline',
    ...Array.from(
      { length: 4 },
      (_, index) => `- Timeline item ${index + 1}: ${'Earlier developments in artificial intelligence. '.repeat(3)}`
    ),
    '### Key findings at a glance',
    '---',
    'The final source paragraph.',
  ].join('\n')
);
const values = [
  ['Metric', 'Reported figure', 'Definition and period'],
  ['Inference cost reduction', '286×', 'For GPT-3.5-level MMLU performance, November 2022–October 2024'],
  ['Organizational AI adoption', '88%', 'Surveyed organizations using AI in at least one function, 2025'],
  ['Global AI compute capacity growth', '3.3× per year', 'Approximate annual growth since 2022'],
  ['AI agent task-horizon doubling period', '~7 months', 'Historical doubling period in METR task evaluations'],
];
const scenario = new URLSearchParams(window.location.search).get('table');

if (scenario === 'long') {
  values.splice(
    1,
    values.length - 1,
    ...Array.from({ length: 14 }, (_, index) => [
      `Research metric ${index + 1}`,
      `${index + 1}%`,
      `Reported finding ${index + 1}. Measured across the participating organizations during the review period.`,
    ])
  );
}
if (scenario === 'wide') {
  values.forEach((row, index) =>
    row.push(...Array.from({ length: 9 }, (_, col) => (index === 0 ? `Period ${col + 1}` : `Value ${col + 1}`)))
  );
}
if (scenario === 'tall') values[1][2] = 'Long row detail. '.repeat(300);
if (scenario === 'intro') {
  values.splice(
    0,
    values.length,
    ['Dimension', 'Earlier approach', 'Modern approach (2025–2026)', 'Practical impact'],
    [
      'Architecture',
      'Mostly dense Transformers',
      'Dense and sparse MoE architectures',
      'More compute-efficient capacity',
    ],
    [
      'Pretraining',
      'Large-scale web text',
      'Curated, multilingual, multimodal and specialized data',
      'Better knowledge and task coverage',
    ],
    [
      'Post-training',
      'Supervised fine-tuning',
      'SFT, preference optimization, RL, verifiable rewards',
      'Better instruction following and problem solving',
    ],
    [
      'Reasoning',
      'Direct response generation',
      'Variable inference-time computation',
      'Stronger complex reasoning, often at higher cost',
    ],
    ['Context', 'Short input windows', 'Long-context processing and retrieval', 'More source information available'],
    ['Modalities', 'Text input and output', 'Text, images, audio and video', 'Broader interaction options'],
    ['Tools', 'Standalone responses', 'Tool calling and agent workflows', 'Actions across connected systems'],
    [
      'Efficiency',
      'Large general-purpose models',
      'Distillation, quantization and smaller models',
      'Lower operating costs',
    ],
    [
      'Deployment',
      'Single model endpoint',
      'Evaluation, monitoring and model routing',
      'More reliable production systems',
    ]
  );
}
const table: SourceBlock = {
  id: 'findings',
  type: 'simple_table',
  text: '',
  table: {
    headerRow: scenario !== 'formatted',
    headerColumn: scenario !== 'formatted',
    columnColors: scenario === 'theme' ? { '1': 'bg-color-4' } : scenario === 'long' ? { '1': '#fff0cc' } : undefined,
    columnAligns: scenario === 'long' ? { '1': 'Right' } : undefined,
    rowColors:
      scenario === 'formatted' ? { 'row-2': '#def4ea' } : scenario === 'long' ? { 'row-8': '#def4ea' } : undefined,
    rowAligns: scenario === 'long' ? { 'row-8': 'Center' } : undefined,
  },
  children: values.map((cells, row) => ({
    id: `row-${row}`,
    type: 'simple_table_row',
    text: '',
    children: cells.map((text, col) => ({ id: `cell-${row}-${col}`, type: 'simple_table_cell', text, children: [] })),
  })),
};
if (scenario === 'formatted')
  table.children[1].children[1].richText = [{ text: '286×', bold: true, font_color: '#b62424' }];

if (scenario === 'intro') {
  source.blocks = parseMarkdown(
    '## 2. How LLM architecture and training have changed\nThe modern LLM stack has evolved considerably beyond pretraining a large Transformer to predict the next token.\n---\nThe final source paragraph.'
  ).blocks;
  source.blocks.splice(2, 0, { id: 'intro-spacer', type: 'paragraph', text: '', children: [] }, table);
} else source.blocks.splice(6, 0, table);
function Fixture() {
  useAppThemeMode();
  return <DocumentPresenter snapshot={source} onClose={() => undefined} onSource={() => undefined} />;
}

createRoot(document.getElementById('root')!).render(<Fixture />);
