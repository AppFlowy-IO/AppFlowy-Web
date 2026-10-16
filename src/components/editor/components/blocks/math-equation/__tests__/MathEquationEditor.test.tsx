import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';

import { MathEquationEditor } from '../MathEquationEditor';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

function setup(initialValue = 'E=mc^2') {
  const onSave = jest.fn(),
    onCancel = jest.fn(),
    onAskAI = jest.fn();

  render(<MathEquationEditor initialValue={initialValue} onSave={onSave} onCancel={onCancel} onAskAI={onAskAI} />);
  return { onSave, onCancel, onAskAI };
}

describe('Flutter equation editor parity', () => {
  it.each(['button', 'Enter'])('inserts the latest formula with %s', (method) => {
    const { onSave } = setup('');

    fireEvent.change(screen.getByRole('textbox'), { target: { value: String.raw`\int_a^b f(x)dx = F(b) - F(a)` } });
    if (method === 'Enter') fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    else fireEvent.click(screen.getByRole('button', { name: 'document.plugins.mathEquation.insert' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(String.raw`\int_a^b f(x)dx = F(b) - F(a)`);
  });

  it('preserves the draft when expanding and returning; Enter commits from the dialog', async () => {
    const { onSave } = setup();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'x^2' } });
    fireEvent.click(screen.getByRole('button', { name: 'document.imageBlock.openFullScreen' }));
    const dialog = screen.getByRole('dialog');

    expect((within(dialog).getByRole('textbox') as HTMLTextAreaElement).value).toBe('x^2');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'y^2' } });
    fireEvent.keyDown(within(dialog).getByRole('textbox'), { key: 'Escape' });
    await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('y^2'));
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'document.imageBlock.openFullScreen' }));
    fireEvent.keyDown(within(screen.getByRole('dialog')).getByRole('textbox'), { key: 'Enter' });
    expect(onSave).toHaveBeenCalledWith('y^2');
  });

  it.each([false, true])('Cancel discards an unsaved draft (expanded=%s)', (expanded) => {
    const { onSave, onCancel } = setup();

    if (expanded) fireEvent.click(screen.getByRole('button', { name: 'document.imageBlock.openFullScreen' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'unsaved' } });
    fireEvent.click(screen.getByRole('button', { name: 'button.cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('supports multiline input and ignores composition Enter', () => {
    const { onSave } = setup();

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', shiftKey: true });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', isComposing: true });
    expect(onSave).not.toHaveBeenCalled();
  });

  it.each([false, true])('hands the unsaved draft to AI (expanded=%s)', (expanded) => {
    const { onSave, onAskAI } = setup();

    if (expanded) fireEvent.click(screen.getByRole('button', { name: 'document.imageBlock.openFullScreen' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '\\begin{align*}\nx &= y\n\\end{align*}' } });
    fireEvent.click(screen.getByRole('button', { name: 'document.plugins.mathEquation.askAI' }));
    expect(onAskAI).toHaveBeenCalledWith('\\begin{align*}\nx &= y\n\\end{align*}');
    expect(onSave).not.toHaveBeenCalled();
  });
});
