import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import * as formApi from '@/application/services/js-services/http/form-api';
import { PublicFormSchema, PublicQuestion, PublicQuestionKind } from '@/application/types/form';
import { FormBody } from '@/components/form/FormBody';

describe('FormBody typed-answer validation', () => {
  const scrollIntoView = jest.fn();
  const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');

  beforeAll(() => {
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
  });

  beforeEach(() => scrollIntoView.mockClear());

  it('keeps validated desktop preview answers visible and invokes feedback without submitting', async () => {
    const onPreviewSubmit = jest.fn();
    const submit = jest.spyOn(formApi, 'submitPublicForm');

    render(
      <FormBody
        token='preview'
        schema={schemaFor(question('text', true))}
        previewMode
        onPreviewSubmit={onPreviewSubmit}
      />
    );
    const input = await questionInput('text');

    fireEvent.change(input, { target: { value: 'Keep this local answer' } });
    fireEvent.click(screen.getByTestId('public-form-submit'));
    expect(onPreviewSubmit).toHaveBeenCalledTimes(1);
    expect(input.value).toBe('Keep this local answer');
    expect(screen.queryByTestId('public-form-confirmation')).toBeNull();
    expect(submit).not.toHaveBeenCalled();
    submit.mockRestore();
  });

  it('disables submission of an empty desktop preview', () => {
    render(<FormBody token='preview' schema={schemaFor()} previewMode />);
    expect(screen.getByTestId('public-form-submit').disabled).toBe(true);
  });

  afterAll(() => {
    if (scrollIntoViewDescriptor) {
      Object.defineProperty(Element.prototype, 'scrollIntoView', scrollIntoViewDescriptor);
    } else {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
    }
  });

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

  it('makes an unanswered required question visible and clears feedback after it is corrected', async () => {
    render(<FormBody token='preview' schema={schemaFor(question('text', true))} previewMode />);
    const input = await questionInput('text');
    const submit = screen.getByTestId('public-form-submit');

    submit.focus();
    fireEvent.click(submit);

    expect(screen.getByRole('alert').textContent).toBe('Please review 1 answer before submitting.');
    expect(input.parentElement?.classList.contains('ring-1')).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(scrollIntoView.mock.instances[0]).toBe(screen.getByTestId('public-form-question-text'));
    expect(screen.queryByTestId('public-form-confirmation')).toBeNull();

    fireEvent.change(input, { target: { value: 'Niseko United' } });

    expect(screen.queryByRole('alert')).toBeNull();
    expect(input.parentElement?.classList.contains('ring-1')).toBe(false);
    fireEvent.click(submit);
    expect(screen.getByTestId('public-form-confirmation')).toBeTruthy();
  });

  it('counts invalid answers and focuses the first question in the authored order', async () => {
    render(
      <FormBody token='preview' schema={schemaFor(question('phone', true), question('email', true))} previewMode />
    );
    const firstInput = await questionInput('phone');

    await questionInput('email');
    fireEvent.click(screen.getByTestId('public-form-submit'));

    expect(screen.getByRole('alert').textContent).toBe('Please review 2 answers before submitting.');
    await waitFor(() => expect(document.activeElement).toBe(firstInput));
    expect(scrollIntoView.mock.instances[0]).toBe(screen.getByTestId('public-form-question-phone'));

    fireEvent.change(firstInput, { target: { value: '+1 555 123 4567' } });

    expect(screen.getByRole('alert').textContent).toBe('Please review 1 answer before submitting.');
    expect(document.activeElement).toBe(firstInput);
  });

  it('reveals server validation errors in authored order after locally valid answers', async () => {
    const submitResponse = jest.spyOn(formApi, 'submitPublicForm').mockResolvedValueOnce({
      kind: 'invalid',
      field_errors: { email: 'This email cannot be used.', phone: 'This phone cannot be used.' },
    });

    try {
      render(<FormBody token='shared-form' schema={schemaFor(question('phone', true), question('email', true))} />);
      const firstInput = await questionInput('phone');

      fireEvent.change(firstInput, { target: { value: '+1 555 123 4567' } });
      fireEvent.change(await questionInput('email'), { target: { value: 'person@example.com' } });
      screen.getByTestId('public-form-submit').focus();
      fireEvent.click(screen.getByTestId('public-form-submit'));

      expect((await screen.findByRole('alert')).textContent).toBe('Please review 2 answers before submitting.');
      expect(submitResponse).toHaveBeenCalledTimes(1);
      expect(screen.getByText('This phone cannot be used.')).toBeTruthy();
      expect(screen.getByText('This email cannot be used.')).toBeTruthy();
      await waitFor(() => expect(document.activeElement).toBe(firstInput));
      expect(scrollIntoView.mock.instances[0]).toBe(screen.getByTestId('public-form-question-phone'));
      expect(screen.queryByTestId('public-form-confirmation')).toBeNull();
    } finally {
      submitResponse.mockRestore();
    }
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
