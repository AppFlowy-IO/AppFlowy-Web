import { act, render, screen } from '@testing-library/react';

import { FieldType } from '@/application/database-yjs/database.type';
import type { FormLayoutSnapshot } from '@/application/database-yjs/form-questions';
import { YjsDatabaseKey } from '@/application/types';

import { FormBuilderView } from '../FormBuilderView';

import type { ReactNode } from 'react';
import type { DropResult } from 'react-beautiful-dnd';

const mockWriter = {
  setRespondentTitle: jest.fn(),
  setFormDescription: jest.fn(),
  reorderQuestion: jest.fn(),
};
const decidedSnapshot: FormLayoutSnapshot = {
  decided: true,
  fieldOrderIds: [],
  explicitlyExcludedFieldIds: [],
  respondentTitle: '',
  description: '',
  questions: [],
};
let mockSnapshot = decidedSnapshot;
let mockFields: Map<string, Map<string, unknown>> | undefined;
let mockReadOnly = false;
let mockCanShare = true;
let mockOnDragEnd: ((result: DropResult) => void) | undefined;

jest.mock('@/application/database-yjs', () => ({
  useDatabaseFields: () => mockFields,
  useDatabaseFieldsVersion: () => 0,
  useFormLayoutSnapshot: () => mockSnapshot,
  useFormWriter: () => mockWriter,
}));

jest.mock('@/application/database-yjs/context', () => ({
  useDatabaseContextOptional: () => ({
    readOnly: mockReadOnly,
    canShare: mockCanShare,
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

jest.mock('react-beautiful-dnd', () => ({
  DragDropContext: ({ children, onDragEnd }: { children: ReactNode; onDragEnd: (result: DropResult) => void }) => {
    mockOnDragEnd = onDragEnd;
    return <>{children}</>;
  },
  Droppable: ({
    children,
  }: {
    children: (provided: {
      innerRef: () => void;
      droppableProps: Record<string, never>;
      placeholder: null;
    }) => ReactNode;
  }) => children({ innerRef: jest.fn(), droppableProps: {}, placeholder: null }),
  Draggable: ({
    children,
    draggableId,
  }: {
    children: (
      provided: {
        innerRef: () => void;
        draggableProps: { 'data-draggable-id': string };
        dragHandleProps: Record<string, never>;
      },
      snapshot: { isDragging: boolean }
    ) => ReactNode;
    draggableId: string;
  }) =>
    children(
      {
        innerRef: jest.fn(),
        draggableProps: { 'data-draggable-id': draggableId },
        dragHandleProps: {},
      },
      { isDragging: false }
    ),
}));

jest.mock('../FormAccessBanner', () => ({ FormAccessBanner: () => <div data-testid='form-access-banner' /> }));
jest.mock('../FormAutoCreate', () => ({
  FormAutoCreate: () => <div data-testid='form-auto-create' />,
}));
jest.mock('../FormFormDescription', () => ({
  FormFormDescription: () => <div data-testid='respondent-form-description-editor' />,
}));
jest.mock('../FormRespondentTitle', () => ({
  FormRespondentTitle: () => <div data-testid='respondent-form-title-editor' />,
}));
jest.mock('../FormPreviewButton', () => ({
  FormPreviewButton: () => <button data-testid='form-preview-button' />,
}));
jest.mock('../FormQuestionCard', () => ({ FormQuestionCard: () => null }));
jest.mock('../FormQuestionCardReadOnly', () => ({ FormQuestionCardReadOnly: () => null }));
jest.mock('../FormQuestionTypePicker', () => ({
  FormQuestionTypePicker: () => <div data-testid='form-question-type-picker' />,
}));
jest.mock('../FormShareButton', () => ({ FormShareButton: () => <button data-testid='form-share-button' /> }));
jest.mock('../FormShareContext', () => ({
  FormShareProvider: ({ canUpdateSettings, children }: { canUpdateSettings: boolean; children: ReactNode }) => (
    <div data-testid='form-share-provider' data-can-update={canUpdateSettings ? 'true' : 'false'}>
      {children}
    </div>
  ),
}));

describe('FormBuilderView scrolling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSnapshot = decidedSnapshot;
    mockFields = undefined;
    mockReadOnly = false;
    mockCanShare = true;
    mockOnDragEnd = undefined;
  });

  it('owns vertical scrolling inside fixed database viewports', () => {
    render(<FormBuilderView />);

    const scrollContainer = screen.getByTestId('form-builder-scroll-container');

    ['h-full', 'min-h-0', 'flex-1', 'overflow-y-auto', 'overflow-x-hidden'].forEach((className) => {
      expect(scrollContainer.classList.contains(className)).toBe(true);
    });
    expect(screen.getByTestId('form-question-type-picker')).toBeTruthy();
    expect(screen.queryByText('View name')).toBeNull();
    expect(screen.queryByText('Used in AppFlowy only.')).toBeNull();
    expect(screen.queryByText('Shown to respondents')).toBeNull();
    expect(screen.getByTestId('respondent-form-title-editor')).toBeTruthy();
    expect(screen.getByTestId('respondent-form-description-editor')).toBeTruthy();
  });

  it('evaluates auto-create for a fresh Form even when legacy projection materializes questions', () => {
    mockSnapshot = {
      decided: false,
      fieldOrderIds: ['field-a'],
      explicitlyExcludedFieldIds: [],
      respondentTitle: '',
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

  it('keeps Preview and share-link inspection visible for view-only Forms', () => {
    mockReadOnly = true;
    mockCanShare = false;

    render(<FormBuilderView />);

    expect(screen.getByTestId('form-preview-button')).toBeTruthy();
    expect(screen.getByTestId('form-share-button')).toBeTruthy();
    expect(screen.getByTestId('form-share-provider').getAttribute('data-can-update')).toBe('false');
    expect(screen.getByTestId('form-access-banner')).toBeTruthy();
    expect(screen.queryByTestId('form-question-type-picker')).toBeNull();
  });

  it('uses canonical share permission for an editable member without can_share', () => {
    mockReadOnly = false;
    mockCanShare = false;

    render(<FormBuilderView />);

    expect(screen.getByTestId('form-share-provider').getAttribute('data-can-update')).toBe('false');
    expect(screen.getByTestId('form-question-type-picker')).toBeTruthy();
  });

  it('reorders the dragged ID against the latest visible list after a collaborative change', () => {
    const question = (fieldId: string, order: number) => ({
      fieldId,
      included: true,
      required: false,
      descriptionVisible: false,
      description: '',
      longAnswer: false,
      order,
    });

    mockFields = new Map(
      ['field-a', 'field-b', 'field-c'].map((fieldId) => [
        fieldId,
        new Map<string, unknown>([
          [YjsDatabaseKey.name, fieldId],
          [YjsDatabaseKey.type, FieldType.RichText],
        ]),
      ])
    );
    mockSnapshot = {
      ...decidedSnapshot,
      fieldOrderIds: ['field-a', 'field-b', 'field-c'],
      questions: [question('field-a', 0), question('field-b', 1), question('field-c', 2)],
    };
    const { rerender } = render(<FormBuilderView />);

    // The drag began with field-a at source index 0. Before it is dropped,
    // another client moves field-a after the other visible questions.
    mockSnapshot = {
      ...decidedSnapshot,
      fieldOrderIds: ['field-b', 'field-c', 'field-a'],
      questions: [question('field-b', 0), question('field-c', 1), question('field-a', 2)],
    };
    rerender(<FormBuilderView />);

    act(() => {
      mockOnDragEnd?.({
        draggableId: 'field-a',
        type: 'DEFAULT',
        source: { droppableId: 'form-question-stack', index: 0 },
        destination: { droppableId: 'form-question-stack', index: 1 },
        reason: 'DROP',
        mode: 'FLUID',
        combine: null,
      });
    });

    expect(mockWriter.reorderQuestion).toHaveBeenCalledWith('field-a', 1, ['field-b', 'field-c', 'field-a']);
  });
});
