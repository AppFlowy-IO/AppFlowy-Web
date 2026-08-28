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

  it('cancels a pending local write when a newer external description arrives', () => {
    const onChange = jest.fn();
    const { rerender } = render(
      <FormFormDescription description='Initial description' readOnly={false} onChange={onChange} />
    );
    const input = screen.getByPlaceholderText('Description (optional)');

    fireEvent.change(input, { target: { value: 'Pending local description' } });
    expect(onChange).not.toHaveBeenCalled();

    rerender(<FormFormDescription description='Remote description' readOnly={false} onChange={onChange} />);

    expect(input.value).toBe('Remote description');

    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe('Remote description');
  });
});
