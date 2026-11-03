/** @jest-environment node */
import { PassThrough, Readable } from 'node:stream';

import { fetchPublicPDF } from '../pdf-proxy';
import { handlePDFProxy } from '../pdf-proxy-response';

import type { IncomingMessage } from 'node:http';

jest.mock('../pdf-proxy', () => ({
  ...jest.requireActual('../pdf-proxy'),
  fetchPublicPDF: jest.fn(),
}));

const target = 'https://files.example.com/book.pdf';
const request = (init?: RequestInit) => new Request(`https://app.example.com/api/pdf-proxy?url=${encodeURIComponent(target)}`, init);
const upstream = (text = '%PDF-1.7\nbody', statusCode = 200, headers = {}) => Object.assign(
  Readable.from([Buffer.from(text)]), { statusCode, headers: { 'content-type': 'application/pdf', ...headers } }
) as IncomingMessage;

beforeEach(() => jest.clearAllMocks());

it('streams the PDF with preview headers and never forwards browser credentials', async () => {
  const source = upstream();

  (fetchPublicPDF as jest.Mock).mockResolvedValue(source);
  const response = await handlePDFProxy(request({ headers: { Authorization: 'Bearer secret', Cookie: 'private=session' } }));

  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('application/pdf');
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('content-security-policy')).toContain('sandbox');
  expect(fetchPublicPDF).toHaveBeenCalledWith(target, undefined, expect.any(AbortSignal));
  expect(await response.text()).toBe('%PDF-1.7\nbody');
  expect(source.destroyed).toBe(true);
});

it('preserves byte range responses for PDF.js pagination', async () => {
  (fetchPublicPDF as jest.Mock).mockResolvedValue(upstream('body', 206, {
    'content-length': '4', 'content-range': 'bytes 10-13/100', 'accept-ranges': 'bytes',
  }));
  const response = await handlePDFProxy(request({ headers: { Range: 'bytes=10-13' } }));

  expect(response.status).toBe(206);
  expect(response.headers.get('content-range')).toBe('bytes 10-13/100');
  expect(await response.text()).toBe('body');
});

it.each([
  [{ method: 'POST' }, 405],
  [{ headers: { 'Sec-Fetch-Site': 'cross-site' } }, 403],
  [{ headers: { Range: 'bytes=0-1,20-30' } }, 400],
] as [RequestInit, number][])('rejects unsupported requests before fetching', async (init, status) => {
  expect((await handlePDFProxy(request(init))).status).toBe(status);
  expect(fetchPublicPDF).not.toHaveBeenCalled();
});

it('rejects invalid upstream content and releases its stream', async () => {
  const source = upstream('<html>Not a PDF</html>', 200, { 'content-type': 'text/html' });

  (fetchPublicPDF as jest.Mock).mockResolvedValue(source);
  const response = await handlePDFProxy(request());

  expect(response.status).toBe(502);
  expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
  expect(source.destroyed).toBe(true);
});

it('cancels the upstream request when the browser cancels the stream', async () => {
  const source = Object.assign(new PassThrough(), { statusCode: 200, headers: { 'content-type': 'application/pdf' } });

  source.write('%PDF-1.7\n');
  (fetchPublicPDF as jest.Mock).mockResolvedValue(source);
  const response = await handlePDFProxy(request());
  const signal = (fetchPublicPDF as jest.Mock).mock.calls[0][2] as AbortSignal;

  await response.body!.cancel();
  expect(signal.aborted).toBe(true);
  expect(source.destroyed).toBe(true);
});

it('propagates browser aborts while fetching', async () => {
  const controller = new AbortController();

  (fetchPublicPDF as jest.Mock).mockImplementation((_url, _range, signal: AbortSignal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
  }));
  const response = handlePDFProxy(request({ signal: controller.signal }));

  controller.abort();
  expect((await response).status).toBe(502);
});
