import { fireEvent, render, screen, within } from '@testing-library/react';

import { PublicFormSchema, PublicQuestion, PublicQuestionKind } from '@/application/types/form';
import { FormBody } from '@/components/form/FormBody';

describe('FormBody typed-answer validation', () => {
  it('uses the legacy display fallback only when the respondent schema title is empty', () => {
    const { rerender } = render(<FormBody token='preview' schema={{ ...schemaFor(), title: '' }} previewMode />);

    expect(screen.getByRole('heading', { level: 1, name: 'Untitled form' })).toBeTruthy();

    rerender(<FormBody token='preview' schema={{ ...schemaFor(), title: '  Customer feedback  ' }} previewMode />);
    expect(screen.getByRole('heading', { level: 1, name: 'Customer feedback' })).toBeTruthy();
  });

  it('preserves authored line breaks in the respondent description', () => {
    render(<FormBody token='preview' schema={{ ...schemaFor(), description: 'First line\nSecond line' }} previewMode />);

    expect(screen.getByText(/First line/).classList.contains('whitespace-pre-wrap')).toBe(true);
  });

  it('shows respondent attribution on the public form but not in builder preview', () => {
    const { rerender } = render(<FormBody token='public-token' schema={schemaFor()} />);

    expect(screen.getByText('Submitting response anonymously')).toBeTruthy();

    rerender(<FormBody token='preview' schema={schemaFor()} previewMode />);
    expect(screen.queryByTestId('public-form-respondent-status')).toBeNull();
  });

  it('shows AppFlowy branding only when the shared-form schema permits it', () => {
    const { rerender } = render(<FormBody token='public-token' schema={schemaFor()} />);
    const body = screen.getByTestId('public-form-body');
    const branding = screen.getByTestId('public-form-branding');
    const logoLink = screen.getByRole('link', { name: 'AppFlowy' });

    expect(body.lastElementChild).toBe(branding);
    expect(logoLink.getAttribute('href')).toBe('https://appflowy.com');

    rerender(<FormBody token='public-token' schema={{ ...schemaFor(), hide_branding: true }} />);
    expect(screen.queryByTestId('public-form-branding')).toBeNull();

    rerender(<FormBody token='preview' schema={schemaFor()} previewMode />);
    expect(screen.queryByTestId('public-form-branding')).toBeNull();
  });

  it.each([
    ['url', 'ftp://appflowy.io', 'Enter a valid URL that starts with http:// or https://.'],
    ['url', 'https://user:secret@appflowy.io', 'Enter a valid URL that starts with http:// or https://.'],
    ['email', 'person@invalid_domain.test', 'Enter a valid email address.'],
    ['email', 'person@[001.002.003.004]', 'Enter a valid email address.'],
    ['phone', '+1 555/1234', 'Enter a valid phone number.'],
  ] satisfies Array<[PublicQuestionKind, string, string]>)(
    'shows a field error for an invalid %s answer',
    async (kind, value, error) => {
      render(<FormBody token='preview' schema={schemaFor(question(kind))} previewMode />);

      fireEvent.change(await questionInput(kind), { target: { value } });
      fireEvent.click(screen.getByTestId('public-form-submit'));

      expect(screen.getByText(error)).toBeTruthy();
      expect(screen.queryByTestId('public-form-confirmation')).toBeNull();
    }
  );

  it('accepts values allowed by the server URL, email, and phone validators', async () => {
    const questions = [question('url'), question('email'), question('phone')];

    render(<FormBody token='preview' schema={schemaFor(...questions)} previewMode />);

    fireEvent.change(await questionInput('url'), { target: { value: 'https://appflowy.io/forms?q=1' } });
    fireEvent.change(await questionInput('email'), { target: { value: 'person@[127.0.0.1]' } });
    fireEvent.change(await questionInput('phone'), { target: { value: '+1 (555) 123-4567 x89' } });
    fireEvent.click(screen.getByTestId('public-form-submit'));

    expect(screen.getByTestId('public-form-confirmation')).toBeTruthy();
  });

  it('keeps Required as the field error for a whitespace-only required typed answer', async () => {
    render(<FormBody token='preview' schema={schemaFor(question('email', true))} previewMode />);

    fireEvent.change(await questionInput('email'), { target: { value: '   ' } });
    fireEvent.click(screen.getByTestId('public-form-submit'));

    expect(screen.getByText('Required')).toBeTruthy();
    expect(screen.queryByText('Enter a valid email address.')).toBeNull();
  });
});

async function questionInput(kind: PublicQuestionKind): Promise<HTMLInputElement> {
  return within(screen.getByTestId(`public-form-question-${kind}`)).findByRole('textbox');
}

function question(kind: PublicQuestionKind, required = false): PublicQuestion {
  return {
    id: kind,
    label: kind,
    kind,
    required,
    long_answer: false,
    input_style: 'auto',
  };
}

function schemaFor(...questions: PublicQuestion[]): PublicFormSchema {
  return {
    form_id: 'preview',
    tier: 'public',
    anonymous: true,
    title: 'Validation form',
    questions,
    submit_label: 'Submit',
    submit_color: 'primary',
    confirmation_title: 'Thanks',
    allow_another_response: false,
    hide_branding: false,
  };
}
