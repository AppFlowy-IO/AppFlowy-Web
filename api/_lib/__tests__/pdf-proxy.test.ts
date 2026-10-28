/** @jest-environment node */
import { lookup } from 'node:dns/promises';
import { EventEmitter } from 'node:events';
import { request } from 'node:https';
import { Readable } from 'node:stream';

import { fetchPublicPDF, isPublicAddress, MAX_PDF_BYTES, parsePDFRange, parsePublicPDFUrl, pdfChunks } from '../pdf-proxy';

import type { IncomingMessage } from 'node:http';

jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));
jest.mock('node:https', () => ({ request: jest.fn() }));

function response(chunks = ['%PDF-1.7\nbody'], statusCode = 200, headers = {}): IncomingMessage {
  return Object.assign(Readable.from(chunks.map((chunk) => Buffer.from(chunk))), {
    statusCode, headers: { 'content-type': 'application/pdf', ...headers },
  }) as IncomingMessage;
}

async function collect(upstream: IncomingMessage, range?: string) {
  const chunks = [];

  for await (const chunk of pdfChunks(upstream, range)) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
}

beforeEach(() => {
  jest.clearAllMocks();
  (lookup as jest.Mock).mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
  (request as jest.Mock).mockImplementation((_url, _options, callback) =>
    Object.assign(new EventEmitter(), { end: () => callback(response()) }));
});

it.each(['127.0.0.1', '10.1.2.3', '169.254.169.254', '172.16.0.1', '192.168.1.1',
  '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1',
  '2001:db8::1'])('rejects non-public addresses: %s', (address) => {
  expect(isPublicAddress(address)).toBe(false);
});

it.each(['file:///tmp/test.pdf', 'http://localhost/file.pdf', 'http://127.1/file.pdf',
  'https://user:secret@example.com/file.pdf', 'http://example.com:8080/file.pdf'])('rejects unsafe URLs: %s', (url) => {
  expect(() => parsePublicPDFUrl(url)).toThrow();
});

it('pins the checked public DNS address and sends only PDF request headers', async () => {
  await fetchPublicPDF('https://files.example.com/book.pdf', 'bytes=0-1023', new AbortController().signal);
  const options = (request as jest.Mock).mock.calls[0][1];

  expect(options.hostname).toBe('8.8.8.8');
  expect(options.servername).toBe('files.example.com');
  expect(lookup).toHaveBeenCalledTimes(1);
  expect(options.headers).toEqual({
    Host: 'files.example.com', Accept: 'application/pdf,application/octet-stream;q=0.9',
    'Accept-Encoding': 'identity', Range: 'bytes=0-1023',
  });
});

it('rejects a public hostname with any private DNS result before connecting', async () => {
  (lookup as jest.Mock).mockResolvedValue([{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }]);
  await expect(fetchPublicPDF('https://files.example.com/book.pdf', undefined, new AbortController().signal)).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});

it('checks redirect targets before connecting and releases the redirect response', async () => {
  const upstream = response([], 302, { location: 'http://169.254.169.254/latest/meta-data' });

  (request as jest.Mock).mockImplementation((_url, _options, callback) =>
    Object.assign(new EventEmitter(), { end: () => callback(upstream) }));
  await expect(fetchPublicPDF('https://files.example.com/book.pdf', undefined, new AbortController().signal)).rejects.toThrow();
  expect(request).toHaveBeenCalledTimes(1);
  expect(upstream.destroyed).toBe(true);
});

it('resolves and validates every public redirect destination', async () => {
  const redirect = response([], 302, { location: 'https://cdn.example.com/book.pdf' });

  (lookup as jest.Mock).mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
    .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
  (request as jest.Mock).mockImplementation((_url, _options, callback) =>
    Object.assign(new EventEmitter(), { end: () => callback(redirect) }));
  await expect(fetchPublicPDF('https://files.example.com/book.pdf', undefined, new AbortController().signal)).rejects.toThrow();
  expect(lookup).toHaveBeenCalledTimes(2);
  expect(request).toHaveBeenCalledTimes(1);
});

it('does not open a connection after cancellation while DNS is resolving', async () => {
  const controller = new AbortController();
  let resolveDNS!: (addresses: { address: string; family: number }[]) => void;

  (lookup as jest.Mock).mockReturnValue(new Promise((resolve) => { resolveDNS = resolve; }));
  const pending = fetchPublicPDF('https://files.example.com/book.pdf', undefined, controller.signal);

  controller.abort();
  await expect(pending).rejects.toThrow();
  resolveDNS([{ address: '8.8.8.8', family: 4 }]);
  await Promise.resolve();
  expect(request).not.toHaveBeenCalled();
});

it('streams a PDF after validating a signature split between chunks', async () => {
  await expect(collect(response(['%P', 'DF-', '1.7\nbody']))).resolves.toBe('%PDF-1.7\nbody');
});

it('supports non-initial PDF page ranges', async () => {
  const upstream = response(['body'], 206, { 'content-range': 'bytes 10-13/100', 'content-length': '4' });

  await expect(collect(upstream, 'bytes=10-13')).resolves.toBe('body');
  expect(parsePDFRange('bytes=10-13')).toBe('bytes=10-13');
});

it.each(['bytes=0-', 'bytes=0-3,5-7', 'bytes=4-1', 'bytes=0-9999999999999999'])('rejects invalid ranges: %s', (range) => {
  expect(() => parsePDFRange(range)).toThrow();
});

it('rejects HTML, forged PDF content, invalid ranges and oversized responses', async () => {
  await expect(collect(response(['<html>'], 200, { 'content-type': 'text/html' }))).rejects.toThrow();
  await expect(collect(response(['<html>']))).rejects.toThrow();
  await expect(collect(response([], 200))).rejects.toThrow();
  await expect(collect(response(['%PDF-'], 206, { 'content-range': 'bytes 10-14/100' }), 'bytes=0-4')).rejects.toThrow();
  await expect(collect(response(['%PDF-'], 200, { 'content-length': String(MAX_PDF_BYTES + 1) }))).rejects.toThrow();
});
