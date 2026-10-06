import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { CustomEditor } from '@/application/slate-yjs/command';
import { BlockType, TableAlignType, YjsEditorKey } from '@/application/types';
import { notify } from '@/components/_shared/notify';
import { importCsvAsDatabase } from '@/components/app/import/import-service';
import type { SimpleTableNode } from '@/components/editor/editor.type';

import { replaceSimpleTable } from '../SimpleTable.convert';
import { SimpleTableBlockControls } from '../SimpleTableBlockControls';
import type { MenuAction } from '../SimpleTableContextMenu';

let mockTable: SimpleTableNode | null;
const mockEditor = { readOnly: false };
const mockContext = {
  workspaceId: 'workspace', viewId: 'document',
  loadViewMeta: jest.fn(), deletePage: jest.fn(),
};

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('slate-react', () => ({ useSlateStatic: () => mockEditor, ReactEditor: { focus: jest.fn() } }));
jest.mock('@/application/slate-yjs/command', () => ({ CustomEditor: { updateTableData: jest.fn() } }));
jest.mock('@/application/slate-yjs/utils/editor', () => ({
  findSlateEntryByBlockId: (_: unknown, id: string) => id === 'table' && mockTable ? [mockTable, [0]] : null,
}));
jest.mock('@/components/editor/EditorContext', () => ({ useEditorContext: () => mockContext }));
jest.mock('@/components/_shared/notify', () => ({ notify: { error: jest.fn() } }));
jest.mock('@/components/app/import/import-service', () => ({ importCsvAsDatabase: jest.fn() }));
jest.mock('../SimpleTable.convert', () => ({
  ...jest.requireActual('../SimpleTable.convert'), replaceSimpleTable: jest.fn(() => ['replacement']),
}));
jest.mock('../SimpleTableContextMenu', () => ({
  SimpleTableMenuItem: ({ action }: { action: MenuAction }) => (
    <button disabled={action.disabled} onClick={() => action.alignPicker
      ? action.onSelectAlign?.(TableAlignType.Center) : action.onClick()}>{action.label}</button>
  ),
}));

function makeTable(text: string, rowCount = 1, columnCount = 1): SimpleTableNode {
  return {
    blockId: 'table', type: BlockType.SimpleTableBlock, data: {},
    children: Array.from({ length: rowCount }, (_, row) => ({
      blockId: `row-${row}`, type: BlockType.SimpleTableRowBlock, data: {},
      children: Array.from({ length: columnCount }, (_, column) => ({
        blockId: `cell-${row}-${column}`, type: BlockType.SimpleTableCellBlock, data: {},
        children: [{
          blockId: `paragraph-${row}-${column}`, type: BlockType.Paragraph, data: {},
          children: [{ type: YjsEditorKey.text, children: [{ text }] }],
        }],
      })),
    })),
  } as SimpleTableNode;
}

const mockImport = jest.mocked(importCsvAsDatabase);
const mockReplace = jest.mocked(replaceSimpleTable);
const view = { view_id: 'database-view', extra: { database_id: 'database' } };

describe('Simple table block controls', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEditor.readOnly = false;
    mockTable = makeTable('Original');
    mockImport.mockResolvedValue({ viewId: 'database-view', databaseId: 'database' });
    mockContext.loadViewMeta.mockResolvedValue(view);
    mockContext.deletePage.mockResolvedValue(undefined);
  });

  it('converts the latest cell content after the menu has opened', () => {
    render(<SimpleTableBlockControls blockId="table" onClose={jest.fn()} />);
    mockTable = makeTable('Edited while the menu was open');
    fireEvent.click(screen.getByText('Convert to text'));

    expect(mockReplace).toHaveBeenCalledWith(mockEditor, 'table', [{
      type: BlockType.Paragraph, data: {},
      children: [{ type: YjsEditorKey.text, children: [{ text: 'Edited while the menu was open' }] }],
    }]);
  });

  it('imports the latest table content as a database', async () => {
    render(<SimpleTableBlockControls blockId="table" onClose={jest.fn()} />);
    mockTable = makeTable('Latest database value');
    fireEvent.click(screen.getByText('Turn into database'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    const file = mockImport.mock.calls[0][0].file;
    const csv = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });

    expect(csv).toContain('"Latest database value"');
    expect(csv).not.toContain('"Original"');
  });

  it('keeps the table and cleans up the import if content changes during conversion', async () => {
    let finishMetadata!: (value: typeof view) => void;

    mockContext.loadViewMeta.mockImplementationOnce(() => new Promise((resolve) => { finishMetadata = resolve; }));
    render(<SimpleTableBlockControls blockId="table" onClose={jest.fn()} />);
    fireEvent.click(screen.getByText('Turn into database'));
    await waitFor(() => expect(mockContext.loadViewMeta).toHaveBeenCalled());
    mockTable = makeTable('Edited during the import');
    finishMetadata(view);
    await waitFor(() => expect(mockContext.deletePage).toHaveBeenCalledWith('database-view'));
    expect(mockReplace).not.toHaveBeenCalled();
    expect(notify.error).toHaveBeenCalled();
  });

  it('does not start the import when the menu unmounts before the lazy module loads', async () => {
    const { unmount } = render(<SimpleTableBlockControls blockId="table" onClose={jest.fn()} />);

    fireEvent.click(screen.getByText('Turn into database'));
    unmount();
    // Flush the dynamic-import continuation after effect cleanup aborts it.
    await Promise.resolve();
    await Promise.resolve();
    expect(mockImport).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('aligns the current rows and columns after their dimensions change', () => {
    render(<SimpleTableBlockControls blockId="table" onClose={jest.fn()} />);
    mockTable = makeTable('Current', 2, 3);
    fireEvent.click(screen.getByText('document.plugins.simpleTable.moreActions.align'));
    expect(CustomEditor.updateTableData).toHaveBeenCalledWith(mockEditor, 'table', {
      row_aligns: { 0: TableAlignType.Center, 1: TableAlignType.Center },
      column_aligns: { 0: TableAlignType.Center, 1: TableAlignType.Center, 2: TableAlignType.Center },
    });
  });
});
