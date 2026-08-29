import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { FieldType } from '@/application/database-yjs/database.type';
import type { FormLayoutSnapshot } from '@/application/database-yjs/form-questions';
import type { FormWriter } from '@/application/database-yjs/form-writer';
import type { YDatabaseField, YDatabaseFields } from '@/application/types';
import { YjsDatabaseKey } from '@/application/types';

import { FormAutoCreate } from '../FormAutoCreate';

function createFields(fieldIds: readonly string[] = ['field-a']): YDatabaseFields {
  const doc = new Y.Doc();
  const fields = doc.getMap('fields') as YDatabaseFields;

  fieldIds.forEach((fieldId) => {
    const field = new Y.Map() as YDatabaseField;

    field.set(YjsDatabaseKey.type, FieldType.RichText);
    fields.set(fieldId, field);
  });
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
  fieldOrderIds: ['field-a'],
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
        })
    );
    const writer = createWriter();

    render(
      <FormAutoCreate
        snapshot={undecided}
        fields={createFields()}
        fieldsVersion={0}
        writer={writer}
        ensureHydrated={ensureHydrated}
      />
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
      />
    );

    rerender(
      <FormAutoCreate
        snapshot={{ ...undecided, decided: true }}
        fields={fields}
        fieldsVersion={0}
        writer={writer}
        ensureHydrated={ensureHydrated}
      />
    );

    await act(async () => finishHydration());

    expect(writer.populateFromFields).not.toHaveBeenCalled();
    expect(writer.markDecided).not.toHaveBeenCalled();
  });

  it('uses Form field order for the silent two-question auto-create path', async () => {
    const writer = createWriter();

    render(
      <FormAutoCreate
        snapshot={{ ...undecided, fieldOrderIds: ['field-b', 'field-a'] }}
        fields={createFields(['field-a', 'field-b'])}
        fieldsVersion={0}
        writer={writer}
        ensureHydrated={() => Promise.resolve()}
      />
    );

    await waitFor(() => expect(writer.markDecided).toHaveBeenCalledTimes(1));
    expect(writer.populateFromFields).toHaveBeenCalledWith(['field-b', 'field-a']);
  });

  it('uses Form field order when confirming the three-question dialog path', async () => {
    const writer = createWriter();

    render(
      <FormAutoCreate
        snapshot={{ ...undecided, fieldOrderIds: ['field-c', 'field-a', 'field-b'] }}
        fields={createFields(['field-a', 'field-b', 'field-c'])}
        fieldsVersion={0}
        writer={writer}
        ensureHydrated={() => Promise.resolve()}
      />
    );

    fireEvent.click(await screen.findByTestId('form-auto-create-confirm'));

    expect(writer.populateFromFields).toHaveBeenCalledWith(['field-c', 'field-a', 'field-b']);
    expect(writer.markDecided).toHaveBeenCalledTimes(1);
  });

  it('does not decide before Form field order metadata is resolved', async () => {
    const writer = createWriter();

    render(
      <FormAutoCreate
        snapshot={{ ...undecided, fieldOrderIds: null }}
        fields={createFields()}
        fieldsVersion={0}
        writer={writer}
        ensureHydrated={() => Promise.resolve()}
      />
    );

    await act(async () => undefined);

    expect(writer.populateFromFields).not.toHaveBeenCalled();
    expect(writer.markDecided).not.toHaveBeenCalled();
  });

  it('surfaces a persistent retry error without making a stale decision', async () => {
    const writer = createWriter();

    render(
      <FormAutoCreate
        snapshot={undecided}
        fields={createFields()}
        fieldsVersion={0}
        writer={writer}
        ensureHydrated={() => Promise.reject(new Error('Network unavailable'))}
      />
    );

    expect(await screen.findByTestId('form-auto-create-hydration-error')).toBeTruthy();
    expect(screen.getByText('Network unavailable')).toBeTruthy();
    expect(screen.getByTestId('form-auto-create-hydration-retry')).toBeTruthy();
    expect(writer.populateFromFields).not.toHaveBeenCalled();
    expect(writer.markDecided).not.toHaveBeenCalled();
  });

  it('stays fail-closed while retrying and auto-creates only after retry hydration succeeds', async () => {
    let finishRetry!: () => void;
    const ensureHydrated = jest
      .fn<Promise<void>, []>()
      .mockRejectedValueOnce(new Error('Temporary failure'))
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishRetry = resolve;
          })
      );
    const writer = createWriter();

    render(
      <FormAutoCreate
        snapshot={undecided}
        fields={createFields()}
        fieldsVersion={0}
        writer={writer}
        ensureHydrated={ensureHydrated}
      />
    );

    fireEvent.click(await screen.findByTestId('form-auto-create-hydration-retry'));

    await waitFor(() => expect(ensureHydrated).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('form-auto-create-hydration-error')).toBeNull();
    expect(writer.populateFromFields).not.toHaveBeenCalled();
    expect(writer.markDecided).not.toHaveBeenCalled();

    await act(async () => finishRetry());

    await waitFor(() => expect(writer.markDecided).toHaveBeenCalledTimes(1));
    expect(writer.populateFromFields).toHaveBeenCalledWith(['field-a']);
  });
});
