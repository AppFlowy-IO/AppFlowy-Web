import { uploadFormFileToPresignedUrl } from '../form-api';

describe('public form uploads', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('uses the exact server-signed content type for a MIME-less file', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });

    global.fetch = fetchMock as unknown as typeof fetch;

    const file = new File(['payload'], 'extensionless', { type: '' });

    await uploadFormFileToPresignedUrl('https://uploads.example.com/signed', file, 'application/zip');

    expect(fetchMock).toHaveBeenCalledWith('https://uploads.example.com/signed', {
      method: 'PUT',
      body: file,
      headers: {
        'Content-Type': 'application/zip',
      },
    });
  });
});
