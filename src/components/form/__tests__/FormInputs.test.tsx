import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';

import { PublicQuestion } from '@/application/types/form';
import { FormNumberInput } from '@/components/form/inputs/FormNumberInput';
import { FormTextInput } from '@/components/form/inputs/FormTextInput';

describe('respondent form inputs', () => {
  it('uses a single-line input unless the text question enables Long answer', async () => {
    const { rerender } = render(<FormTextInput question={textQuestion(false)} value='' onChange={jest.fn()} />);

    expect(screen.getByRole('textbox').tagName).toBe('INPUT');

    rerender(<FormTextInput question={textQuestion(true)} value='' onChange={jest.fn()} />);

    await waitFor(() => expect(screen.getByRole('textbox').tagName).toBe('TEXTAREA'));
  });

  it('keeps a negative decimal draft intact while its controlled value updates', () => {
    render(<ControlledNumberInput />);

    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: '-' } });
    expect(input.value).toBe('-');

    fireEvent.change(input, { target: { value: '-0' } });
    expect(input.value).toBe('-0');
    expect(screen.getByTestId('number-value').textContent).toBe('-0');

    fireEvent.change(input, { target: { value: '-0.' } });
    expect(input.value).toBe('-0.');

    fireEvent.change(input, { target: { value: '-0.5' } });
    expect(input.value).toBe('-0.5');
    expect(screen.getByTestId('number-value').textContent).toBe('-0.5');
  });

  it('synchronizes a numeric draft when the controlled value resets externally', () => {
    render(<ControlledNumberInput />);

    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: '-0.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set externally' }));
    expect(input.value).toBe('12.5');

    fireEvent.click(screen.getByRole('button', { name: 'Reset externally' }));
    expect(input.value).toBe('');
  });
});

function ControlledNumberInput() {
  const [value, setValue] = useState<number | null>(null);

  return (
    <>
      <FormNumberInput value={value} onChange={setValue} />
      <output data-testid='number-value'>{Object.is(value, -0) ? '-0' : String(value)}</output>
      <button onClick={() => setValue(12.5)}>Set externally</button>
      <button onClick={() => setValue(null)}>Reset externally</button>
    </>
  );
}

function textQuestion(longAnswer: boolean): PublicQuestion {
  return {
    id: 'text',
    label: 'Text',
    kind: 'text',
    required: false,
    long_answer: longAnswer,
    input_style: 'auto',
  };
}
