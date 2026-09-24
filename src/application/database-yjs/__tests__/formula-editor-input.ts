import { act, fireEvent, screen } from '@testing-library/react';

// jsdom has no `isContentEditable`; Slate ignores events whose target lacks it.
if (!('isContentEditable' in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, 'isContentEditable', {
    configurable: true,
    get(this: HTMLElement) {
      const host = this.closest('[contenteditable]');

      return host !== null && host.getAttribute('contenteditable') !== 'false';
    },
  });
}

/** The formula editor's input (a Slate editable, not a textarea). */
export const formulaInput = () => screen.getByTestId('formula-editor-input');

/** The formula source the editor currently holds. */
export const formulaSource = () => formulaInput().getAttribute('data-value');

/** Slate reports changes a microtask after an edit; let the editor settle. */
export async function flushFormulaEditor() {
  await act(async () => {
    await Promise.resolve();
  });
}

/** Replaces the whole formula the way a user would: select all, then paste. */
export async function setFormulaSource(text: string) {
  const input = formulaInput();

  fireEvent.keyDown(input, { key: 'a', ctrlKey: true });
  fireEvent.paste(input, {
    clipboardData: { types: ['text/plain'], getData: (type: string) => (type === 'text/plain' ? text : '') },
  });
  await flushFormulaEditor();
}
