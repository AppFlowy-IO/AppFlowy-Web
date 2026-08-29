import {
  getPublicFormSchema,
  requestPublicFormUploadUrl,
  submitPublicForm,
  uploadFormFileToPresignedUrl,
} from '../form-api';
import { getPublicFormClient } from '../public-form-client';

jest.mock('../public-form-client', () => ({
  ...jest.requireActual('../public-form-client'),
  getPublicFormClient: jest.fn(),
}));

describe('public form uploads', () => {
  const originalFetch = global.fetch;
  const mockGetPublicFormClient = getPublicFormClient as jest.MockedFunction<typeof getPublicFormClient>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('uses the exact server-signed content type for a MIME-less file', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });

    global.fetch = fetchMock as unknown as typeof fetch;

    const file = new File(['payload'], 'extensionless', { type: '' });

    await uploadFormFileToPresignedUrl('https://uploads.example.com/signed', file, 'application/zip', '*');

    expect(fetchMock).toHaveBeenCalledWith('https://uploads.example.com/signed', {
      method: 'PUT',
      body: file,
      headers: {
        'Content-Type': 'application/zip',
        'If-None-Match': '*',
      },
    });
  });

  it('rejects an AppResponse envelope on the direct public schema route', async () => {
    const get = jest.fn().mockResolvedValue({
      data: {
        code: 0,
        data: { kind: 'closed', message: 'Closed' },
        message: '',
      },
    });

    mockGetPublicFormClient.mockReturnValue({ get } as never);

    await expect(getPublicFormSchema('c6c31f9b-c334-4e3a-be20-79f661d4ad87')).rejects.toMatchObject({
      message: 'Malformed form schema response',
    });
  });

  it('always requests create-only v2 and accepts only its complete signed-header contract', async () => {
    const post = jest.fn().mockResolvedValue({
      data: {
        file_id: 'b5860623-7ab8-40a7-a8bd-594b741d5a82',
        upload_url: 'https://uploads.example.com/signed',
        upload_content_type: 'application/pdf',
        upload_protocol: 'create_only_v2',
        upload_if_none_match: '*',
        expires_in_secs: 900,
      },
    });

    mockGetPublicFormClient.mockReturnValue({ post } as never);

    await expect(
      requestPublicFormUploadUrl('c6c31f9b-c334-4e3a-be20-79f661d4ad87', {
        file_name: 'proof.pdf',
        content_length: 42,
        content_type: 'application/pdf',
      })
    ).resolves.toMatchObject({ upload_protocol: 'create_only_v2', upload_if_none_match: '*' });

    expect(post).toHaveBeenCalledWith('/api/workspace/public-form/c6c31f9b-c334-4e3a-be20-79f661d4ad87/upload-url', {
      file_name: 'proof.pdf',
      content_length: 42,
      content_type: 'application/pdf',
      upload_protocol: 'create_only_v2',
    });
  });

  it('refuses a legacy response instead of dropping the create-only precondition', async () => {
    const post = jest.fn().mockResolvedValue({
      data: {
        file_id: 'b5860623-7ab8-40a7-a8bd-594b741d5a82',
        upload_url: 'https://uploads.example.com/signed',
        upload_content_type: 'application/pdf',
        upload_protocol: 'legacy_v1',
        expires_in_secs: 900,
      },
    });

    mockGetPublicFormClient.mockReturnValue({ post } as never);

    await expect(
      requestPublicFormUploadUrl('c6c31f9b-c334-4e3a-be20-79f661d4ad87', {
        file_name: 'proof.pdf',
        content_length: 42,
      })
    ).rejects.toMatchObject({ message: 'Malformed create-only upload-url response' });
  });

  it('preserves public error codes and body retry hints from direct JSON errors', async () => {
    const post = jest.fn().mockRejectedValue({
      name: 'PublicFormHTTPError',
      message: 'Request failed with status code 503',
      response: {
        status: 503,
        headers: {},
        data: { error: 'server_busy', retry_after_seconds: 3 },
      },
    });

    mockGetPublicFormClient.mockReturnValue({ post } as never);

    await expect(
      requestPublicFormUploadUrl('c6c31f9b-c334-4e3a-be20-79f661d4ad87', {
        file_name: 'proof.pdf',
        content_length: 42,
      })
    ).rejects.toMatchObject({
      code: 503,
      publicCode: 'server_busy',
      retryAfterSecs: 3,
      message: 'The form service is busy. Please try again shortly.',
    });
  });

  it('surfaces 426 as a create-only client-upgrade failure', async () => {
    const post = jest.fn().mockRejectedValue({
      name: 'PublicFormHTTPError',
      message: 'Request failed with status code 426',
      response: {
        status: 426,
        headers: {},
        data: { error: 'create_only_upload_protocol_required' },
      },
    });

    mockGetPublicFormClient.mockReturnValue({ post } as never);

    await expect(
      requestPublicFormUploadUrl('c6c31f9b-c334-4e3a-be20-79f661d4ad87', {
        file_name: 'proof.pdf',
        content_length: 42,
      })
    ).rejects.toMatchObject({
      code: 426,
      publicCode: 'create_only_upload_protocol_required',
      message: expect.stringContaining('no longer supported'),
    });
  });

  it.each([
    ['invalid_file_name', 'unsupported characters'],
    ['upload_capacity_reached', 'temporarily at capacity'],
  ])('uses fixed user copy for the %s upload error', async (publicCode, expectedMessage) => {
    const post = jest.fn().mockRejectedValue({
      name: 'PublicFormHTTPError',
      message: 'Request failed',
      response: {
        status: publicCode === 'invalid_file_name' ? 400 : 429,
        headers: {},
        data: { error: publicCode, detail: 'server-internal detail' },
      },
    });

    mockGetPublicFormClient.mockReturnValue({ post } as never);

    await expect(
      requestPublicFormUploadUrl('c6c31f9b-c334-4e3a-be20-79f661d4ad87', {
        file_name: 'proof.pdf',
        content_length: 42,
      })
    ).rejects.toMatchObject({
      publicCode,
      message: expect.stringContaining(expectedMessage),
    });
  });

  it('keeps a stable UUID idempotency key on the exact submit header', async () => {
    const post = jest.fn().mockResolvedValue({
      data: {
        submission_id: 'b5860623-7ab8-40a7-a8bd-594b741d5a82',
        status: 'queued',
      },
    });

    mockGetPublicFormClient.mockReturnValue({ post } as never);
    const idempotencyKey = 'a0aa83b5-82f8-4eca-a466-954b7f329c78';

    await expect(
      submitPublicForm('c6c31f9b-c334-4e3a-be20-79f661d4ad87', { answers: {} }, idempotencyKey)
    ).resolves.toEqual({
      kind: 'submitted',
      submission_id: 'b5860623-7ab8-40a7-a8bd-594b741d5a82',
      status: 'queued',
    });

    expect(post.mock.calls[0][2]).toEqual({ headers: { 'Idempotency-Key': idempotencyKey } });
  });

  it('rejects malformed idempotency keys before sending a request', async () => {
    const post = jest.fn();

    mockGetPublicFormClient.mockReturnValue({ post } as never);

    await expect(
      submitPublicForm('c6c31f9b-c334-4e3a-be20-79f661d4ad87', { answers: {} }, 'retry-me')
    ).rejects.toMatchObject({ code: -1, message: expect.stringContaining('UUID') });
    expect(post).not.toHaveBeenCalled();
  });

  it('rejects an oversized submit body before consuming server capacity', async () => {
    const post = jest.fn();

    mockGetPublicFormClient.mockReturnValue({ post } as never);

    await expect(
      submitPublicForm(
        'c6c31f9b-c334-4e3a-be20-79f661d4ad87',
        {
          answers: {
            question: { kind: 'text', value: 'x'.repeat(256 * 1024) },
          },
        },
        'a0aa83b5-82f8-4eca-a466-954b7f329c78'
      )
    ).rejects.toMatchObject({ code: 413, publicCode: 'invalid_payload' });
    expect(post).not.toHaveBeenCalled();
  });
});
