import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';

import RenameModal from '@/components/app/view-actions/RenameModal';

jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
    warning: jest.fn(),
  },
}));

describe('RenameModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects whitespace-only names without closing', async () => {
    const onClose = jest.fn();
    const updatePage = jest.fn().mockResolvedValue(undefined);

    render(<RenameModal open onClose={onClose} viewId='view-id' view={{ name: 'Old name' }} updatePage={updatePage} />);

    const input = await screen.findByTestId('rename-modal-input');

    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(screen.getByTestId('rename-modal-save'));

    expect(updatePage).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalled();
  });

  it('updates only the name and closes after the request succeeds', async () => {
    const onClose = jest.fn();
    const updatePage = jest.fn().mockResolvedValue(undefined);

    render(<RenameModal open onClose={onClose} viewId='view-id' view={{ name: 'Old name' }} updatePage={updatePage} />);

    const input = await screen.findByTestId('rename-modal-input');

    fireEvent.change(input, { target: { value: 'New name' } });
    fireEvent.click(screen.getByTestId('rename-modal-save'));

    await waitFor(() => {
      expect(updatePage).toHaveBeenCalledWith('view-id', { name: 'New name' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('accepts live metadata until the user starts editing', async () => {
    const onClose = jest.fn();
    const updatePage = jest.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <RenameModal open onClose={onClose} viewId='view-id' view={{ name: 'Old name' }} updatePage={updatePage} />
    );
    const input = await screen.findByTestId('rename-modal-input');

    rerender(
      <RenameModal open onClose={onClose} viewId='view-id' view={{ name: 'Remote name' }} updatePage={updatePage} />
    );

    await waitFor(() => {
      expect((input as HTMLInputElement).value).toBe('Remote name');
    });

    fireEvent.change(input, { target: { value: 'Local draft' } });
    rerender(
      <RenameModal open onClose={onClose} viewId='view-id' view={{ name: 'New remote name' }} updatePage={updatePage} />
    );

    expect((input as HTMLInputElement).value).toBe('Local draft');
  });
});
