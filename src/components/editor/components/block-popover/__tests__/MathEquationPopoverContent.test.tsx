import { act, fireEvent, render, screen } from '@testing-library/react';

import { CustomEditor } from '@/application/slate-yjs/command';

import MathEquationPopoverContent from '../MathEquationPopoverContent';

const mockEditor = {};

jest.mock('slate-react', () => ({ useSlateStatic: () => mockEditor }));
jest.mock('@/application/slate-yjs/command', () => ({ CustomEditor: { setBlockData: jest.fn() } }));
jest.mock('@/application/slate-yjs/utils/editor', () => ({
  findSlateEntryByBlockId: () => [{ data: { formula: 'x' } }, [0]],
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('equation drafts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  it('discards a draft on Cancel, including after the previous autosave delay', () => {
    const onClose = jest.fn();
    const { unmount } = render(<MathEquationPopoverContent blockId='math' onClose={onClose} />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'new formula' } });
    void act(() => jest.advanceTimersByTime(500));
    expect(CustomEditor.setBlockData).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'button.cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    void act(() => jest.runOnlyPendingTimers());
    expect(CustomEditor.setBlockData).not.toHaveBeenCalled();
  });

  it.each(['Save', 'Enter'])('commits the latest draft once on %s', (action) => {
    const onClose = jest.fn();
    const { unmount } = render(<MathEquationPopoverContent blockId='math' onClose={onClose} />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'x^2' } });
    if (action === 'Save') {
      fireEvent.click(screen.getByRole('button', { name: 'button.save' }));
    } else {
      fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    }

    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    void act(() => jest.runOnlyPendingTimers());
    expect(CustomEditor.setBlockData).toHaveBeenCalledTimes(1);
    expect(CustomEditor.setBlockData).toHaveBeenCalledWith(mockEditor, 'math', { formula: 'x^2' });
  });

  it('discards an unsaved draft when the popover is dismissed', () => {
    const { unmount } = render(<MathEquationPopoverContent blockId='math' onClose={jest.fn()} />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'unsaved' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', shiftKey: true });
    unmount();
    void act(() => jest.runOnlyPendingTimers());
    expect(CustomEditor.setBlockData).not.toHaveBeenCalled();
  });
});
