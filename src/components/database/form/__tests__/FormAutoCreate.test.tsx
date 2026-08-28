import { act, render, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { FieldType } from '@/application/database-yjs/database.type';
import type { FormLayoutSnapshot } from '@/application/database-yjs/form-questions';
import type { FormWriter } from '@/application/database-yjs/form-writer';
import type { YDatabaseField, YDatabaseFields } from '@/application/types';
import { YjsDatabaseKey } from '@/application/types';

import { FormAutoCreate } from '../FormAutoCreate';

function createFields(): YDatabaseFields {
  const doc = new Y.Doc();
  const fields = doc.getMap('fields') as YDatabaseFields;
  const field = new Y.Map() as YDatabaseField;

  field.set(YjsDatabaseKey.type, FieldType.RichText);
  fields.set('field-a', field);
  return fields;
}

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

const undecided: FormLayoutSnapshot = {
  decided: false,
  description: '',
  questions: [],
};

describe('FormAutoCreate hydration', () => {
  it('does not write until authoritative hydration completes', async () => {
    let finishHydration!: () => void;
    const ensureHydrated = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finishHydration = resolve;
        }),
    );
    const writer = createWriter();

    render(
      <FormAutoCreate
        snapshot={undecided}
        fields={createFields()}
        fieldsVersion={0}
        writer={writer}
        ensureHydrated={ensureHydrated}
      />,
    );

    expect(ensureHydrated).toHaveBeenCalledTimes(1);
    expect(writer.populateFromFields).not.toHaveBeenCalled();
    expect(writer.markDecided).not.toHaveBeenCalled();

    await act(async () => finishHydration());

    await waitFor(() => expect(writer.markDecided).toHaveBeenCalledTimes(1));
    expect(writer.populateFromFields).toHaveBeenCalledWith(['field-a']);
  });

  it('honors a remote decision that arrives during hydration', async () => {
    let finishHydration!: () => void;
    const ensureHydrated = () =>
      new Promise<void>((resolve) => {
        finishHydration = resolve;
      });
    const writer = createWriter();
    const fields = createFields();
    const { rerender } = render(
      <FormAutoCreate
        snapshot={undecided}
        fields={fields}
        fieldsVersion={0}
        writer={writer}
        ensureHydrated={ensureHydrated}
      />,
    );

    rerender(
      <FormAutoCreate
        snapshot={{ ...undecided, decided: true }}
        fields={fields}
        fieldsVersion={0}
        writer={writer}
        ensureHydrated={ensureHydrated}
      />,
    );

    await act(async () => finishHydration());

    expect(writer.populateFromFields).not.toHaveBeenCalled();
    expect(writer.markDecided).not.toHaveBeenCalled();
  });
});
