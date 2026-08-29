import { render, screen } from '@testing-library/react';

import type { FormLayoutSnapshot } from '@/application/database-yjs/form-questions';

import { FormBuilderView } from '../FormBuilderView';

import type { ReactNode } from 'react';

const mockWriter = {
  setFormDescription: jest.fn(),
  reorderQuestion: jest.fn(),
};
const decidedSnapshot: FormLayoutSnapshot = {
  decided: true,
  fieldOrderIds: [],
  description: '',
  questions: [],
};
let mockSnapshot = decidedSnapshot;

jest.mock('@/application/database-yjs', () => ({
  useDatabaseFields: () => undefined,
  useDatabaseFieldsVersion: () => 0,
  useFormLayoutSnapshot: () => mockSnapshot,
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
jest.mock('../FormAutoCreate', () => ({
  FormAutoCreate: () => <div data-testid='form-auto-create' />,
}));
jest.mock('../FormFormDescription', () => ({ FormFormDescription: () => null }));
jest.mock('../FormPreviewButton', () => ({ FormPreviewButton: () => null }));
jest.mock('../FormQuestionCard', () => ({ FormQuestionCard: () => null }));
jest.mock('../FormQuestionCardReadOnly', () => ({ FormQuestionCardReadOnly: () => null }));
jest.mock('../FormQuestionTypePicker', () => ({
  FormQuestionTypePicker: () => <div data-testid='form-question-type-picker' />,
}));
jest.mock('../FormShareButton', () => ({ FormShareButton: () => null }));
jest.mock('../FormTitle', () => ({ FormTitle: () => null }));
jest.mock('../FormShareContext', () => ({
  FormShareProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

describe('FormBuilderView scrolling', () => {
  beforeEach(() => {
    mockSnapshot = decidedSnapshot;
  });

  it('owns vertical scrolling inside fixed database viewports', () => {
    render(<FormBuilderView />);

    const scrollContainer = screen.getByTestId('form-builder-scroll-container');

    ['h-full', 'min-h-0', 'flex-1', 'overflow-y-auto', 'overflow-x-hidden'].forEach((className) => {
      expect(scrollContainer.classList.contains(className)).toBe(true);
    });
    expect(screen.getByTestId('form-question-type-picker')).toBeTruthy();
  });

  it('evaluates auto-create for a fresh Form even when legacy projection materializes questions', () => {
    mockSnapshot = {
      decided: false,
      fieldOrderIds: ['field-a'],
      description: '',
      questions: [
        {
          fieldId: 'field-a',
          included: true,
          required: false,
          descriptionVisible: false,
          description: '',
          longAnswer: false,
          order: 0xffff_ffff,
        },
      ],
    };

    render(<FormBuilderView />);

    expect(screen.getByTestId('form-auto-create')).toBeTruthy();
    expect(screen.getByText('This form hasn’t been set up yet.')).toBeTruthy();
    expect(screen.queryByTestId('form-question-type-picker')).toBeNull();
  });
});
