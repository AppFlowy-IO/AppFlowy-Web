import { act, fireEvent, render, screen } from '@testing-library/react';

import { FormRespondentTitle } from '../FormRespondentTitle';

describe('FormRespondentTitle draft synchronization', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('shows an empty authored title as a placeholder instead of persisting the legacy fallback', () => {
    const onChange = jest.fn();

    render(<FormRespondentTitle title='' readOnly={false} onChange={onChange} />);

    expect(screen.getByRole('textbox', { name: 'Form title' }).getAttribute('placeholder')).toBe('Form title');
    expect(screen.queryByText('Untitled form')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('uses the normalized legacy display fallback in read-only mode without persisting it', () => {
    const onChange = jest.fn();
    const { rerender } = render(<FormRespondentTitle title='   ' readOnly onChange={onChange} />);

    expect(screen.getByRole('heading', { level: 2, name: 'Untitled form' })).toBeTruthy();

    rerender(<FormRespondentTitle title='  Customer feedback  ' readOnly onChange={onChange} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Customer feedback' })).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('protects a focused local draft when a newer remote title arrives', () => {
    const onChange = jest.fn();
    const { rerender } = render(<FormRespondentTitle title='Initial title' readOnly={false} onChange={onChange} />);
    const input = screen.getByRole('textbox', { name: 'Form title' });

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Pending local title' } });
    rerender(<FormRespondentTitle title='Remote title' readOnly={false} onChange={onChange} />);

    expect(input.value).toBe('Pending local title');

    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(onChange).toHaveBeenCalledWith('Pending local title');
  });

  it('adopts a deferred remote title when an untouched focused field blurs', () => {
    const onChange = jest.fn();
    const { rerender } = render(<FormRespondentTitle title='Initial title' readOnly={false} onChange={onChange} />);
    const input = screen.getByRole('textbox', { name: 'Form title' });

    fireEvent.focus(input);
    rerender(<FormRespondentTitle title='Remote title' readOnly={false} onChange={onChange} />);

    expect(input.value).toBe('Initial title');
    fireEvent.blur(input);
    expect(input.value).toBe('Remote title');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('flushes the latest draft through the latest callback when the Form tab unmounts', () => {
    const oldOnChange = jest.fn();
    const latestOnChange = jest.fn();
    const { rerender, unmount } = render(<FormRespondentTitle title='' readOnly={false} onChange={oldOnChange} />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Form title' }), {
      target: { value: 'Keep this title' },
    });
    rerender(<FormRespondentTitle title='' readOnly={false} onChange={latestOnChange} />);
    unmount();

    expect(oldOnChange).not.toHaveBeenCalled();
    expect(latestOnChange).toHaveBeenCalledWith('Keep this title');
  });

  it('discards a pending draft when the Form becomes read-only', () => {
    const onChange = jest.fn();
    const { rerender, unmount } = render(
      <FormRespondentTitle title='Saved title' readOnly={false} onChange={onChange} />
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Form title' }), {
      target: { value: 'Unauthorized pending title' },
    });
    rerender(<FormRespondentTitle title='Saved title' readOnly onChange={onChange} />);
    act(() => {
      jest.advanceTimersByTime(500);
    });
    unmount();

    expect(screen.queryByText('Unauthorized pending title')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});
