import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { FieldType } from '@/application/database-yjs/database.type';
import type { FormLayoutSnapshot } from '@/application/database-yjs/form-questions';
import { YjsDatabaseKey, type YDatabaseFields } from '@/application/types';
import type { PublicFormSchema } from '@/application/types/form';

import { FormPreviewButton } from '../FormPreviewButton';

jest.mock('@/components/form/FormBody', () => ({
  FormBody: ({ schema }: { schema: PublicFormSchema }) => (
    <div data-testid='captured-preview'>
      {schema.title}: {schema.questions[0]?.label}
    </div>
  ),
}));

it('captures the current projection on open and adopts later document changes on the next open', async () => {
  const fields = new Map([
    [
      'field-a',
      new Map<string, unknown>([
        [YjsDatabaseKey.name, 'Feedback'],
        [YjsDatabaseKey.type, FieldType.RichText],
      ]),
    ],
  ]) as unknown as YDatabaseFields;
  const snapshot: FormLayoutSnapshot = {
    decided: true,
    fieldOrderIds: ['field-a'],
    explicitlyExcludedFieldIds: [],
    respondentTitle: 'Original',
    description: '',
    questions: [
      {
        fieldId: 'field-a',
        included: true,
        required: false,
        descriptionVisible: false,
        description: '',
        longAnswer: false,
        order: 0,
      },
    ],
  };
  const { rerender } = render(<FormPreviewButton snapshot={snapshot} fieldsMap={fields} fieldsVersion={0} />);

  fireEvent.click(screen.getByTestId('form-preview-button'));
  await waitFor(() => expect(screen.getByTestId('captured-preview').textContent).toBe('Original: Feedback'));
  fields.get('field-a').set(YjsDatabaseKey.name, 'Remote question');
  const remote = { ...snapshot, respondentTitle: 'Remote title' };

  rerender(<FormPreviewButton snapshot={remote} fieldsMap={fields} fieldsVersion={1} />);
  expect(screen.getByTestId('captured-preview').textContent).toBe('Original: Feedback');
  fireEvent.click(screen.getByRole('button', { name: 'Close preview dialog' }));
  await waitFor(() => expect(screen.queryByTestId('form-preview-dialog')).toBeNull());
  fireEvent.click(screen.getByTestId('form-preview-button'));
  await waitFor(() => expect(screen.getByTestId('captured-preview').textContent).toBe('Remote title: Remote question'));
});

it('does not open a blank preview while database fields are unavailable', () => {
  render(<FormPreviewButton snapshot={{} as FormLayoutSnapshot} fieldsMap={undefined} fieldsVersion={0} />);
  expect(screen.getByTestId('form-preview-button').disabled).toBe(true);
});
