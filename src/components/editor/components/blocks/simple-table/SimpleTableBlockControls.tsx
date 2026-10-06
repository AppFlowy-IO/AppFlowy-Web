import { Divider } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Element, Transforms } from 'slate';
import { ReactEditor, useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { BlockType, TableAlignType, YjsEditorKey } from '@/application/types';
import { getDatabaseIdFromExtra } from '@/application/view-utils';
import { notify } from '@/components/_shared/notify';
import { createDatabaseNodeData } from '@/components/editor/components/blocks/database/utils/databaseBlockUtils';
import { SimpleTableNode } from '@/components/editor/editor.type';
import { useEditorContext } from '@/components/editor/EditorContext';
import { getErrorMessage } from '@/utils/errors';

import { isSimpleTableCellNode, isSimpleTableRowNode } from './simple-table.utils';
import { replaceSimpleTable, simpleTableCsv, simpleTableTextRows } from './SimpleTable.convert';
import { resizeSimpleTable } from './SimpleTable.layout';
import { SimpleTableMenuItem } from './SimpleTableContextMenu';
import { SimpleTableMenuIcons } from './SimpleTableMenuIcons';

export function SimpleTableBlockControls({ blockId, onClose }: { blockId: string; onClose: () => void }) {
  const editor = useSlateStatic() as YjsEditor;
  const { workspaceId, viewId, loadViewMeta, deletePage } = useEditorContext();
  const { t } = useTranslation();
  const [converting, setConverting] = useState(false);
  const conversion = useRef<AbortController | null>(null);

  useEffect(() => () => conversion.current?.abort(), []);

  const label = (key: 'setToPageWidth' | 'distributeColumnsWidth' | 'align') =>
    t(`document.plugins.simpleTable.moreActions.${key}`);

  const currentTable = () => {
    if (editor.readOnly) return null;
    const entry = findSlateEntryByBlockId(editor, blockId);

    return entry?.[0].type === BlockType.SimpleTableBlock ? entry[0] as SimpleTableNode : null;
  };

  const focusReplacementBlock = (blockId: string) => {
    const entry = findSlateEntryByBlockId(editor, blockId);

    if (!entry) return;
    Transforms.select(editor, editor.start(entry[1]));
    // Closing the menu leaves focus outside Slate, where Undo cannot run.
    ReactEditor.focus(editor);
  };

  const convertToDatabase = async () => {
    if (!loadViewMeta || conversion.current) return;
    const table = currentTable();

    if (!table) return;
    const controller = new AbortController();
    const csv = simpleTableCsv(table);
    let createdViewId: string | undefined;
    let convertedBlockId: string | undefined;

    conversion.current = controller;
    setConverting(true);
    try {
      // The import parser and network code load only for this action.
      const { importCsvAsDatabase } = await import('@/components/app/import/import-service');

      if (controller.signal.aborted) return;
      const result = await importCsvAsDatabase({
        workspaceId,
        parentViewId: viewId,
        file: new File([csv], 'Table.csv', { type: 'text/csv' }),
        signal: controller.signal,
      });

      createdViewId = result.viewId;
      const view = await loadViewMeta(createdViewId);
      const current = currentTable();

      if (controller.signal.aborted || !current || simpleTableCsv(current) !== csv) {
        throw new Error('The table changed during conversion. Try again.');
      }

      [convertedBlockId] = replaceSimpleTable(editor, blockId, [{
        type: BlockType.GridBlock,
        data: createDatabaseNodeData({ parentId: viewId, viewIds: [createdViewId], databaseId: getDatabaseIdFromExtra(view) }),
        children: [{ text: '' }],
      } as Element]);
    } catch (error) {
      if (createdViewId) {
        try {
          await deletePage?.(createdViewId);
        } catch {
          // Keep the original conversion error when cleanup also fails.
        }
      }

      if (!controller.signal.aborted) notify.error(getErrorMessage(error, 'Could not convert the table'));
    } finally {
      conversion.current = null;
      if (!controller.signal.aborted) setConverting(false);
    }

    if (convertedBlockId) {
      onClose();
      focusReplacementBlock(convertedBlockId);
    }
  };

  return (
    <>
      <Divider className="my-1" />
      <SimpleTableMenuItem action={{
        label: label('setToPageWidth'), icon: SimpleTableMenuIcons.setPageWidth,
        onClick: () => { resizeSimpleTable(editor, blockId, 'page'); onClose(); },
      }} />
      <SimpleTableMenuItem action={{
        label: label('distributeColumnsWidth'), icon: SimpleTableMenuIcons.distribute,
        onClick: () => { resizeSimpleTable(editor, blockId, 'even'); onClose(); },
      }} />
      <Divider className="my-1" />
      <SimpleTableMenuItem action={{
        label: label('align'), icon: SimpleTableMenuIcons.align, alignPicker: true,
        onClick: () => undefined,
        onSelectAlign: (align: TableAlignType) => {
          const table = currentTable();

          if (!table) return;
          const rows = table.children.filter(isSimpleTableRowNode);
          const rowAligns = Object.fromEntries(rows.map((_, index) => [index, align]));
          const columnAligns = Object.fromEntries((rows[0]?.children.filter(isSimpleTableCellNode) ?? []).map((_, index) => [index, align]));

          CustomEditor.updateTableData(editor, blockId, { row_aligns: rowAligns, column_aligns: columnAligns });
          onClose();
        },
      }} />
      <Divider className="my-1" />
      <SimpleTableMenuItem action={{
        label: converting ? 'Converting to database…' : 'Turn into database',
        icon: SimpleTableMenuIcons.turnInto, disabled: converting || !loadViewMeta,
        onClick: () => { void convertToDatabase(); },
      }} />
      <SimpleTableMenuItem action={{
        label: 'Convert to text', icon: SimpleTableMenuIcons.convertText, disabled: converting,
        onClick: () => {
          const table = currentTable();

          if (!table) return;
          const content = simpleTableTextRows(table).map((row) => ({
            type: BlockType.Paragraph, data: {},
            children: [{ type: YjsEditorKey.text, children: [{ text: row.join('\t') }] }],
          } as Element));

          const [firstBlockId] = replaceSimpleTable(editor, blockId, content);

          onClose();
          focusReplacementBlock(firstBlockId);
        },
      }} />
    </>
  );
}
