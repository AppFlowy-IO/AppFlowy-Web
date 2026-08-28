import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import {
  requestPublicFormUploadUrl,
  submitPublicForm,
  uploadFormFileToPresignedUrl,
} from '@/application/services/js-services/http/form-api';
import { FormAnswerValue, PublicFormSchema, PublicQuestion } from '@/application/types/form';
import { FormBody } from '@/components/form/FormBody';

jest.mock('@/application/services/js-services/http/form-api', () => ({
  requestPublicFormUploadUrl: jest.fn(),
  submitPublicForm: jest.fn(),
  uploadFormFileToPresignedUrl: jest.fn(),
}));

jest.mock('@/components/form/FormQuestion', () => ({
  FormQuestion: ({
    question,
    value,
    onChange,
  }: {
    question: PublicQuestion;
    value: FormAnswerValue | undefined;
    onChange: (questionId: string, value: FormAnswerValue) => void;
  }) => {
    if (question.kind === 'date') {
      const portaledDateButton = jest.requireActual<typeof import('react-dom')>('react-dom').createPortal(
        <button
          data-testid={`portaled-select-${question.id}`}
          onClick={() => onChange(question.id, { kind: 'date', iso: '2026-02-02' })}
        >
          Select a new date from the open calendar
        </button>,
        document.body,
      );

      return (
        <div>
          <button
            data-testid={`select-${question.id}`}
            onClick={() => onChange(question.id, { kind: 'date', iso: '2026-01-01' })}
          >
            Select {question.id}
          </button>
          <output data-testid={`answer-${question.id}`}>{value?.kind === 'date' ? value.iso : ''}</output>
          {portaledDateButton}
        </div>
      );
    }

    const fileNames = question.id === 'files-a' ? ['a-1.txt', 'a-2.txt'] : ['b.txt'];

    return (
      <div>
        <button
          data-testid={`select-${question.id}`}
          onClick={() => {
            onChange(question.id, {
              kind: 'files',
              files: fileNames.map((name) => {
                const file = new File([name], name, { type: 'text/plain' });

                return {
                  local_id: `local-${name}`,
                  name,
                  size: file.size,
                  content_type: file.type,
                  file,
                };
              }),
            });
          }}
        >
          Select {question.id}
        </button>
        <output data-testid={`answer-${question.id}`}>
          {value?.kind === 'files'
            ? value.files
                .map((file: { file_id?: string; name: string }) => file.file_id ?? `local:${file.name}`)
                .join(',')
            : ''}
        </output>
      </div>
    );
  },
}));

describe('FormBody file uploads', () => {
  const mockRequestUploadUrl = requestPublicFormUploadUrl as jest.MockedFunction<typeof requestPublicFormUploadUrl>;
  const mockUploadFile = uploadFormFileToPresignedUrl as jest.MockedFunction<typeof uploadFormFileToPresignedUrl>;
  const mockSubmit = submitPublicForm as jest.MockedFunction<typeof submitPublicForm>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockRequestUploadUrl.mockImplementation(async (_token, request) => ({
      file_id: `uploaded-${request.file_name}`,
      upload_url: `https://uploads.example.com/${request.file_name}`,
      download_url: `https://downloads.example.com/${request.file_name}`,
      expires_in_secs: 300,
    }));
    mockSubmit.mockResolvedValue({ kind: 'submitted', submission_id: 'submission-1', status: 'accepted' });
  });

  it('uploads across questions concurrently and retains successful file IDs after a sibling fails', async () => {
    let failSecondQuestion = true;

    mockUploadFile.mockImplementation(async (url) => {
      if (failSecondQuestion && url.endsWith('/b.txt')) {
        throw new Error('b upload failed');
      }
    });

    render(<FormBody token='form-token' schema={schema} />);

    fireEvent.click(screen.getByTestId('select-files-a'));
    fireEvent.click(screen.getByTestId('select-files-b'));
    fireEvent.click(screen.getByTestId('public-form-submit'));

    // Both question groups start before any mint promise settles. The prior
    // question-by-question loop would only have started the two files in A.
    expect(mockRequestUploadUrl).toHaveBeenCalledTimes(3);

    await waitFor(() => expect(screen.getByText('b upload failed')).toBeTruthy());

    expect(screen.getByTestId('answer-files-a').textContent).toBe('uploaded-a-1.txt,uploaded-a-2.txt');
    expect(screen.getByTestId('answer-files-b').textContent).toBe('local:b.txt');
    expect(mockSubmit).not.toHaveBeenCalled();

    failSecondQuestion = false;
    fireEvent.click(screen.getByTestId('public-form-submit'));

    await waitFor(() => expect(screen.getByTestId('public-form-confirmation')).toBeTruthy());

    const mintedNames = mockRequestUploadUrl.mock.calls.map(([, request]) => request.file_name);

    expect(mintedNames.filter((name) => name === 'a-1.txt')).toHaveLength(1);
    expect(mintedNames.filter((name) => name === 'a-2.txt')).toHaveLength(1);
    expect(mintedNames.filter((name) => name === 'b.txt')).toHaveLength(2);
    expect(mockSubmit).toHaveBeenCalledTimes(1);

    const payload = mockSubmit.mock.calls[0][1];

    expect(Object.keys(payload.answers)).toEqual(['files-a', 'files-b']);
    expect(payload.answers['files-a']).toEqual({
      kind: 'files',
      files: [
        { file_id: 'uploaded-a-1.txt', name: 'a-1.txt', size: 7 },
        { file_id: 'uploaded-a-2.txt', name: 'a-2.txt', size: 7 },
      ],
    });
    expect(payload.answers['files-b']).toEqual({
      kind: 'files',
      files: [{ file_id: 'uploaded-b.txt', name: 'b.txt', size: 5 }],
    });
  });

  it('locks every answer while the captured submission is uploading', async () => {
    let finishUpload!: () => void;
    const uploadPending = new Promise<void>((resolve) => {
      finishUpload = resolve;
    });

    mockUploadFile.mockReturnValue(uploadPending);
    render(<FormBody token='form-token' schema={schema} />);

    fireEvent.click(screen.getByTestId('select-files-a'));
    fireEvent.click(screen.getByTestId('select-files-b'));
    fireEvent.click(screen.getByTestId('public-form-submit'));

    const questions = screen.getByTestId('public-form-questions');

    expect(questions.disabled).toBe(true);
    expect(questions.getAttribute('aria-busy')).toBe('true');

    finishUpload();
    await waitFor(() => expect(screen.getByTestId('public-form-confirmation')).toBeTruthy());
  });

  it('ignores changes from a portaled date picker while uploading the captured answers', async () => {
    let finishUpload!: () => void;
    const uploadPending = new Promise<void>((resolve) => {
      finishUpload = resolve;
    });

    mockUploadFile.mockReturnValue(uploadPending);
    render(<FormBody token='form-token' schema={schemaWithDate} />);

    fireEvent.click(screen.getByTestId('select-files-a'));
    fireEvent.click(screen.getByTestId('select-date'));
    fireEvent.click(screen.getByTestId('public-form-submit'));

    expect(screen.getByTestId('public-form-questions').disabled).toBe(true);

    // FormDateInput's calendar lives in a Radix portal, so its controls are
    // not disabled by the questions fieldset. This models selecting a date
    // from an already-open calendar after submission has started.
    fireEvent.click(screen.getByTestId('portaled-select-date'));
    expect(screen.getByTestId('answer-date').textContent).toBe('2026-01-01');

    finishUpload();
    await waitFor(() => expect(screen.getByTestId('public-form-confirmation')).toBeTruthy());

    expect(mockSubmit.mock.calls[0][1].answers.date).toEqual({ kind: 'date', iso: '2026-01-01' });
  });
});

const schema: PublicFormSchema = {
  form_id: 'form-token',
  tier: 'public',
  anonymous: true,
  title: 'Upload form',
  questions: [fileQuestion('files-a'), fileQuestion('files-b')],
  submit_label: 'Submit',
  submit_color: '#00bcf0',
  confirmation_title: 'Thanks',
  allow_another_response: false,
  hide_branding: false,
};

const schemaWithDate: PublicFormSchema = {
  ...schema,
  questions: [fileQuestion('files-a'), dateQuestion('date')],
};

function fileQuestion(id: string): PublicQuestion {
  return {
    id,
    label: id,
    kind: 'files',
    required: true,
    long_answer: false,
    input_style: 'auto',
  };
}

function dateQuestion(id: string): PublicQuestion {
  return {
    id,
    label: id,
    kind: 'date',
    required: true,
    long_answer: false,
    input_style: 'auto',
  };
}
