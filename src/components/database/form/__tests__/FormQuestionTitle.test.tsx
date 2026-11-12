import { render, screen } from '@testing-library/react';
import { FieldType } from '@/application/database-yjs/database.type';
import { FormQuestionTitle } from '../FormQuestionTitle';
import { TooltipProvider } from '@/components/ui/tooltip';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'grid.field.textFieldName': 'Text',
        'grid.field.multiSelectFieldName': 'Multi-select',
      }[key] ?? key),
  }),
}));

it('appends the localized type without modifying the authored name', () => {
  render(<FormQuestionTitle name='Feedback' fieldType={FieldType.RichText} required />);
  expect(screen.getByRole('heading').textContent).toBe('Feedback (Text)*');
  expect(screen.getByLabelText('required').className).toContain('text-text-error');
});

it('keeps selection guidance in an accessible tooltip beside the title', () => {
  render(
    <TooltipProvider>
      <FormQuestionTitle name='Topics' fieldType={FieldType.MultiSelect} required={false} />
    </TooltipProvider>
  );
  expect(screen.getByRole('heading').textContent).toBe('Topics (Multi-select)');
  expect(screen.getByLabelText('Respondents can select as many as they like').tabIndex).toBe(0);
  expect(screen.queryByText('Respondents can select as many as they like')).toBeNull();
});
