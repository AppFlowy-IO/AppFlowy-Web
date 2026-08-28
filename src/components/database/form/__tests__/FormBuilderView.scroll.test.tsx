import { render, screen } from '@testing-library/react';

import { FormBuilderView } from '../FormBuilderView';

import type { ReactNode } from 'react';

const mockWriter = {
  setFormDescription: jest.fn(),
  reorderQuestion: jest.fn(),
};

jest.mock('@/application/database-yjs', () => ({
  useDatabaseFields: () => undefined,
  useDatabaseFieldsVersion: () => 0,
  useFormLayoutSnapshot: () => ({
    decided: true,
    description: '',
    questions: [],
  }),
  useFormWriter: () => mockWriter,
}));

jest.mock('@/application/database-yjs/context', () => ({
  useDatabaseContextOptional: () => ({
    readOnly: false,
    activeViewId: 'form-view-id',
    databaseDoc: {
      getMap: () => ({
        get: () => ({ get: () => 'database-id' }),
      }),
    },
    loadView: jest.fn(),
  }),
  useDatabaseView: () => undefined,
}));

jest.mock('@/application/database-yjs/dispatch', () => ({
  useAddSelectOptionDispatch: () => jest.fn(),
}));

jest.mock('../FormAccessBanner', () => ({ FormAccessBanner: () => null }));
jest.mock('../FormAutoCreate', () => ({ FormAutoCreate: () => null }));
jest.mock('../FormFormDescription', () => ({ FormFormDescription: () => null }));
jest.mock('../FormPreviewButton', () => ({ FormPreviewButton: () => null }));
jest.mock('../FormQuestionCard', () => ({ FormQuestionCard: () => null }));
jest.mock('../FormQuestionCardReadOnly', () => ({ FormQuestionCardReadOnly: () => null }));
jest.mock('../FormQuestionTypePicker', () => ({ FormQuestionTypePicker: () => null }));
jest.mock('../FormShareButton', () => ({ FormShareButton: () => null }));
jest.mock('../FormTitle', () => ({ FormTitle: () => null }));
jest.mock('../FormShareContext', () => ({
  FormShareProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

describe('FormBuilderView scrolling', () => {
  it('owns vertical scrolling inside fixed database viewports', () => {
    render(<FormBuilderView />);

    const scrollContainer = screen.getByTestId('form-builder-scroll-container');

    ['h-full', 'min-h-0', 'flex-1', 'overflow-y-auto', 'overflow-x-hidden'].forEach((className) => {
      expect(scrollContainer.classList.contains(className)).toBe(true);
    });
  });
});
