import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { FormLayoutSnapshot } from '@/application/database-yjs/form-questions';
import type { YDatabaseFields } from '@/application/types';

import { FormPreviewButton } from '../FormPreviewButton';

jest.mock('@/components/form/FormBody', () => ({
  FormBody: () => {
    throw new Error('preview chunk failed');
  },
}));

describe('FormPreviewButton lazy-load boundary', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps a preview component failure inside the dialog', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <FormPreviewButton
        snapshot={EMPTY_SNAPSHOT}
        fieldsMap={new Map() as unknown as YDatabaseFields}
        fieldsVersion={0}
      />
    );

    fireEvent.click(screen.getByTestId('form-preview-button'));

    expect(await screen.findByTestId('form-preview-load-error')).toBeTruthy();
    expect(screen.getByTestId('form-preview-button')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close preview' }));
    await waitFor(() => expect(screen.queryByTestId('form-preview-dialog')).toBeNull());
  });
});

const EMPTY_SNAPSHOT: FormLayoutSnapshot = {
  decided: true,
  fieldOrderIds: [],
  explicitlyExcludedFieldIds: [],
  respondentTitle: '',
  description: '',
  questions: [],
};
