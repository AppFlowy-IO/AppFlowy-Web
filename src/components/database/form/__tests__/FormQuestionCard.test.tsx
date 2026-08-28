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
    reorderQuestion: jest.fn(),
    setRequired: jest.fn(),
    setDescriptionVisible: jest.fn(),
    setDescription: jest.fn(),
    setLongAnswer: jest.fn(),
    markDecided: jest.fn(),
    setFormDescription: jest.fn(),
  };
}

function renderCard(writer: FormWriter, descriptionVisible = true) {
  return render(
    <FormQuestionCard
      questionId='question-a'
      name='Question A'
      fieldType={FieldType.RichText}
      required={false}
      description=''
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

  it('cancels a pending draft on removal instead of recreating the form entry', () => {
    const writer = createWriter();
    const { unmount } = renderCard(writer);

    fireEvent.change(screen.getByPlaceholderText('Add description'), {
      target: { value: 'Pending draft' },
    });

    // Removing a question synchronously unmounts its card. A cleanup write
    // would call FormWriter.ensureEntry and recreate the entry that was just
    // deleted.
    unmount();
    act(() => {
      jest.advanceTimersByTime(500);
    });

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
});
