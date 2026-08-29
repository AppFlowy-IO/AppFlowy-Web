import { act, fireEvent, render, screen } from '@testing-library/react';

import { FieldType } from '@/application/database-yjs/database.type';
import type { FormWriter } from '@/application/database-yjs/form-writer';

import { FormQuestionCard } from '../FormQuestionCard';

jest.mock('@/components/database/components/field/FieldTypeIcon', () => ({
  FieldTypeIcon: () => <span data-testid='field-type-icon' />,
}));

jest.mock('../FormQuestionPlaceholder', () => ({
  FormQuestionPlaceholder: () => <div data-testid='question-placeholder' />,
}));

function createWriter(): jest.Mocked<FormWriter> {
  return {
    addQuestion: jest.fn(),
    removeQuestion: jest.fn(),
    clearQuestions: jest.fn(),
    populateFromFields: jest.fn(),
    resolveAutoCreate: jest.fn(),
    reorderQuestion: jest.fn(),
    setRequired: jest.fn(),
    setDescriptionVisible: jest.fn(),
    setDescription: jest.fn(),
    setLongAnswer: jest.fn(),
    markDecided: jest.fn(),
    setFormDescription: jest.fn(),
  };
}

function card(
  writer: FormWriter,
  { description = '', descriptionVisible = true }: { description?: string; descriptionVisible?: boolean } = {}
) {
  return (
    <FormQuestionCard
      questionId='question-a'
      name='Question A'
      fieldType={FieldType.RichText}
      required={false}
      description={description}
      descriptionVisible={descriptionVisible}
      longAnswer={false}
      index={0}
      questionCount={1}
      isRichText={true}
      addSelectOption={jest.fn()}
      writer={writer}
    />
  );
}

function renderCard(writer: FormWriter, descriptionVisible = true) {
  return render(
    card(writer, {
      descriptionVisible,
    })
  );
}

describe('FormQuestionCard description writes', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('coalesces typing into one Yjs write after the idle window', () => {
    const writer = createWriter();

    renderCard(writer);
    const input = screen.getByPlaceholderText('Add description');

    fireEvent.change(input, { target: { value: 'F' } });
    fireEvent.change(input, { target: { value: 'Final draft' } });

    expect(writer.setDescription).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(499);
    });
    expect(writer.setDescription).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(writer.setDescription).toHaveBeenCalledTimes(1);
    expect(writer.setDescription).toHaveBeenCalledWith('question-a', 'Final draft');
  });

  it('flushes a pending draft when navigation unmounts the card', () => {
    const writer = createWriter();
    const { unmount } = renderCard(writer);

    fireEvent.change(screen.getByPlaceholderText('Add description'), {
      target: { value: 'Pending draft' },
    });

    unmount();
    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(writer.setDescription).toHaveBeenCalledTimes(1);
    expect(writer.setDescription).toHaveBeenCalledWith('question-a', 'Pending draft');
  });

  it('discards a pending draft when permission is revoked before unmount', () => {
    const writer = createWriter();
    const canWriteRef = { current: true };
    const { unmount } = render(
      <FormQuestionCard
        questionId='question-a'
        name='Question A'
        fieldType={FieldType.RichText}
        required={false}
        description=''
        descriptionVisible
        longAnswer={false}
        index={0}
        questionCount={1}
        isRichText
        addSelectOption={jest.fn()}
        writer={writer}
        canWriteRef={canWriteRef}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('Add description'), {
      target: { value: 'Unauthorized pending draft' },
    });
    canWriteRef.current = false;
    unmount();
    void act(() => jest.advanceTimersByTime(500));

    expect(writer.setDescription).not.toHaveBeenCalled();
  });

  it('flushes the current draft on blur', () => {
    const writer = createWriter();

    renderCard(writer);
    const input = screen.getByPlaceholderText('Add description');

    fireEvent.change(input, { target: { value: 'Blurred draft' } });
    fireEvent.blur(input);

    expect(writer.setDescription).toHaveBeenCalledTimes(1);
    expect(writer.setDescription).toHaveBeenCalledWith('question-a', 'Blurred draft');
  });

  it('does not overwrite a focused local draft with a remote description', () => {
    const writer = createWriter();
    const { rerender } = render(card(writer));
    const input = screen.getByPlaceholderText('Add description');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Local draft' } });
    rerender(card(writer, { description: 'Remote description' }));

    expect((input as HTMLInputElement).value).toBe('Local draft');
    fireEvent.blur(input);

    expect(writer.setDescription).toHaveBeenCalledTimes(1);
    expect(writer.setDescription).toHaveBeenCalledWith('question-a', 'Local draft');
  });

  it('adopts a deferred remote description on blur when the focused value was untouched', () => {
    const writer = createWriter();
    const { rerender } = render(card(writer, { description: 'Original' }));
    const input = screen.getByPlaceholderText('Add description');

    fireEvent.focus(input);
    rerender(card(writer, { description: 'Remote description' }));

    expect((input as HTMLInputElement).value).toBe('Original');
    fireEvent.blur(input);

    expect((input as HTMLInputElement).value).toBe('Remote description');
    expect(writer.setDescription).not.toHaveBeenCalled();
  });

  it('exposes question toggles as checked menu items without nested focus targets', () => {
    const writer = createWriter();

    renderCard(writer);
    const trigger = screen.getByRole('button', { name: 'Question options' });

    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter', code: 'Enter' });

    expect(screen.getByRole('menuitemcheckbox', { name: 'Required' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('menuitemcheckbox', { name: 'Description' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('menuitemcheckbox', { name: 'Long answer' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByRole('switch')).toBeNull();
  });
});
