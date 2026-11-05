import { fireEvent, render, screen } from '@testing-library/react';

import { CustomEditor } from '@/application/slate-yjs/command';
import { BlockType } from '@/application/types';
import FileToolbar from '@/components/editor/components/blocks/file/FileToolbar';
import { FileNode } from '@/components/editor/editor.type';
import { downloadFile } from '@/utils/download';

let readOnly = false;
const editor = { isElementReadOnly: () => false };

jest.mock('slate-react', () => ({
  useReadOnly: () => readOnly,
  useSlateStatic: () => editor,
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/application/slate-yjs/command', () => ({
  CustomEditor: { deleteBlock: jest.fn(), setBlockData: jest.fn() },
}));
jest.mock('@/utils/download', () => ({ downloadFile: jest.fn() }));
jest.mock('@/components/_shared/modal', () => ({
  NormalModal: ({ open, children, onOk }: { open: boolean; children: React.ReactNode; onOk: () => void }) =>
    open ? (
      <div role='dialog'>
        {children}
        <button onClick={onOk}>save</button>
      </div>
    ) : null,
}));

const node: FileNode = {
  blockId: 'file',
  type: BlockType.FileBlock,
  children: [{ text: '' }],
  data: { name: 'report.pdf', url: 'https://example.com/report.pdf' },
};

beforeEach(() => {
  readOnly = false;
  jest.clearAllMocks();
});

it('downloads from the menu without opening the file row', () => {
  const onRowClick = jest.fn();

  render(
    <div onClick={onRowClick}>
      <FileToolbar node={node} />
    </div>
  );
  fireEvent.click(screen.getByRole('button', { name: 'button.more' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'button.download' }));
  expect(downloadFile).toHaveBeenCalledWith(node.data.url, node.data.name);
  expect(onRowClick).not.toHaveBeenCalled();
});

it('keeps the rename dialog mounted after closing the menu and saves the name', () => {
  render(<FileToolbar node={node} />);
  fireEvent.click(screen.getByRole('button', { name: 'button.more' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'document.plugins.file.renameFile.title' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'updated.pdf' } });
  fireEvent.click(screen.getByRole('button', { name: 'save' }));
  expect(CustomEditor.setBlockData).toHaveBeenCalledWith(editor, 'file', { name: 'updated.pdf' });
});

it('deletes from the menu', () => {
  render(<FileToolbar node={node} />);
  fireEvent.click(screen.getByRole('button', { name: 'button.more' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'button.delete' }));
  expect(CustomEditor.deleteBlock).toHaveBeenCalledWith(editor, 'file');
});

it('only offers download in read-only mode', () => {
  readOnly = true;
  render(<FileToolbar node={node} />);
  fireEvent.click(screen.getByRole('button', { name: 'button.more' }));
  expect(screen.getAllByRole('menuitem')).toHaveLength(1);
  expect(screen.getByRole('menuitem', { name: 'button.download' })).toBeTruthy();
});
