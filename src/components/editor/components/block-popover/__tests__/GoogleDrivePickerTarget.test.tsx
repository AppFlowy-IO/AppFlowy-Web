import { fireEvent, render, screen } from '@testing-library/react';

import { CustomEditor } from '@/application/slate-yjs/command';
import { BlockType } from '@/application/types';
import { usePopoverContext } from '@/components/editor/components/block-popover/BlockPopoverContext';

import BlockPopover from '../index';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('slate-react', () => ({
  useSlateStatic: () => mockEditor,
  ReactEditor: { focus: jest.fn(), blur: jest.fn() },
}));
jest.mock('@/application/slate-yjs/command', () => ({
  CustomEditor: { setBlockData: jest.fn(), turnToBlock: jest.fn() },
}));
jest.mock('@/application/slate-yjs/utils/editor', () => ({ findSlateEntryByBlockId: () => undefined }));
jest.mock('@/components/editor/EditorContext', () => ({
  useEditorLocalState: () => ({}),
  useEditorContext: () => ({ workspaceId: 'workspace' }),
}));
jest.mock('@/components/editor/components/block-popover/BlockPopoverContext', () => ({ usePopoverContext: jest.fn() }));
jest.mock('@/components/editor/components/blocks/google-drive/drive-actions', () => ({
  writableDrive: (_editor: unknown, blockId: string) => ({ data: { url: `https://docs.google.com/document/d/${blockId}/edit` } }),
}));
jest.mock('@/components/editor/components/blocks/google-drive/GoogleDriveBrowser', () => ({
  GoogleDriveBrowser: () => <div>Account picker</div>,
}));
jest.mock('@/components/_shared/notify', () => ({ notify: { warning: jest.fn() } }));
jest.mock('../MathEquationPopoverContent', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/_shared/popover', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  calculateOptimalOrigins: jest.fn(),
}));

const mockEditor = { deselect: jest.fn() };
const popover = jest.mocked(usePopoverContext);
const close = jest.fn();

function target(blockId: string) {
  popover.mockReturnValue({
    blockId,
    type: BlockType.GoogleDriveBlock,
    open: true,
    close,
    openPopover: jest.fn(),
    notifyMount: jest.fn(),
    isOpen: () => true,
  });
}

afterEach(() => jest.clearAllMocks());

it('starts a fresh link draft and replacement guard when the picker changes block', async () => {
  target('first');
  const view = render(<BlockPopover />);
  const input = await screen.findByRole('textbox');

  fireEvent.change(input, { target: { value: 'https://docs.google.com/document/d/old-draft/edit' } });
  target('second');
  view.rerender(<BlockPopover />);
  expect((await screen.findByRole('textbox')).value).toBe('');
  const next = 'https://docs.google.com/document/d/new-document/edit';

  fireEvent.change(screen.getByRole('textbox'), { target: { value: next } });
  fireEvent.submit(screen.getByRole('textbox').closest('form')!);
  expect(CustomEditor.setBlockData).toHaveBeenCalledWith(mockEditor, 'second', expect.objectContaining({ url: next }));
});

it('unmounts the previous account picker when a different block is targeted', async () => {
  target('first');
  const view = render(<BlockPopover />);

  fireEvent.click(await screen.findByRole('tab', { name: 'document.plugins.googleDrive.browseGoogleDrive' }));
  expect(screen.getByText('Account picker')).toBeTruthy();
  target('second');
  view.rerender(<BlockPopover />);
  expect(screen.queryByText('Account picker')).toBeNull();
  expect((await screen.findByRole('textbox')).value).toBe('');
});
