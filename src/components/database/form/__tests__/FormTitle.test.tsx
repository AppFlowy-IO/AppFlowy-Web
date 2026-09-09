import EventEmitter from 'events';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';

import { APP_EVENTS } from '@/application/constants';
import type { View } from '@/application/types';

import { FormTitle, resetPendingFormTitleRenamesForTesting } from '../FormTitle';

const mockUpdateView = jest.fn();
let mockCurrentName = 'Initial form';
const mockView = {
  get: jest.fn(() => mockCurrentName),
};
let mockEventEmitter = new EventEmitter();
const mockLoadViewMeta = jest.fn();
let mockPrincipalId = 'user-a';

jest.mock('@/application/database-yjs/context', () => ({
  useDatabaseContextOptional: () => ({
    eventEmitter: mockEventEmitter,
    loadViewMeta: mockLoadViewMeta,
  }),
  useDatabaseView: () => mockView,
  useDatabaseViewId: () => 'form-view-id',
}));

jest.mock('@/application/database-yjs/dispatch', () => ({
  useUpdateDatabaseView: () => mockUpdateView,
}));

jest.mock('@/components/main/app.hooks', () => ({
  useAuthenticatedUserIdOptional: () => mockPrincipalId,
}));

jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
  },
}));

describe('FormTitle', () => {
  beforeEach(() => {
    resetPendingFormTitleRenamesForTesting();
    jest.clearAllMocks();
    mockEventEmitter = new EventEmitter();
    mockPrincipalId = 'user-a';
    mockCurrentName = 'Initial form';
    mockLoadViewMeta.mockRejectedValue(new Error('Folder metadata unavailable in this focused test'));
    mockUpdateView.mockResolvedValue(undefined);
  });

  it('loads the Folder-backed title authored by Desktop instead of the stale database-collab name', async () => {
    mockLoadViewMeta.mockResolvedValue({
      view_id: 'form-view-id',
      name: 'Renamed on Desktop',
    } as View);

    render(<FormTitle readOnly={false} />);

    await waitFor(() => expect(screen.getByPlaceholderText<HTMLInputElement>('Form').value).toBe('Renamed on Desktop'));
    expect(mockLoadViewMeta).toHaveBeenCalledWith('form-view-id', undefined, {
      metadataOnly: true,
      authoritative: true,
    });
  });

  it('defers a live Folder rename while focused without overwriting the local draft', async () => {
    render(<FormTitle readOnly={false} />);
    const input = screen.getByPlaceholderText<HTMLInputElement>('Form');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Local draft' } });
    act(() => {
      mockEventEmitter.emit(APP_EVENTS.VIEW_META_CHANGED, {
        view_id: 'form-view-id',
        name: 'Renamed on Desktop',
      } as View);
    });

    expect(input.value).toBe('Local draft');
    fireEvent.blur(input);

    await waitFor(() =>
      expect(mockUpdateView).toHaveBeenCalledWith('form-view-id', {
        name: 'Local draft',
      })
    );
  });

  it('keeps a live Folder rename when the initial metadata request resolves late', async () => {
    let resolveInitialLoad!: (view: View) => void;

    mockLoadViewMeta.mockReturnValue(
      new Promise<View>((resolve) => {
        resolveInitialLoad = resolve;
      })
    );
    render(<FormTitle readOnly={false} />);

    act(() => {
      mockEventEmitter.emit(APP_EVENTS.VIEW_META_CHANGED, {
        view_id: 'form-view-id',
        name: 'Newest live title',
      } as View);
    });
    await waitFor(() => expect(screen.getByPlaceholderText<HTMLInputElement>('Form').value).toBe('Newest live title'));

    await act(async () => {
      resolveInitialLoad({
        view_id: 'form-view-id',
        name: 'Stale initial title',
      } as View);
      await Promise.resolve();
    });

    expect(screen.getByPlaceholderText<HTMLInputElement>('Form').value).toBe('Newest live title');
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

  it('persists an empty title so the shared Form placeholder can render', async () => {
    render(<FormTitle readOnly={false} />);
    const input = screen.getByPlaceholderText<HTMLInputElement>('Form');

    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);

    await waitFor(() =>
      expect(mockUpdateView).toHaveBeenCalledWith('form-view-id', {
        name: '',
      })
    );
    await waitFor(() => expect(input.value).toBe(''));
  });

  it('flushes the latest focused draft on unmount and retries it after a detached failure', async () => {
    let rejectRename!: (error: Error) => void;

    mockUpdateView
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectRename = reject;
          })
      )
      .mockResolvedValueOnce(undefined);
    const first = render(<FormTitle readOnly={false} />);
    const input = screen.getByPlaceholderText<HTMLInputElement>('Form');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Navigation draft' } });
    first.unmount();

    expect(mockUpdateView).toHaveBeenCalledWith('form-view-id', {
      name: 'Navigation draft',
    });

    render(<FormTitle readOnly={false} />);

    await act(async () => {
      rejectRename(new Error('Offline during navigation'));
      await Promise.resolve();
    });

    await waitFor(() => expect(mockUpdateView).toHaveBeenCalledTimes(2));
    expect(mockUpdateView).toHaveBeenLastCalledWith('form-view-id', {
      name: 'Navigation draft',
    });
    await waitFor(() => expect(screen.getByPlaceholderText<HTMLInputElement>('Form').value).toBe('Navigation draft'));
  });

  it('does not retry a retained rename from a view-only mount', async () => {
    let rejectRename!: (error: Error) => void;

    mockUpdateView.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectRename = reject;
        })
    );
    const editable = render(<FormTitle readOnly={false} />);

    fireEvent.change(screen.getByPlaceholderText<HTMLInputElement>('Form'), {
      target: { value: 'Retained editable draft' },
    });
    editable.unmount();
    await act(async () => {
      rejectRename(new Error('Permission changed'));
      await Promise.resolve();
    });

    render(<FormTitle readOnly />);
    await act(async () => Promise.resolve());

    expect(mockUpdateView).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('does not retry a retained rename under a different account', async () => {
    let rejectRename!: (error: Error) => void;

    mockUpdateView.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectRename = reject;
        })
    );
    const accountA = render(<FormTitle readOnly={false} />);

    fireEvent.change(screen.getByPlaceholderText<HTMLInputElement>('Form'), {
      target: { value: 'Account A draft' },
    });
    accountA.unmount();
    expect(mockUpdateView).toHaveBeenCalledTimes(1);

    await act(async () => {
      rejectRename(new Error('Offline before logout'));
      await Promise.resolve();
    });

    mockPrincipalId = 'user-b';
    render(<FormTitle readOnly={false} />);
    await act(async () => Promise.resolve());

    expect(mockUpdateView).toHaveBeenCalledTimes(1);
    expect(screen.getByPlaceholderText<HTMLInputElement>('Form').value).toBe('Initial form');
  });

  it('discards an unsaved title draft when edit permission is revoked', () => {
    const { rerender } = render(<FormTitle readOnly={false} />);

    fireEvent.focus(screen.getByPlaceholderText<HTMLInputElement>('Form'));
    fireEvent.change(screen.getByPlaceholderText<HTMLInputElement>('Form'), {
      target: { value: 'Draft before downgrade' },
    });

    rerender(<FormTitle readOnly />);
    expect(screen.getByRole('heading').textContent).toBe('Initial form');

    rerender(<FormTitle readOnly={false} />);
    const restoredInput = screen.getByPlaceholderText<HTMLInputElement>('Form');

    expect(restoredInput.value).toBe('Initial form');
    fireEvent.focus(restoredInput);
    fireEvent.blur(restoredInput);
    expect(mockUpdateView).not.toHaveBeenCalled();
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
