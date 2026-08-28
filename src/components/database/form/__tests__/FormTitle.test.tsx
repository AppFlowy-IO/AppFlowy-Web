import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';

import { FormTitle } from '../FormTitle';

const mockUpdateView = jest.fn();
let mockCurrentName = 'Initial form';
const mockView = {
  get: jest.fn(() => mockCurrentName),
};

jest.mock('@/application/database-yjs/context', () => ({
  useDatabaseView: () => mockView,
  useDatabaseViewId: () => 'form-view-id',
}));

jest.mock('@/application/database-yjs/dispatch', () => ({
  useUpdateDatabaseView: () => mockUpdateView,
}));

jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
  },
}));

describe('FormTitle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCurrentName = 'Initial form';
    mockUpdateView.mockResolvedValue(undefined);
  });

  it('preserves a focused local draft when an external rename arrives', async () => {
    const { rerender } = render(<FormTitle readOnly={false} />);
    const input = screen.getByPlaceholderText<HTMLInputElement>('Form');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Local draft' } });

    mockCurrentName = 'Remote title';
    rerender(<FormTitle readOnly={false} />);

    expect(input.value).toBe('Local draft');

    fireEvent.blur(input);

    await waitFor(() =>
      expect(mockUpdateView).toHaveBeenCalledWith('form-view-id', {
        name: 'Local draft',
      })
    );
  });

  it('accepts a deferred external rename on blur when the focused draft was not edited', () => {
    const { rerender } = render(<FormTitle readOnly={false} />);
    const input = screen.getByPlaceholderText<HTMLInputElement>('Form');

    fireEvent.focus(input);
    mockCurrentName = 'Remote title';
    rerender(<FormTitle readOnly={false} />);

    expect(input.value).toBe('Initial form');

    fireEvent.blur(input);

    expect(input.value).toBe('Remote title');
    expect(mockUpdateView).not.toHaveBeenCalled();
  });

  it('adopts an external rename when the input is not focused', () => {
    const { rerender } = render(<FormTitle readOnly={false} />);

    mockCurrentName = 'Remote title';
    rerender(<FormTitle readOnly={false} />);

    expect(screen.getByPlaceholderText<HTMLInputElement>('Form').value).toBe('Remote title');
  });

  it('keeps a failed rename dirty when Yjs changes during the request so blurring again retries it', async () => {
    let rejectRename!: (error: Error) => void;

    mockUpdateView
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectRename = reject;
          })
      )
      .mockResolvedValueOnce(undefined);
    const { rerender } = render(<FormTitle readOnly={false} />);
    const input = screen.getByPlaceholderText<HTMLInputElement>('Form');

    fireEvent.change(input, { target: { value: 'Retry this title' } });
    fireEvent.blur(input);

    mockCurrentName = 'Remote while saving';
    rerender(<FormTitle readOnly={false} />);

    await act(async () => {
      rejectRename(new Error('Rename failed'));
    });

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Rename failed'));
    expect(input.value).toBe('Retry this title');
    expect(input.disabled).toBe(false);

    fireEvent.focus(input);
    fireEvent.blur(input);

    await waitFor(() => expect(mockUpdateView).toHaveBeenCalledTimes(2));
    expect(mockUpdateView).toHaveBeenLastCalledWith('form-view-id', {
      name: 'Retry this title',
    });

    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(mockUpdateView).toHaveBeenCalledTimes(2);
  });
});
