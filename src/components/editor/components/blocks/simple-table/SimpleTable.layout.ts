import { ReactEditor } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { BlockType } from '@/application/types';

import { MIN_WIDTH } from './const';

export function resizeSimpleTable(editor: YjsEditor, blockId: string, mode: 'page' | 'even') {
  if (editor.readOnly) return;
  const entry = findSlateEntryByBlockId(editor, blockId);

  if (!entry || entry[0].type !== BlockType.SimpleTableBlock) return;
  const root = ReactEditor.toDOMNode(editor, entry[0]);
  const table = root.querySelector('table');
  const container = root.querySelector('.simple-table-scroll-container');
  const count = table?.querySelectorAll('tr:first-child > td').length ?? 0;
  const width = mode === 'page' ? container?.clientWidth : table?.getBoundingClientRect().width;

  if (!width || !count) return;
  const columnWidth = Math.max(MIN_WIDTH, Math.floor(width / count));
  const columnWidths = Object.fromEntries(Array.from({ length: count }, (_, index) => [index, columnWidth]));

  CustomEditor.updateTableData(editor, blockId, { column_widths: columnWidths });
}
