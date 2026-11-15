import { fireEvent, render, screen } from '@testing-library/react';

import { FieldType } from '@/application/database-yjs/database.type';
import { FormQuestionTypePicker } from '../FormQuestionTypePicker';

const mockCreateQuestion = jest.fn();

jest.mock('@/application/database-yjs/dispatch', () => ({
  useNewFormQuestionDispatch: () => mockCreateQuestion,
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

it('offers only new question types and creates the chosen field once', () => {
  render(<FormQuestionTypePicker />);
  fireEvent.pointerDown(screen.getByTestId('form-add-question-button'), {
    button: 0,
    ctrlKey: false,
    pointerType: 'mouse',
  });
  fireEvent.keyDown(screen.getByTestId('form-add-question-button'), { key: 'Enter' });

  expect(screen.queryByText('Existing properties')).toBeNull();
  expect(screen.queryByText('New question')).toBeNull();
  fireEvent.click(screen.getByTestId(`form-question-type-option-${FieldType.Media}`));
  expect(mockCreateQuestion).toHaveBeenCalledTimes(1);
  expect(mockCreateQuestion).toHaveBeenCalledWith(FieldType.Media);
  expect(screen.queryByRole('menu')).toBeNull();
});
