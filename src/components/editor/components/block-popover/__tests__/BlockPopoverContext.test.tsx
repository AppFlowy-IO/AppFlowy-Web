import { act, fireEvent, render, screen } from '@testing-library/react';
import { ReactEditor } from 'slate-react';

import { OPEN_MATH_EQUATION_EVENT } from '@/components/editor/utils/math-equation';

import { BlockPopoverProvider, usePopoverContext } from '../BlockPopoverContext';

const mockEditor = {} as ReactEditor;
let mockAnchor: HTMLElement | null;

jest.mock('@/application/slate-yjs/utils/editor', () => ({
  findSlateEntryByBlockId: () => [{ blockId: 'equation' }, [0]],
}));
jest.mock('slate-react', () => ({
  ReactEditor: { toDOMNode: () => {
    if (!mockAnchor) throw new Error('The converted block has not committed its DOM yet');
    return mockAnchor;
  } },
}));

function Probe() {
  const { open, close } = usePopoverContext();

  return <button onClick={close}>{open ? 'Equation editor open' : 'Equation editor closed'}</button>;
}

async function requestOpen(editor = mockEditor) {
  await act(async () => {
    window.dispatchEvent(new CustomEvent(OPEN_MATH_EQUATION_EVENT, { detail: { editor, blockId: 'equation' } }));
    await Promise.resolve();
  });
}

beforeEach(() => { mockAnchor = null; });

it('opens after the converted block DOM commits even if its mount signal already ran', async () => {
  const view = render(<BlockPopoverProvider editor={mockEditor}><Probe /></BlockPopoverProvider>);

  await requestOpen();
  expect(screen.getByText('Equation editor closed')).toBeTruthy();
  // A subsequent Slate render can replace the node's DOM mapping without
  // changing its block ID, so the ID-based mount effect does not run again.
  mockAnchor = document.createElement('div');
  view.rerender(<BlockPopoverProvider editor={mockEditor}><Probe /></BlockPopoverProvider>);
  expect(screen.getByText('Equation editor open')).toBeTruthy();
});

it('only opens for the editor that created the equation', async () => {
  mockAnchor = document.createElement('div');
  render(<BlockPopoverProvider editor={mockEditor}><Probe /></BlockPopoverProvider>);
  await requestOpen({} as ReactEditor);
  expect(screen.getByText('Equation editor closed')).toBeTruthy();
});

it('does not reopen a canceled request when the block later mounts', async () => {
  const view = render(<BlockPopoverProvider editor={mockEditor}><Probe /></BlockPopoverProvider>);

  await requestOpen();
  fireEvent.click(screen.getByRole('button'));
  mockAnchor = document.createElement('div');
  view.rerender(<BlockPopoverProvider editor={mockEditor}><Probe /></BlockPopoverProvider>);
  expect(screen.getByText('Equation editor closed')).toBeTruthy();
});
