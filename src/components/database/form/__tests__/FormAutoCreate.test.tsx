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

const undecided: FormLayoutSnapshot = {
  decided: false,
  fieldOrderIds: ['field-a'],
  explicitlyExcludedFieldIds: [],
  description: '',
  questions: [],
};

const noopDismiss = () => undefined;

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
        onDismiss={noopDismiss}
      />
    );

    expect(ensureHydrated).toHaveBeenCalledTimes(1);
    expect(writer.resolveAutoCreate).not.toHaveBeenCalled();

    await act(async () => finishHydration());

    expect(await screen.findByRole('dialog', { name: 'Auto-create form questions' })).toBeTruthy();
    expect(writer.resolveAutoCreate).not.toHaveBeenCalled();
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
        onDismiss={noopDismiss}
      />
    );

    rerender(
      <FormAutoCreate
        snapshot={{ ...undecided, decided: true }}
        fields={fields}
        fieldsVersion={0}
        writer={writer}
        ensureHydrated={ensureHydrated}
        onDismiss={noopDismiss}
      />
    );

    await act(async () => finishHydration());

    expect(writer.resolveAutoCreate).not.toHaveBeenCalled();
  });

  it('offers the setup choice for a linked two-question Form in Form field order', async () => {
    const writer = createWriter();

    render(
      <FormAutoCreate
        snapshot={{ ...undecided, fieldOrderIds: ['field-b', 'field-a'] }}
        fields={createFields(['field-a', 'field-b'])}
        fieldsVersion={0}
        writer={writer}
        ensureHydrated={() => Promise.resolve()}
        onDismiss={noopDismiss}
      />
    );

    expect(await screen.findByRole('dialog', { name: 'Auto-create form questions' })).toBeTruthy();
    fireEvent.click(await screen.findByTestId('form-auto-create-confirm'));

    expect(writer.resolveAutoCreate).toHaveBeenCalledWith(['field-b', 'field-a']);
  });

  it('silently resolves an unresolved Form with no supported projected questions', async () => {
    const writer = createWriter();

    render(
      <FormAutoCreate
        snapshot={{ ...undecided, fieldOrderIds: [] }}
        fields={createFields([])}
        fieldsVersion={0}
        writer={writer}
        ensureHydrated={() => Promise.resolve()}
        onDismiss={noopDismiss}
      />
    );

    await waitFor(() => expect(writer.resolveAutoCreate).toHaveBeenCalledWith([]));
    expect(screen.queryByRole('dialog', { name: 'Auto-create form questions' })).toBeNull();
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
        onDismiss={noopDismiss}
      />
    );

    expect(await screen.findByRole('dialog', { name: 'Auto-create form questions' })).toBeTruthy();
    fireEvent.click(await screen.findByTestId('form-auto-create-confirm'));

    expect(writer.resolveAutoCreate).toHaveBeenCalledWith(['field-c', 'field-a', 'field-b']);
  });

  it('resolves Start from scratch with an empty membership in one writer call', async () => {
    const writer = createWriter();

    render(
      <FormAutoCreate
        snapshot={{ ...undecided, fieldOrderIds: ['field-a', 'field-b', 'field-c'] }}
        fields={createFields(['field-a', 'field-b', 'field-c'])}
        fieldsVersion={0}
        writer={writer}
        ensureHydrated={() => Promise.resolve()}
        onDismiss={noopDismiss}
      />
    );

    fireEvent.click(await screen.findByTestId('form-auto-create-start-from-scratch'));

    expect(writer.resolveAutoCreate).toHaveBeenCalledTimes(1);
    expect(writer.resolveAutoCreate).toHaveBeenCalledWith([]);
    expect(writer.clearQuestions).not.toHaveBeenCalled();
    expect(writer.markDecided).not.toHaveBeenCalled();
  });

  it('does not treat Escape as an implicit Start from scratch decision', async () => {
    const writer = createWriter();
    const onDismiss = jest.fn();

    render(
      <FormAutoCreate
        snapshot={{ ...undecided, fieldOrderIds: ['field-a', 'field-b', 'field-c'] }}
        fields={createFields(['field-a', 'field-b', 'field-c'])}
        fieldsVersion={0}
        writer={writer}
        ensureHydrated={() => Promise.resolve()}
        onDismiss={onDismiss}
      />
    );

    const dialog = await screen.findByRole('dialog', { name: 'Auto-create form questions' });

    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });

    expect(writer.resolveAutoCreate).not.toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Auto-create form questions' })).toBeNull());
  });

  it('preserves explicit legacy exclusions while resolving auto-create', async () => {
    const writer = createWriter();

    render(
      <FormAutoCreate
        snapshot={{
          ...undecided,
          fieldOrderIds: ['field-a', 'field-b'],
          explicitlyExcludedFieldIds: ['field-b'],
        }}
        fields={createFields(['field-a', 'field-b'])}
        fieldsVersion={0}
        writer={writer}
        ensureHydrated={() => Promise.resolve()}
        onDismiss={noopDismiss}
      />
    );

    expect(await screen.findByRole('dialog', { name: 'Auto-create form questions' })).toBeTruthy();
    fireEvent.click(await screen.findByTestId('form-auto-create-confirm'));

    expect(writer.resolveAutoCreate).toHaveBeenCalledWith(['field-a']);
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
        onDismiss={noopDismiss}
      />
    );

    await act(async () => undefined);

    expect(writer.resolveAutoCreate).not.toHaveBeenCalled();
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
        onDismiss={noopDismiss}
      />
    );

    expect(await screen.findByTestId('form-auto-create-hydration-error')).toBeTruthy();
    expect(screen.getByText('Network unavailable')).toBeTruthy();
    expect(screen.getByTestId('form-auto-create-hydration-retry')).toBeTruthy();
    expect(writer.resolveAutoCreate).not.toHaveBeenCalled();
  });

  it('stays fail-closed while retrying and offers setup only after retry hydration succeeds', async () => {
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
        onDismiss={noopDismiss}
      />
    );

    fireEvent.click(await screen.findByTestId('form-auto-create-hydration-retry'));

    await waitFor(() => expect(ensureHydrated).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('form-auto-create-hydration-error')).toBeNull();
    expect(writer.resolveAutoCreate).not.toHaveBeenCalled();

    await act(async () => finishRetry());

    expect(await screen.findByRole('dialog', { name: 'Auto-create form questions' })).toBeTruthy();
    expect(writer.resolveAutoCreate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('form-auto-create-confirm'));
    expect(writer.resolveAutoCreate).toHaveBeenCalledWith(['field-a']);
  });
});
