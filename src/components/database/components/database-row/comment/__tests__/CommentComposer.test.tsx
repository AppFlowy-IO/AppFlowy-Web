import { act, fireEvent, render, screen } from '@testing-library/react';

import { useDatabaseContext } from '@/application/database-yjs';

import { CommentComposer } from '../CommentComposer';
import { CommentDraftContext } from '../CommentDraftContext';

jest.mock('@/application/database-yjs', () => ({ useDatabaseContext: jest.fn() }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const mockUseDatabaseContext = useDatabaseContext as jest.MockedFunction<typeof useDatabaseContext>;

function composer(id: string) {
  return (
    <CommentComposer
      key={id}
      initiallyExpanded
      placeholder={id}
      onSubmit={() => undefined}
      testIds={{ collapsed: `collapsed-${id}`, input: `input-${id}`, submit: `submit-${id}`, attachment: `attachment-${id}` }}
    />
  );
}

describe('CommentComposer draft retention signal', () => {
  beforeEach(() => {
    mockUseDatabaseContext.mockReturnValue({} as ReturnType<typeof useDatabaseContext>);
  });

  it('tracks independent drafts and removes an unmounted composer without treating focus as a draft', () => {
    const drafts = new Set<string>();
    const notifyDraft = (id: string, hasDraft: boolean) => {
      if (hasDraft) drafts.add(id);
      else drafts.delete(id);
    };

    const { rerender } = render(
      <CommentDraftContext.Provider value={notifyDraft}>
        {composer('first')}
        {composer('second')}
      </CommentDraftContext.Provider>
    );

    expect(drafts.size).toBe(0);
    fireEvent.click(screen.getByTestId('collapsed-first'));
    fireEvent.change(screen.getByTestId('input-first'), { target: { value: ' ' } });
    expect(drafts.size).toBe(1);
    fireEvent.click(screen.getByTestId('collapsed-second'));
    fireEvent.change(screen.getByTestId('input-second'), { target: { value: 'Another thread' } });
    expect(drafts.size).toBe(2);
    fireEvent.change(screen.getByTestId('input-first'), { target: { value: '' } });
    expect(drafts.size).toBe(1);

    rerender(<CommentDraftContext.Provider value={notifyDraft}>{composer('first')}</CommentDraftContext.Provider>);
    expect(drafts.size).toBe(0);
  });

  it('retains an attachment-only draft through upload and clears the signal after the attachment is removed', async () => {
    let finishUpload!: (url: string) => void;
    const uploadFile = jest.fn(() => new Promise<string>((resolve) => { finishUpload = resolve; }));
    const notifyDraft = jest.fn();

    mockUseDatabaseContext.mockReturnValue({ uploadFile } as unknown as ReturnType<typeof useDatabaseContext>);
    const { unmount } = render(
      <CommentDraftContext.Provider value={notifyDraft}>{composer('attachment')}</CommentDraftContext.Provider>
    );

    expect(notifyDraft).toHaveBeenLastCalledWith(expect.any(String), false);
    fireEvent.change(screen.getByTestId('attachment-attachment'), {
      target: { files: [new File(['feedback'], 'feedback.txt', { type: 'text/plain' })] },
    });
    expect(notifyDraft).toHaveBeenLastCalledWith(expect.any(String), true);
    await act(async () => finishUpload('https://example.com/feedback.txt'));
    expect(screen.getByTestId('comment-pending-attachment')).toBeTruthy();
    expect(notifyDraft).toHaveBeenLastCalledWith(expect.any(String), true);
    fireEvent.click(screen.getByRole('button', { name: 'button.remove feedback.txt' }));
    expect(notifyDraft).toHaveBeenLastCalledWith(expect.any(String), false);
    unmount();
    expect(notifyDraft).toHaveBeenLastCalledWith(expect.any(String), false);
  });
});

describe('CommentComposer inline variant', () => {
  const testIds = { collapsed: 'collapsed', input: 'input', submit: 'submit', attachment: 'attachment' };

  beforeEach(() => {
    mockUseDatabaseContext.mockReturnValue({ uploadFile: jest.fn() } as unknown as ReturnType<
      typeof useDatabaseContext
    >);
  });

  it('renders the Feed field borderless with its actions on the input line', () => {
    const onSubmit = jest.fn(() => 'comment-id');

    render(<CommentComposer onSubmit={onSubmit} placeholder='Comment' testIds={testIds} variant='inline' />);

    expect(screen.getByTestId('collapsed').className).not.toContain('border');
    fireEvent.click(screen.getByTestId('collapsed'));

    const input = screen.getByTestId('input');
    const submit = screen.getByTestId('submit');

    const inputLine = submit.parentElement?.parentElement;

    expect(inputLine?.className).toContain('items-end');
    expect(inputLine?.contains(input)).toBe(true);
    expect(input.closest('.border')).toBeNull();
    expect(submit.className).toContain('text-icon-tertiary');

    fireEvent.change(input, { target: { value: 'Ship it' } });
    expect(submit.className).toContain('text-fill-theme-thick');
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith('Ship it', []);
  });

  it('keeps the boxed row-detail field by default', () => {
    render(<CommentComposer initiallyExpanded onSubmit={() => undefined} placeholder='Comment' testIds={testIds} />);

    expect(screen.getByTestId('input').closest('.border')).not.toBeNull();
  });
});
