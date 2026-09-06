import { act, fireEvent, render, screen } from '@testing-library/react';

import { FormFormDescription } from '../FormFormDescription';

describe('FormFormDescription debounce', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('protects a focused draft when a newer external description arrives', () => {
    const onChange = jest.fn();
    const { rerender } = render(
      <FormFormDescription description='Initial description' readOnly={false} onChange={onChange} />
    );
    const input = screen.getByPlaceholderText('Description (optional)');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Pending local description' } });
    expect(onChange).not.toHaveBeenCalled();

    rerender(<FormFormDescription description='Remote description' readOnly={false} onChange={onChange} />);

    expect(input.value).toBe('Pending local description');

    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(onChange).toHaveBeenCalledWith('Pending local description');
    expect(input.value).toBe('Pending local description');
  });

  it('accepts a deferred external description after an untouched focused field blurs', () => {
    const onChange = jest.fn();
    const { rerender } = render(
      <FormFormDescription description='Initial description' readOnly={false} onChange={onChange} />
    );
    const input = screen.getByPlaceholderText('Description (optional)');

    fireEvent.focus(input);
    rerender(<FormFormDescription description='Remote description' readOnly={false} onChange={onChange} />);

    expect(input.value).toBe('Initial description');
    fireEvent.blur(input);
    expect(input.value).toBe('Remote description');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('flushes the latest draft when the Form tab unmounts before debounce', () => {
    const onChange = jest.fn();
    const { unmount } = render(<FormFormDescription description='' readOnly={false} onChange={onChange} />);

    fireEvent.change(screen.getByPlaceholderText('Description (optional)'), {
      target: { value: 'Keep this draft' },
    });
    unmount();

    expect(onChange).toHaveBeenCalledWith('Keep this draft');
  });

  it('does not overwrite a deferred external update when an untouched focused field unmounts', () => {
    const onChange = jest.fn();
    const { rerender, unmount } = render(
      <FormFormDescription description='Initial description' readOnly={false} onChange={onChange} />
    );

    fireEvent.focus(screen.getByPlaceholderText('Description (optional)'));
    rerender(<FormFormDescription description='Remote description' readOnly={false} onChange={onChange} />);
    unmount();

    expect(onChange).not.toHaveBeenCalled();
  });

  it('discards a pending draft when the Form becomes read-only', () => {
    const onChange = jest.fn();
    const { rerender, unmount } = render(
      <FormFormDescription description='Saved description' readOnly={false} onChange={onChange} />
    );

    fireEvent.change(screen.getByPlaceholderText('Description (optional)'), {
      target: { value: 'Unauthorized pending draft' },
    });
    rerender(<FormFormDescription description='Saved description' readOnly onChange={onChange} />);
    void act(() => jest.advanceTimersByTime(500));
    unmount();

    expect(screen.queryByText('Unauthorized pending draft')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});
